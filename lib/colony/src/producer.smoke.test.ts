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
			await run(init);
			await expect(
				initRepository({ model: "initial-model", owner: "ct", repo: linked }),
			).rejects.toBeInstanceOf(Error);
			await Bun.write(join(linked, "bees.toml"), "invalid worktree config is ignored");
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
			expect(request.labels.toSorted()).toEqual(["agent:worker", "bee", "system"]);
			expect(request.dependencies.map((dep: { id: string }) => dep.id).toSorted()).toEqual(
				[first.id, second.id].toSorted(),
			);
			const snapshot = JSON.parse(request.description);
			expect(snapshot).toMatchObject({
				cwd: await realpath(external),
				effort: "high",
				harness: "fixture",
				model: "captured-model",
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
			const config = await Bun.file(join(repo, "bees.toml")).text();
			await Bun.write(
				join(repo, "bees.toml"),
				`${config.replace("initial-model", "changed-model")}\n[formulas.fixture]\nexecutable=${JSON.stringify(process.execPath)}\nargv=[${JSON.stringify(worker)},"{{model}}","{{effort}}"]\n`,
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
			expect(await Bun.file(output).json()).toEqual({
				argv: ["captured-model", "high"],
				cwd: await realpath(external),
				db: database,
			});
			const unchangedRequests = await br(["show", created.id]);
			expect(unchangedRequests[FIRST].description).toBe(request.description);
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
			const configPath = join(repo, "bees.toml");
			const config = await Bun.file(configPath).text();
			await Bun.write(configPath, config.replace("default-model", "changed-model"));
			const queued = await spawnRequest("worker", [blocked.id], options);
			expect(JSON.parse(String(queued.request.description)).model).toBe("changed-model");
			expect(JSON.parse(String(queued.request.description)).cwd).toBeNull();
			await br(["close", reserved.id, "--reason", "human completed"]);
			const next = await br(["create", "--title", "Remaining task", "--owner", "ct"]);
			const mixed = await spawnRequest("worker", [reserved.id, next.id], {
				...options,
				identity: "given-friendly-otter",
			});
			expect(mixed.request.assignee).toBe("given-friendly-otter");
			expect(mixed.request.status).toBe("open");
		} finally {
			await rm(repo, { force: true, recursive: true });
		}
	},
	TIMEOUT,
);
