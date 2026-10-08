// eslint-disable-next-line import/no-nodejs-modules -- Real isolated repositories and server artifacts.
import { access, mkdir, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { execute } from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Private fixture paths.
import { join } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Disposable fixture parent.
import { tmpdir } from "node:os";

const SUCCESS = 0;
const FIRST = 0;
const ONE = 1;
const POLL_MS = 25;
const DEADLINE = 15_000;
const TEST_TIMEOUT = 60_000;
const COLONY = new URL("../bin/colony.ts", import.meta.url).pathname;
const BEE = new URL("../bin/bee.ts", import.meta.url).pathname;

test(
	"inspection preserves checkpoints and receipt history across sleep and removal on two explicit servers",
	// eslint-disable-next-line max-statements -- One public workflow proves targeting, retained history and output contracts with owned cleanup.
	async () => {
		const directory = await mkdtemp(join(tmpdir(), "colony-inspection-"));
		const root = await realpath(directory);
		const repo = join(root, "repo");
		const database = join(repo, ".beads", "beads.db");
		const targets = ["a", "b"].map((name) => ({
			socket: join(root, `${name}.sock`),
			state: join(root, name),
		}));
		const env = {
			...process.env,
			BD_ACTOR: "inspection",
			BEADS_DB: database,
			XDG_STATE_HOME: join(root, "unused"),
		};
		const native = (args: string[]) => execute(args, repo, env);
		const tracker = async (args: string[]) =>
			JSON.parse(
				await native(["br", ...args, "--db", database, "--actor", "inspection", "--json"]),
			);
		const invoke = async (args: string[], target = targets[FIRST]!, json = true) => {
			let outputFlags: string[] = [];
			if (json) {
				outputFlags = ["--json"];
			}
			const child = Bun.spawn(
				[
					process.execPath,
					COLONY,
					...args,
					"--state",
					target.state,
					"--socket",
					target.socket,
					...outputFlags,
				],
				{ cwd: repo, env, stderr: "pipe", stdout: "pipe" },
			);
			const [stdout, stderr, code] = await Promise.all([
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
				child.exited,
			]);
			return { code, stderr, stdout };
		};
		const client = async (args: string[], target = targets[FIRST]!) => {
			const result = await invoke(args, target);
			expect(result.code).toBe(SUCCESS);
			expect(result.stderr).toBe("");
			const value = JSON.parse(result.stdout);
			expect(value.ok).toBe(true);
			return value;
		};
		const scoped = (operation: string[]) => [...operation, "--repo", repo, "--beads-db", database];
		const inspect = () => client(scoped(["inspect"]));
		const explain = (id: string) => client(scoped(["explain", id]));
		const pids: number[] = [];
		let passed = false;
		try {
			await mkdir(repo);
			await native(["git", "init"]);
			const { BEADS_DB: ignored, ...initEnv } = env;
			void ignored;
			await execute(
				["br", "init", "--prefix", "inspect", "--actor", "inspection", "--json"],
				repo,
				initEnv,
			);
			await fixture(repo);
			const task = await tracker(["create", "--title", "inspection task", "--owner", "ct"]);
			const created = JSON.parse(
				await native([
					process.execPath,
					BEE,
					"spawn",
					"worker",
					task.id,
					"--repo",
					repo,
					"--beads-db",
					database,
					"--actor",
					"inspection",
					"--json",
				]),
			);
			expect(created.ok).toBe(true);
			const dependency = await tracker([
				"create",
				"--title",
				"explain prerequisite",
				"--owner",
				"ct",
			]);
			await tracker(["dep", "add", task.id, dependency.id]);
			await tracker(["update", task.id, "--assignee", "ct"]);
			const blocked = await explain(created.request.id);
			expect(blocked.diagnostics.map((entry: { code: string }) => entry.code)).toEqual(
				expect.arrayContaining(["claim", "native_readiness"]),
			);
			expect(blocked.tracker.result.value.tasks[FIRST].dependencies).toEqual(
				expect.arrayContaining([expect.objectContaining({ id: dependency.id, status: "open" })]),
			);
			await tracker(["close", dependency.id, "--reason", "fixture prerequisite complete"]);
			await tracker(["update", task.id, "--assignee", ""]);
			const untouched = await tracker(["show", created.request.id]);
			const offline = await explain(created.request.id);
			expect(offline.runtime.result).toMatchObject({
				kind: "unavailable",
				reason: "daemon_unavailable",
			});
			expect(offline.tracker.result.kind).toBe("available");
			expect(await exists(targets[FIRST]!.state)).toBe(false);
			expect(await tracker(["show", created.request.id])).toEqual(untouched);
			await client(scoped(["wake"]));
			await client(scoped(["add"]), targets[ONE]!);
			const first = await client(["daemon", "status"]);
			const second = await client(["daemon", "status"], targets[ONE]!);
			pids.push(first.pid, second.pid);
			expect(first.id).not.toBe(second.id);
			expect(first.socket).toBe(targets[FIRST]!.socket);
			expect(second.state).toBe(targets[ONE]!.state);
			await until("queued checkpoint", async () => {
				const result = await inspect();
				return result.requests.length === ONE;
			});
			const queued = await inspect();
			expect(queued.requests[FIRST]).toMatchObject({
				attempts: SUCCESS,
				id: created.request.id,
				identity: created.request.assignee,
				state: "waiting",
				taskIds: [task.id],
			});
			expect(queued.attempts).toEqual([]);
			const capacity = await explain(created.request.id);
			expect(capacity.capacity.result.value.available).toBe(false);
			expect(capacity.diagnostics.map((entry: { code: string }) => entry.code)).toContain(
				"capacity",
			);
			expect(JSON.stringify(capacity)).not.toContain("private-prompt-marker");
			expect(queued.colony).toMatchObject({
				policy: { limits: { colony: SUCCESS } },
				registration: "durable",
				state: "awake",
			});
			const file = join(root, "limits.json");
			await Bun.write(
				file,
				JSON.stringify({
					kind: "limits",
					limits: { colony: ONE, kind: ONE, kinds: {}, worktree: ONE },
				}),
			);
			const policy = await client(
				scoped(["config", "update", "--file", file, "--actor", "inspection"]),
			);

			await until("live worker receipt", async () => {
				const result = await inspect();
				const running = result.attempts[FIRST];
				if (!running || !(await Bun.file(running.paths.worker).exists())) {
					return false;
				}
				const worker = await Bun.file(running.paths.worker).json();
				return worker.kind === "running";
			});
			await client(scoped(["sleep"]));
			const sleeping = await inspect();
			const runningAttempt = sleeping.attempts[FIRST];
			const liveExplanation = await explain(created.request.id);
			expect(liveExplanation.processes[FIRST].evidence.result).toEqual({
				kind: "available",
				value: "live",
			});
			expect(liveExplanation.diagnostics.map((entry: { code: string }) => entry.code)).toContain(
				"colony_asleep",
			);
			await Bun.write(join(repo, "release-worker"), "release");
			await until("detached worker exit while asleep", async () => {
				const worker = await Bun.file(runningAttempt.paths.worker).json();
				return worker.kind === "exited";
			});
			const snapshot = new Database(join(targets[FIRST]!.state, "colony.sqlite"), {
				readonly: true,
			});
			try {
				const rowsBefore = snapshot.query("SELECT * FROM attempts").all();
				const requestsBefore = snapshot.query("SELECT * FROM requests").all();
				const stale = await explain(created.request.id);
				expect(stale.processes[FIRST].evidence.result).toEqual({
					kind: "available",
					value: "stopped",
				});
				expect(stale.diagnostics.map((entry: { code: string }) => entry.code)).toContain(
					"attempt_process",
				);
				expect(stale.runtime.freshness).toBe("checkpoint_age_unknown");
				expect(snapshot.query("SELECT * FROM attempts").all()).toEqual(rowsBefore);
				expect(snapshot.query("SELECT * FROM requests").all()).toEqual(requestsBefore);
				const ownership = join(runningAttempt.paths.receipt, "..", "ownership.json");
				const original = await Bun.file(ownership).text();
				const invalid = JSON.parse(original);
				invalid.token = "wrong-token";
				await Bun.write(ownership, JSON.stringify(invalid));
				try {
					const unknown = await explain(created.request.id);
					expect(unknown.processes[FIRST].evidence.result.kind).toBe("unavailable");
					expect(snapshot.query("SELECT * FROM attempts").all()).toEqual(rowsBefore);
				} finally {
					await Bun.write(ownership, original);
				}
			} finally {
				snapshot.close();
			}
			await client(scoped(["wake"]));
			await until("completed checkpoint", async () => {
				const result = await inspect();
				return result.requests[FIRST]?.state === "terminal";
			});
			const completed = await inspect();
			expect(completed.requests[FIRST]).toMatchObject({ attempts: ONE, outcome: "completed" });
			const attempt = completed.attempts[FIRST];
			expect(attempt).toMatchObject({
				attemptNumber: ONE,
				cwd: repo,
				identity: created.request.assignee,
				policyRevisionId: policy.active.revisionId,
				spawnId: created.request.id,
			});
			expect(completed.history).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						actor: "inspection",
						id: attempt.policyRevisionId,
						source: "limits",
					}),
				]),
			);
			expect(JSON.stringify(completed)).not.toContain("private-prompt-marker");
			expect(JSON.stringify(completed)).not.toContain('"argv"');
			const receipt = await Bun.file(attempt.paths.receipt).json();
			expect(receipt.id).toBe(attempt.id);
			expect(await Bun.file(attempt.paths.stdout).text()).toContain("inspection-output");
			expect(await Bun.file(attempt.paths.stderr).exists()).toBe(true);
			await until("worker receipt exit", async () => {
				const worker = await Bun.file(attempt.paths.worker).json();
				return worker.kind !== "running";
			});
			const human = await invoke(scoped(["inspect"]), targets[FIRST]!, false);
			expect(human.code).toBe(SUCCESS);
			expect(human.stdout).toContain(attempt.id);
			expect(human.stdout).toContain(attempt.paths.stdout);
			await client(scoped(["sleep"]));
			const asleep = await inspect();
			expect(asleep.colony).toMatchObject({ intent: "asleep", state: "asleep" });
			await client(scoped(["remove"]));
			const removed = await inspect();
			expect(removed.colony).toBeNull();
			const unregistered = await explain(created.request.id);
			expect(unregistered.diagnostics.map((entry: { code: string }) => entry.code)).toContain(
				"unregistered",
			);
			expect(removed.requests).toEqual(completed.requests);
			expect(removed.attempts.map((entry: { id: string }) => entry.id)).toEqual([attempt.id]);
			expect(removed.history).toEqual(completed.history);
			const foreground = await invoke(["daemon", "serve"], targets[ONE]!);
			expect(foreground.code).not.toBe(SUCCESS);
			expect(foreground.stderr).toBe("");
			expect(JSON.parse(foreground.stdout)).toMatchObject({
				kind: "error",
				ok: false,
				reason: ONE,
			});
			await client(["daemon", "stop"]);
			await until("selected server exit", () => Promise.resolve(!alive(first.pid)));
			const afterStop = await explain(created.request.id);
			expect(afterStop.runtime.result.reason).toBe("daemon_unavailable");
			expect(afterStop.tracker.result.value.disposition).toEqual({
				outcome: "succeeded",
				resolution: "resolved",
			});
			const absent = await invoke(scoped(["inspect"]));
			expect(absent.code).not.toBe(SUCCESS);
			expect(absent.stderr).toBe("");
			expect(JSON.parse(absent.stdout)).toMatchObject({
				kind: "error",
				ok: false,
				reason: "daemon_unavailable",
			});
			expect(await exists(targets[FIRST]!.socket)).toBe(false);
			const surviving = await client(["daemon", "status"], targets[ONE]!);
			expect(surviving.id).toBe(second.id);
			expect(surviving.pid).toBe(second.pid);
			expect(
				await Bun.file(join(env.XDG_STATE_HOME, "hive", "colony", "colony.sqlite")).exists(),
			).toBe(false);
			passed = true;
		} catch (error) {
			throw new Error(`Inspection smoke artifacts retained at ${root}`, { cause: error });
		} finally {
			await Promise.all(
				targets.map(async (target) => {
					if (await exists(target.socket)) {
						await fetch("http://localhost/", {
							body: JSON.stringify({ kind: "stop" }),
							method: "POST",
							signal: AbortSignal.timeout(DEADLINE),
							unix: target.socket,
						});
					}
					await cleanupWorkers(target.state);
				}),
			);
			await until("owned server cleanup", () => Promise.resolve(pids.every((pid) => !alive(pid))));
			if (passed) {
				await rm(root, { force: true, recursive: true });
			}
		}
	},
	TEST_TIMEOUT,
);

// --- Private functions ---
function exists(path: string): Promise<boolean> {
	return access(path).then(
		() => true,
		() => false,
	);
}
async function fixture(repo: string): Promise<void> {
	await Bun.write(
		join(repo, ".hive", "bees.toml"),
		`owner="ct"
humans=["ct"]
ranking="fifo"
[limits]
colony=0
[kinds.worker]
description = "Implement the linked task beads and verify their outcomes."
harness="scripted"
model="fixture"
effort="low"
prompt="private-prompt-marker"
[formulas.scripted]
executable=${JSON.stringify(process.execPath)}
argv=[${JSON.stringify(join(repo, "worker.ts"))}]
`,
	);
	await Bun.write(
		join(repo, "worker.ts"),
		`
console.log("inspection-output");
while(!(await Bun.file("release-worker").exists())) await Bun.sleep(25);
const receipt=await Bun.file(process.env.HIVE_COLONY_STATE+"/"+process.env.HIVE_ATTEMPT_ID+"/receipt.json").json();
const child=Bun.spawn(["br","close",...receipt.taskIds,"--actor",process.env.BD_ACTOR,"--db",process.env.BEADS_DB,"--json"],{stdout:"ignore",stderr:"inherit"});
if(await child.exited!==0)throw new Error("Fixture completion failed");
`,
	);
}
async function until(label: string, condition: () => Promise<boolean>): Promise<void> {
	const deadline = Date.now() + DEADLINE;
	/* eslint-disable no-await-in-loop -- Bounded polling of observable completion conditions. */
	while (!(await condition())) {
		if (Date.now() >= deadline) {
			throw new Error(`Timed out waiting for ${label}`);
		}
		await Bun.sleep(POLL_MS);
	}
	/* eslint-enable no-await-in-loop */
}
function alive(pid: number): boolean {
	try {
		process.kill(pid, SUCCESS);
		return true;
	} catch {
		return false;
	}
}
async function cleanupWorkers(state: string): Promise<void> {
	const entries = await readdir(state, { withFileTypes: true }).catch(() => []);
	await Promise.all(
		entries
			.filter((entry) => entry.isDirectory())
			.map(async (entry) => {
				const file = Bun.file(join(state, entry.name, "worker.json"));
				if (await file.exists()) {
					const receipt = await file.json();
					for (const pid of [receipt.harnessPid, receipt.supervisorPid]) {
						if (typeof pid === "number" && alive(pid)) {
							process.kill(pid, "SIGTERM");
						}
					}
				}
			}),
	);
}
