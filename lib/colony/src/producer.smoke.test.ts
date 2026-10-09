import { expect, test } from "bun:test";
import { initRepository, spawnRequest } from "./producer.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Own disposable Git/br fixture directories.
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { execute } from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve fixture paths.
import { join } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Isolated OS temporary fixture root.
import { tmpdir } from "node:os";

const FIRST = 0;
const LAST = -1;
const TIMEOUT = 10_000;

test(
	"offline producer snapshots canonical defaults across linked worktrees and refuses duplicates",
	// eslint-disable-next-line max-statements -- One bounded real IO scenario keeps its disposable setup and teardown visible.
	async () => {
		const root = await mkdtemp(join(tmpdir(), "bee-producer-"));
		const repo = join(root, "repo");
		const external = join(root, "external");
		await mkdir(repo);
		await mkdir(external);
		const database = join(repo, ".beads", "beads.db");
		const env = { ...process.env, BD_ACTOR: "smoke-seed", BEADS_DB: database };
		const run = (args: string[]) => execute(args, repo, env);
		const br = async (args: string[]) =>
			JSON.parse(await run(["br", ...args, "--db", database, "--actor", "smoke-seed", "--json"]));
		const colony = new URL("../bin/colony.ts", import.meta.url).pathname;
		const bee = new URL("../bin/bee.ts", import.meta.url).pathname;
		try {
			await run(["git", "init", "-b", "main"]);
			await run(["git", "init", "--bare", join(root, "remote.git")]);
			await run(["git", "remote", "add", "origin", join(root, "remote.git")]);
			await run([
				"git",
				"-c",
				"user.name=Smoke",
				"-c",
				"user.email=smoke@example.invalid",
				"commit",
				"--allow-empty",
				"-m",
				"fixture",
			]);
			await run(["git", "push", "-u", "origin", "main"]);
			await run(["honeycomb", "--cwd", repo, "add", "--branch", "fixture", "--base-current"]);
			const linkedOutput = await run(["honeycomb", "--cwd", repo, "path", "--branch", "fixture"]);
			const linked = linkedOutput.trim();
			await run(["br", "init", "--prefix", "smoke"]);
			const init = [
				process.execPath,
				colony,
				"init",
				"--repo",
				linked,
				"--owner",
				"ct",
				"--model",
				"initial-model",
				"--json",
			];
			const initialized = JSON.parse(await run(init));
			expect(initialized.path).toBe(join(await realpath(repo), ".hive", "bees.toml"));
			const initial = await Bun.file(join(repo, ".hive", "bees.toml")).text();
			await Bun.write(
				join(repo, ".hive", "bees.toml"),
				initial.replace("[kinds.worker]", '[kinds.worker]\nhidden = true\ndeny = ["#self"]'),
			);
			await expect(
				initRepository({ model: "initial-model", owner: "ct", repo: linked }),
			).rejects.toBeInstanceOf(Error);
			await Bun.write(join(linked, ".hive", "bees.toml"), "invalid worktree config is ignored");
			const hidden = JSON.parse(
				await run([process.execPath, bee, "kinds", "--repo", linked, "--as", "worker", "--json"]),
			);
			expect(hidden.kinds).toEqual([]);
			await Bun.write(
				join(repo, ".hive", "bees", "arbitrary", "bee.toml"),
				'name="reviewer"\ndescription="Review changes."\nharness="codex"\nmodel="folder-model"\neffort="high"\n',
			);
			await Bun.write(
				join(repo, ".hive", "bees", "arbitrary", "system_prompt.md"),
				"Review from file.\n",
			);
			await Bun.write(
				join(repo, ".hive", "bees", "arbitrary", "prompt.md"),
				"Default review direction.",
			);
			const review = await br(["create", "--title", "Review task", "--owner", "ct"]);
			const folderRequest = await spawnRequest("reviewer", [review.id], {
				actor: "requester-identity",
				beadsDb: database,
				repo: linked,
			});
			expect(JSON.parse(String(folderRequest.request.description))).toMatchObject({
				kind: "reviewer",
				model: "folder-model",
				prompt: "Default review direction.",
				system_prompt: "Review from file.\n",
			});
			const roleTask = await br(["create", "--title", "Different review role", "--owner", "ct"]);
			const roleOverride = JSON.parse(
				await run([
					process.execPath,
					bee,
					"spawn",
					"reviewer",
					roleTask.id,
					"--repo",
					linked,
					"--actor",
					"requester-identity",
					"--system-prompt",
					"Replacement role.\nKeep the direction.",
					"--json",
				]),
			).request;
			expect(JSON.parse(roleOverride.description)).toMatchObject({
				prompt: "Default review direction.",
				system_prompt: "Replacement role.\nKeep the direction.",
			});
			const clearedTask = await br(["create", "--title", "Clear prompt defaults", "--owner", "ct"]);
			const cleared = JSON.parse(
				await run([
					process.execPath,
					bee,
					"spawn",
					"reviewer",
					clearedTask.id,
					"--repo",
					linked,
					"--actor",
					"requester-identity",
					"--prompt",
					"",
					"--system-prompt",
					"",
					"--json",
				]),
			).request;
			expect(JSON.parse(cleared.description)).toMatchObject({ prompt: "", system_prompt: "" });
			const first = await br(["create", "--title", "First task", "--owner", "ct"]);
			const second = await br(["create", "--title", "Second task", "--owner", "ct"]);
			const submit = [
				process.execPath,
				bee,
				"spawn",
				"worker",
				first.id,
				second.id,
				"--repo",
				linked,
				"--beads-db",
				database,
				"--actor",
				"requester-identity",
				"--cwd",
				external,
				"--model",
				"captured-model",
				"--effort",
				"high",
				"--harness",
				"fixture",
				"--prompt",
				'Inspect quotes: "literal"\nThen verify the task.',
				"--json",
			];
			const created = JSON.parse(await run(submit)).request;
			const [request] = await br(["show", created.id]);
			expect(request).toMatchObject({
				created_by: "requester-identity",
				owner: "ct",
				status: "open",
			});
			expect(request.assignee).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/u);
			expect(request.labels.toSorted()).toEqual([
				"agent:worker",
				"bee",
				"bee-outcome:pending",
				"bee-resolution:unresolved",
				"system",
			]);
			expect(request.dependencies.map((dep: { id: string }) => dep.id).toSorted()).toEqual(
				[first.id, second.id].toSorted(),
			);
			const snapshot = JSON.parse(request.description);
			expect(Object.keys(snapshot).toSorted()).toEqual([
				"cwd",
				"effort",
				"harness",
				"kind",
				"model",
				"prompt",
				"system_prompt",
			]);
			expect(snapshot).toMatchObject({
				cwd: await realpath(external),
				effort: "high",
				harness: "fixture",
				model: "captured-model",
				prompt: 'Inspect quotes: "literal"\nThen verify the task.',
				system_prompt: expect.stringContaining("Work on the related task beads."),
			});
			const unchangedTasks = await br(["show", first.id]);
			expect(unchangedTasks[FIRST].assignee).toBeUndefined();
			const options = { actor: "requester-identity", beadsDb: database, repo: linked };
			await expect(spawnRequest("worker", [first.id, second.id], options)).rejects.toBeInstanceOf(
				Error,
			);
			await expect(
				spawnRequest(
					"worker",
					[first.id.replace("smoke-", ""), second.id.replace("smoke-", "")],
					options,
				),
			).rejects.toBeInstanceOf(Error);
			const worker = join(root, "worker.ts");
			const output = join(root, "worker.json");
			await Bun.write(
				worker,
				`await Bun.write(${JSON.stringify(output)},JSON.stringify({argv:Bun.argv.slice(2),cwd:process.cwd(),db:process.env.BEADS_DB}));`,
			);
			const config = await Bun.file(join(repo, ".hive", "bees.toml")).text();
			await Bun.write(
				join(repo, ".hive", "bees.toml"),
				`${config.replace("initial-model", "changed-model")}\n[formulas.fixture]\nexecutable=${JSON.stringify(process.execPath)}\nargv=[${JSON.stringify(worker)},"{{model}}","{{effort}}","{{system_prompt}}","{{prompt}}"]\n`,
			);
			await run([
				process.execPath,
				colony,
				"launch",
				created.id,
				"--repo",
				linked,
				"--beads-db",
				database,
				"--state",
				join(root, "state"),
				"--json",
			]);
			const launched = await Bun.file(output).json();
			expect(launched).toEqual({
				argv: [
					"captured-model",
					"high",
					JSON.parse(request.description).system_prompt,
					expect.stringContaining(snapshot.prompt),
				],
				cwd: await realpath(external),
				db: database,
			});
			expect(launched.argv.at(LAST)).toContain(
				"Read the full instructions and acceptance criteria",
			);
			expect(
				launched.argv.at(LAST).split("Related tasks: ").at(LAST).split(", ").toSorted(),
			).toEqual([first.id, second.id].toSorted());
			const unchangedRequests = await br(["show", created.id]);
			expect(unchangedRequests[FIRST].description).toBe(request.description);
			await br(["close", created.id, "--reason", "exhausted"]);
			const retried = JSON.parse(
				await run([
					process.execPath,
					bee,
					"retry",
					created.id,
					"--repo",
					linked,
					"--actor",
					"requester-identity",
					"--prompt",
					"Retry direction",
					"--system-prompt",
					"Retry role",
					"--json",
				]),
			).request;
			expect(JSON.parse(retried.description)).toMatchObject({
				prompt: "Retry direction",
				system_prompt: "Retry role",
				model: "changed-model",
			});
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	},
	TIMEOUT,
);

test(
	"offline producer refuses reserved work and admits blocked and closed tasks",
	// eslint-disable-next-line max-statements -- Keep native admission transitions and disposable fixture ownership together.
	async () => {
		const repo = await mkdtemp(join(tmpdir(), "bee-admission-"));
		const database = join(repo, ".beads", "beads.db");
		const env = { ...process.env, BD_ACTOR: "smoke-seed", BEADS_DB: database };
		const run = (args: string[]) => execute(args, repo, env);
		const br = async (args: string[]) =>
			JSON.parse(await run(["br", ...args, "--db", database, "--actor", "smoke-seed", "--json"]));
		try {
			await run(["git", "init", "-b", "main"]);
			await run(["br", "init", "--prefix", "smoke"]);
			await initRepository({ model: "default-model", owner: "ct", repo });
			const reserved = await br([
				"create",
				"--title",
				"Reserved",
				"--owner",
				"ct",
				"--assignee",
				"ct",
			]);
			const blocked = await br([
				"create",
				"--title",
				"Blocked",
				"--owner",
				"ct",
				"--deps",
				`blocks:${reserved.id}`,
			]);
			const options = { actor: "requester-identity", beadsDb: database, repo };
			await expect(spawnRequest("missing", [blocked.id], options)).rejects.toBeInstanceOf(Error);
			await expect(spawnRequest("worker", [reserved.id], options)).rejects.toBeInstanceOf(Error);
			const configPath = join(repo, ".hive", "bees.toml");
			const config = await Bun.file(configPath).text();
			await Bun.write(configPath, config.replace("default-model", "changed-model"));
			const queued = await spawnRequest("worker", [blocked.id], options);
			expect(JSON.parse(String(queued.request.description)).model).toBe("changed-model");
			expect(JSON.parse(String(queued.request.description)).cwd).toBeNull();
			await br(["close", reserved.id, "--reason", "human completed"]);
			const next = await br(["create", "--title", "Remaining task", "--owner", "ct"]);
			const mixed = await spawnRequest("worker", [reserved.id, next.id], options);
			expect(mixed.request.assignee).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/u);
			expect(mixed.request.status).toBe("open");
		} finally {
			await rm(repo, { force: true, recursive: true });
		}
	},
	TIMEOUT,
);
