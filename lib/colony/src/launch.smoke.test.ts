import { beadSchema, execute, parseBeesConfig, readSpawnRequest } from "@hive/shared";
import { expect, test } from "bun:test";
// eslint-disable-next-line import/no-nodejs-modules -- Disposable fixture directories.
import { mkdir, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve fixture paths.
import { join } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- OS temporary fixture root.
import { tmpdir } from "node:os";

const FIRST = 0;
const SUCCESS = 0;
const ONE_ATTEMPT = 1;
const WORKER_FAILURE = 7;
const SMOKE_TIMEOUT = 10_000;

test(
	"manual request launches a real worker with isolated endpoint and strict formulas",
	// eslint-disable-next-line max-statements -- Keep this disposable end-to-end scenario and teardown together.
	async () => {
		const root = await mkdtemp(join(tmpdir(), "colony-launch-"));
		const repo = join(root, "repo");
		const outside = join(root, "outside");
		await mkdir(repo);
		await mkdir(outside);
		const database = join(repo, ".beads", "beads.db");
		const env = { ...process.env, BD_ACTOR: "smoke-seed", BEADS_DB: database };
		const run = (args: string[]) => execute(args, repo, env);
		const br = async (args: string[]) =>
			JSON.parse(await run(["br", ...args, "--db", database, "--actor", "smoke-seed", "--json"]));
		try {
			await run(["git", "init"]);
			await run(["br", "init", "--prefix", "smoke"]);
			const task = await br(["create", "--title", "Fixture work", "--owner", "ct"]);
			const output = join(root, "worker.json");
			const worker = join(root, "worker.ts");
			await Bun.write(
				worker,
				`await Bun.write(${JSON.stringify(output)}, JSON.stringify({argv:Bun.argv.slice(2),cwd:process.cwd(),db:process.env.BEADS_DB,actor:process.env.BD_ACTOR,identity:process.env.HIVE_AGENT_NAME,kind:process.env.BR_AGENT_NAME})); const p=Bun.spawn(["br","update",Bun.argv[2],"--append-notes","worker visited","--json"],{stdout:"pipe",stderr:"pipe"}); if(await p.exited!==0) throw new Error(await new Response(p.stderr).text());`,
			);
			const recipe = {
				cwd: await realpath(outside),
				effort: "low",
				harness: "fixture",
				kind: "worker",
				model: "literal <model>",
				prompt: task.id,
			};
			const spawn = await br([
				"create",
				"--title",
				"Spawn fixture",
				"--owner",
				"ct",
				"--assignee",
				"amber-quiet-otter",
				"--labels",
				"system,bee,agent:worker",
				"--description",
				JSON.stringify(recipe),
				"--deps",
				`related:${task.id}`,
			]);
			const config = `owner = "ct"\nhumans = ["ct"]\n[kinds]\n[formulas.fixture]\nexecutable = ${JSON.stringify(process.execPath)}\nargv = [${JSON.stringify(worker)}, "{{prompt}}", "{{model}}"]\n`;
			await Bun.write(join(repo, ".hive", "bees.toml"), config);
			const cli = new URL("../bin/colony.ts", import.meta.url).pathname;
			const args = [
				process.execPath,
				cli,
				"launch",
				spawn.id,
				"--repo",
				repo,
				"--beads-db",
				database,
				"--state",
				join(root, "state"),
				"--json",
			];
			expect(await execute([process.execPath, cli, "launch", "--help"], outside, env)).toContain(
				"--beads-db",
			);
			const receipt = JSON.parse(await execute(args, outside, env));
			expect(receipt.outcome).toEqual({ code: 0, kind: "exited" });
			expect(await Bun.file(output).json()).toEqual({
				actor: "amber-quiet-otter",
				argv: [task.id, "literal <model>"],
				cwd: await realpath(outside),
				db: database,
				identity: "amber-quiet-otter",
				kind: "worker",
			});
			const updated = await br(["show", task.id]);
			expect(updated[FIRST].notes).toContain("worker visited");
			// Strict formula and label validation belong to the shared parsing boundary.
			expect(() => parseBeesConfig(config.replace("{{model}}", "{{#broken"))).toThrow(Error);
			expect(() => parseBeesConfig(config.replace("{{model}}", "{{missing}}"))).toThrow(Error);
			const [storedSpawn] = await br(["show", spawn.id]);
			const invalidSpawn = beadSchema.parse({
				...storedSpawn,
				labels: ["system", "bee:wrong", "agent:worker"],
			});
			expect(() => readSpawnRequest(invalidSpawn)).toThrow(Error);
			expect(await readdir(join(root, "state"))).toHaveLength(ONE_ATTEMPT);
			await rm(output);
			const blocker = await br(["create", "--title", "Blocking fixture", "--owner", "ct"]);
			const cases = [
				{
					change: ["update", task.id, "--assignee", "ct"],
					reset: ["update", task.id, "--assignee", ""],
				},
				{
					change: ["update", task.id, "--add-label", "hitl"],
					reset: ["update", task.id, "--remove-label", "hitl"],
				},
				{
					change: ["dep", "add", task.id, blocker.id],
					reset: ["dep", "remove", task.id, blocker.id],
				},
			];
			/* eslint-disable no-await-in-loop -- These cases intentionally mutate and restore the same disposable request sequentially. */
			for (const scenario of cases) {
				await br(scenario.change);
				const child = Bun.spawn(args, { cwd: outside, env, stderr: "pipe", stdout: "pipe" });
				const [stdout, stderr, code] = await Promise.all([
					new Response(child.stdout).text(),
					new Response(child.stderr).text(),
					child.exited,
				]);
				expect(code).not.toBe(SUCCESS);
				expect(stderr).toBe("");
				expect(JSON.parse(stdout)).toEqual({
					kind: "error",
					message: expect.any(String),
					ok: false,
					reason: 1,
				});
				expect(await readdir(join(root, "state"))).toHaveLength(ONE_ATTEMPT);
				expect(await Bun.file(output).exists()).toBe(false);
				await br(scenario.reset);
			}
			/* eslint-enable no-await-in-loop */
			await Bun.write(worker, "process.exitCode=7;");
			await expect(execute(args, outside, env)).rejects.toBeInstanceOf(Error);
			const attempts = await readdir(join(root, "state"));
			const receipts = await Promise.all(
				attempts.map((attempt) => Bun.file(join(root, "state", attempt, "receipt.json")).json()),
			);
			expect(receipts.some((item) => item.outcome.code === WORKER_FAILURE)).toBe(true);
			await br(["close", spawn.id, "--reason", "fixture finished"]);
			await expect(execute(args, outside, env)).rejects.toBeInstanceOf(Error);
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	},
	SMOKE_TIMEOUT,
);
