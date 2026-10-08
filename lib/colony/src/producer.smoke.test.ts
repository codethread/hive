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
			const initial = await Bun.file(join(repo, "bees.toml")).text();
			await Bun.write(
				join(repo, "bees.toml"),
				initial.replace("[kinds.worker]", '[kinds.worker]\nhidden = true\ndeny = ["#self"]'),
			);
			await expect(
				initRepository({ model: "initial-model", owner: "ct", repo: linked }),
			).rejects.toBeInstanceOf(Error);
			await Bun.write(join(linked, "bees.toml"), "invalid worktree config is ignored");
			const hidden = JSON.parse(
				await run([process.execPath, bee, "kinds", "--repo", linked, "--as", "worker", "--json"]),
			);
			expect(hidden.kinds).toEqual([]);
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
			]);
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
			const mixed = await spawnRequest("worker", [reserved.id, next.id], options);
			expect(mixed.request.assignee).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/u);
			expect(mixed.request.status).toBe("open");
		} finally {
			await rm(repo, { force: true, recursive: true });
		}
	},
	TIMEOUT,
);

test(
	"bee retry uses current defaults, preserves history and resolves only admitted replacements",
	// eslint-disable-next-line max-statements -- One disposable native tracker exercises public retry admission and provenance together.
	async () => {
		const repo = await mkdtemp(join(tmpdir(), "bee-replacement-"));
		const database = join(repo, ".beads", "beads.db");
		const env = { ...process.env, BD_ACTOR: "smoke-seed", BEADS_DB: database };
		const run = (args: string[]) => execute(args, repo, env);
		const br = async (args: string[]) => JSON.parse(await run(["br", ...args, "--json"]));
		const beePath = new URL("../bin/bee.ts", import.meta.url).pathname;
		const bee = (args: string[]) =>
			run([process.execPath, beePath, ...args, "--repo", repo, "--beads-db", database]);
		const inspect = async (id: string) => JSON.parse(await bee(["status", id, "--json"])).request;
		const retry = async (id: string, options: string[] = []) =>
			JSON.parse(await bee(["retry", id, ...options, "--json"])).request;
		try {
			await run(["git", "init", "-b", "main"]);
			await br(["init", "--prefix", "smoke"]);
			await initRepository({ model: "initial-model", owner: "ct", repo });
			const first = await br(["create", "--title", "Finished", "--owner", "ct"]);
			const second = await br(["create", "--title", "Remaining", "--owner", "ct"]);
			const original = JSON.parse(
				await bee([
					"spawn",
					"worker",
					first.id,
					second.id,
					"--actor",
					"seed",
					"--model",
					"old-model",
					"--effort",
					"high",
					"--harness",
					"old-harness",
					"--prompt",
					"Old instructions",
					"--cwd",
					repo,
					"--json",
				]),
			).request;
			await br(["close", first.id]);
			await br([
				"comments",
				"add",
				original.id,
				"Colony observation: settled: exhausted; fixture evidence",
			]);
			await br(["close", original.id, "--reason", "exhausted"]);
			const before = await inspect(original.id);
			expect(before).toMatchObject({ needsAttention: true, resolution: { kind: "unresolved" } });
			await br(["update", second.id, "--assignee", "ct"]);
			await expect(retry(original.id)).rejects.toBeInstanceOf(Error);
			const refused = await inspect(original.id);
			expect(refused.resolution).toEqual(before.resolution);
			await br(["update", second.id, "--assignee", ""]);
			expect(await inspect(original.id)).toEqual(before);
			const options = { actor: "seed", beadsDb: database, repo };
			const duplicate = await spawnRequest("worker", [second.id], options);
			await expect(retry(original.id)).rejects.toBeInstanceOf(Error);
			const overlapped = await inspect(original.id);
			expect(overlapped.needsAttention).toBe(true);
			await bee(["stop", duplicate.request.id, "--actor", "seed"]);
			const configPath = join(repo, "bees.toml");
			const config = await Bun.file(configPath).text();
			await Bun.write(
				configPath,
				`${config.replace("initial-model", "current-model")}\n[kinds.other]\ndescription = "Execute the configured other role."\nharness="pi"\nmodel="other-model"\neffort="medium"\nprompt="Other instructions"\n`,
			);
			const replacement = await retry(original.id);
			const current = await inspect(replacement.id);
			expect(replacement).toMatchObject({ created_by: "smoke-seed" });
			expect(current.identity).toBe(replacement.assignee);
			expect(current.identity).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/u);
			expect(current.recipe).toMatchObject({
				effort: "low",
				harness: "codex",
				kind: "worker",
				model: "current-model",
			});
			expect(current.recipe.cwd).toBeNull();
			expect(current.recipe.prompt).not.toContain("Old instructions");
			expect(current.recipe.prompt).not.toContain(first.id);
			expect(current.tasks.map((task: { id: string }) => task.id)).toEqual([second.id]);
			expect(current.supersedes).toEqual([original.id]);
			expect(current.identity).not.toBe(before.identity);
			const resolved = await inspect(original.id);
			expect(resolved).toEqual({
				...before,
				disposition: { outcome: "failed", resolution: "resolved" },
				labelPublication: "current",
				needsAttention: false,
				resolution: { kind: "superseded", replacementIds: [replacement.id] },
			});
			expect(await bee(["status", original.id])).toContain(`Replacement: ${replacement.id}`);
			await expect(retry(original.id)).rejects.toBeInstanceOf(Error);
			await br(["close", replacement.id, "--reason", "claim_failed"]);
			const listed = JSON.parse(await bee(["list", "--json"]));
			expect(listed.requests.map((request: { id: string }) => request.id)).toEqual([
				replacement.id,
			]);
			const switched = await retry(replacement.id, [
				"--actor",
				"retry-actor",
				"--kind",
				"other",
				"--model",
				"override-model",
				"--effort",
				"high",
				"--prompt",
				"New instructions",
				"--cwd",
				repo,
			]);
			const switchedView = await inspect(switched.id);
			expect(switchedView.recipe).toEqual({
				cwd: await realpath(repo),
				effort: "high",
				harness: "pi",
				kind: "other",
				model: "override-model",
				prompt: `New instructions\n\nRelated tasks: ${second.id}`,
			});
			expect(switched.created_by).toBe("retry-actor");
			expect(switched.assignee).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/u);
			expect(switchedView.identity).toBe(switched.assignee);
			await br(["close", switched.id, "--reason", "exhausted"]);
			await br(["close", second.id]);
			await expect(retry(switched.id)).rejects.toBeInstanceOf(Error);
			const noTasks = await inspect(switched.id);
			expect(noTasks.needsAttention).toBe(true);
			const all = JSON.parse(await bee(["list", "--all", "--json"]));
			expect(all.requests.map((request: { id: string }) => request.id)).toContain(original.id);
		} finally {
			await rm(repo, { force: true, recursive: true });
		}
	},
	TIMEOUT,
);
