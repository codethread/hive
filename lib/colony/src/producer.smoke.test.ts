import { expect, test } from "bun:test";
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
	"offline producer snapshots canonical defaults across linked worktrees and refuses reserved/duplicate work",
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
			await expect(run(init)).rejects.toBeInstanceOf(Error);
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
			await expect(run(submit)).rejects.toBeInstanceOf(Error);
			const aliasRows = await br(["show", first.id.replace("smoke-", "")]);
			expect(aliasRows[FIRST].id).toBe(first.id);
			await expect(
				run(
					submit.map((token) => {
						if ([first.id, second.id].includes(token)) {
							return token.replace("smoke-", "");
						}
						return token;
					}),
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
			const base = [
				"--repo",
				linked,
				"--beads-db",
				database,
				"--actor",
				"requester-identity",
				"--json",
			];
			await expect(
				run([process.execPath, bee, "spawn", "missing", blocked.id, ...base]),
			).rejects.toBeInstanceOf(Error);
			await expect(
				run([process.execPath, bee, "spawn", "worker", reserved.id, ...base]),
			).rejects.toBeInstanceOf(Error);
			const queued = JSON.parse(
				await run([process.execPath, bee, "spawn", "worker", blocked.id, ...base]),
			).request;
			expect(JSON.parse(queued.description).model).toBe("changed-model");
			expect(JSON.parse(queued.description).cwd).toBeNull();
			await br(["close", reserved.id, "--reason", "human completed"]);
			const next = await br(["create", "--title", "Remaining task", "--owner", "ct"]);
			const mixed = JSON.parse(
				await run([
					process.execPath,
					bee,
					"spawn",
					"worker",
					reserved.id,
					next.id,
					...base,
					"--identity",
					"given-friendly-otter",
				]),
			).request;
			expect(mixed.assignee).toBe("given-friendly-otter");
			expect(mixed.status).toBe("open");
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	},
	TIMEOUT,
);
