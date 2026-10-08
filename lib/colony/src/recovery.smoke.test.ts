// eslint-disable-next-line import/no-nodejs-modules -- Real private repositories and owned process cleanup.
import { access, mkdir, mkdtemp, readdir, realpath, rm, stat } from "node:fs/promises";
import { beadSchema, colonyResponseSchema, execute, latestStdoutActivity } from "@hive/shared";
import { expect, test } from "bun:test";
import type { ColonyResponse } from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Private fixture paths.
import { join } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Private OS temporary fixture root.
import { tmpdir } from "node:os";

const SUCCESS = 0;
const FIRST = 0;
const ONE = 1;
const TWO = 2;
const POLL_INTERVAL = 20;
const DEADLINE = 15_000;
const SMOKE_TIMEOUT = 90_000;
const COLONY = new URL("../bin/colony.ts", import.meta.url).pathname;
const BEE = new URL("../bin/bee.ts", import.meta.url).pathname;

test(
	"private daemon recovery adopts live work, retries dead work and reconciles only awake registered requests",
	// eslint-disable-next-line max-statements -- One sequential crash/recovery scenario keeps process ownership and cleanup visible.
	async () => {
		const directory = await mkdtemp(join(tmpdir(), "colony-recovery-"));
		const root = await realpath(directory);
		const target = join(root, "target");
		const witness = join(root, "witness");
		const temporary = join(root, "temporary");
		const repos = [target, witness, temporary];
		const state = join(root, "state");
		const socket = join(root, "daemon.sock");
		const env = {
			...process.env,
			BD_ACTOR: "smoke-seed",
			BEADS_DB: join(root, "unused.db"),
			XDG_STATE_HOME: join(root, "unused"),
		};
		const run = (args: string[], cwd = root) => execute(args, cwd, env);
		const tracker = async (repo: string, args: string[]) =>
			JSON.parse(
				await run(
					[
						"br",
						...args,
						"--db",
						join(repo, ".beads", "beads.db"),
						"--actor",
						"smoke-seed",
						"--json",
					],
					repo,
				),
			);
		const client = async (args: string[]) =>
			parseCliResponse(
				await run([
					process.execPath,
					COLONY,
					...args,
					"--state",
					state,
					"--socket",
					socket,
					"--json",
				]),
			);
		const operation = (kind: string, repo: string, extra: string[] = []) =>
			client([kind, "--repo", repo, "--beads-db", join(repo, ".beads", "beads.db"), ...extra]);
		const status = async () => {
			const result = await client(["list"]);
			if (result.kind !== "status") {
				throw new Error(JSON.stringify(result));
			}
			return result;
		};
		const colony = async (repo: string) => {
			const current = await status();
			return current.colonies.find((entry) => entry.repository.root === repo);
		};
		const request = async (repo: string, title: string) => {
			const task = await tracker(repo, ["create", "--title", title, "--owner", "ct"]);
			const created = JSON.parse(
				await run([
					process.execPath,
					BEE,
					"spawn",
					"worker",
					task.id,
					"--repo",
					repo,
					"--beads-db",
					join(repo, ".beads", "beads.db"),
					"--actor",
					"smoke-seed",
					"--json",
				]),
			);
			return { identity: created.request.assignee, spawn: created.request.id, task: task.id };
		};
		const worker = async (repo: string, identity: string, attempt = ONE) => {
			const path = join(repo, `${identity}-${attempt}.json`);
			await until(`worker ${identity} attempt ${attempt}`, () => Bun.file(path).exists());
			return Bun.file(path).json();
		};
		const activity = async (id: string) => {
			const rows = await tracker(target, ["show", id]);
			return latestStdoutActivity(beadSchema.parse(rows[FIRST]));
		};
		const output = async (record: { id: string; identity: string; attempt: number }) => {
			const marker = join(target, `${record.identity}-${record.attempt}.emit`);
			await Bun.write(marker, "write stdout");
			await until("stdout written with daemon down", () => Bun.file(`${marker}.done`).exists());
			const metadata = await stat(join(state, record.id, "stdout.log"));
			return metadata.mtime.toISOString();
		};
		const pass = async (title: string) => {
			const requested = await request(witness, title);
			const { identity } = requested;
			const record = await worker(witness, identity);
			await tracker(witness, ["close", requested.task]);
			await Bun.write(join(witness, `${identity}.release`), "complete");
			await until(`witness ${identity} stopped`, () => Promise.resolve(!alive(record.pid)));
		};
		const released = (task: string) =>
			until(`task ${task} released`, async () => {
				const rows = await tracker(target, ["show", task]);
				return rows[FIRST].status === "open" && rows[FIRST].assignee === undefined;
			});
		// eslint-disable-next-line unicorn/no-useless-undefined -- Lazy startup can fail before reporting ownership.
		let daemonPid: number | undefined = undefined;
		// eslint-disable-next-line unicorn/no-useless-undefined -- Sentinel starts only after private fixtures exist.
		let sentinel: ReturnType<typeof Bun.spawn> | undefined = undefined;
		const crash = async () => {
			const current = await status();
			process.kill(current.pid, "SIGKILL");
			await until("owned daemon killed", () => Promise.resolve(!alive(current.pid)));
			daemonPid = undefined;
		};
		const recover = async () => {
			await operation("wake", witness);
			({ pid: daemonPid } = await status());
		};
		let passed = false;
		try {
			await Promise.all(
				repos.map(async (repo) => {
					await mkdir(repo);
					await run(["git", "init"], repo);
					await tracker(repo, ["init", "--prefix", "smoke"]);
					await writeFixture(repo);
				}),
			);
			sentinel = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], {
				cwd: root,
				env,
				stderr: "ignore",
				stdout: "ignore",
			});
			const sentinelTask = await tracker(target, [
				"create",
				"--title",
				"Unrelated task",
				"--owner",
				"ct",
				"--assignee",
				"sentinel-owner",
			]);
			const live = await request(target, "Surviving execution");
			await operation("wake", target);
			({ pid: daemonPid } = await status());
			await operation("wake", witness);
			await operation("wake", temporary, ["--temp"]);
			const original = await worker(target, live.identity);
			const beforeOutput = await activity(live.spawn);
			expect(beforeOutput?.lastOutputAt).toBeNull();
			await crash();
			expect(alive(original.pid)).toBe(true);
			const downOutputAt = await output(original);
			await recover();
			await pass("gold-bright-wren");
			expect(await activity(live.spawn)).toMatchObject({
				attemptId: original.id,
				attemptNumber: ONE,
				lastOutputAt: downOutputAt,
			});
			expect(await colony(temporary)).toBeUndefined();
			expect(await colony(target)).toMatchObject({
				intent: "awake",
				registration: "durable",
				state: "awake",
			});
			const adopted = await colony(target);
			expect(adopted?.attempts).toHaveLength(ONE);
			expect(adopted?.attempts[FIRST]?.id).toBe(original.id);
			expect(alive(original.pid)).toBe(true);
			expect(alive(sentinel.pid)).toBe(true);
			await operation("sleep", target);
			await tracker(target, ["close", live.spawn]);
			await pass("white-soft-deer");
			const sleepingTask = await tracker(target, ["show", live.task]);
			expect(sleepingTask[FIRST]).toMatchObject({
				assignee: live.identity,
				status: "in_progress",
			});
			expect(alive(original.pid)).toBe(true);
			await crash();
			await recover();
			await pass("black-bold-rook");
			expect(await colony(target)).toMatchObject({ intent: "asleep", state: "asleep" });
			expect(alive(original.pid)).toBe(true);
			await operation("wake", target);
			await until("sleeping cancellation stops original worker", () =>
				Promise.resolve(!alive(original.pid)),
			);
			await released(live.task);
			const dead = await request(target, "Dead execution");
			const first = await worker(target, dead.identity);
			await crash();
			const deadOutputAt = await output(first);
			process.kill(first.pid, "SIGKILL");
			await until("owned worker killed while daemon down", () =>
				Promise.resolve(!alive(first.pid)),
			);
			await recover();
			const replacement = await worker(target, dead.identity, TWO);
			expect(replacement).toMatchObject({ attempt: TWO, identity: dead.identity });
			expect(replacement.id).not.toBe(first.id);
			expect(await activity(dead.spawn)).toMatchObject({
				attemptId: replacement.id,
				attemptNumber: TWO,
				// eslint-disable-next-line unicorn/no-null -- Retry must not inherit the dead attempt's stdout.
				lastOutputAt: null,
			});
			const history = await tracker(target, ["show", dead.spawn]);
			expect(JSON.stringify(history[FIRST].comments)).toContain(deadOutputAt);
			const retried = await colony(target);
			expect(retried?.attempts.filter((attempt) => attempt.spawnId === dead.spawn)).toHaveLength(
				TWO,
			);
			await tracker(target, ["close", dead.spawn]);
			await until("awake cancellation stops replacement", () =>
				Promise.resolve(!alive(replacement.pid)),
			);
			await released(dead.task);
			const removed = await request(target, "Removed colony execution");
			const detached = await worker(target, removed.identity);
			const retained = await operation("remove", target);
			expect(retained).toMatchObject({
				attempts: expect.arrayContaining([expect.objectContaining({ id: detached.id })]),
				kind: "removed",
			});
			await tracker(target, ["close", removed.spawn]);
			await pass("silver-fair-seal");
			expect(alive(detached.pid)).toBe(true);
			expect(await colony(target)).toBeUndefined();
			await operation("add", target);
			expect(await colony(target)).toMatchObject({ intent: "asleep", state: "asleep" });
			expect(alive(detached.pid)).toBe(true);
			await operation("wake", target);
			await until("readded cancellation stops detached worker", () =>
				Promise.resolve(!alive(detached.pid)),
			);
			await released(removed.task);
			expect(alive(sentinel.pid)).toBe(true);
			const sentinelPid = sentinel.pid;
			await Promise.all(
				[original, replacement, detached].map(async (record) => {
					const cleanup = await Bun.file(join(state, record.id, "cleanup.json")).json();
					const launch = await Bun.file(join(state, record.id, "receipt.json")).json();
					expect(cleanup.token).toBe(launch.token);
					expect(cleanup.processes).toEqual(
						expect.arrayContaining([expect.objectContaining({ pid: record.pid })]),
					);
					expect(
						cleanup.processes.some((entry: { pid: number }) => entry.pid === sentinelPid),
					).toBe(false);
				}),
			);
			const unrelated = await tracker(target, ["show", sentinelTask.id]);
			expect(unrelated[FIRST]).toMatchObject({ assignee: "sentinel-owner", status: "open" });
			passed = true;
		} catch (error) {
			throw new Error(`Recovery smoke artifacts retained at ${root}`, { cause: error });
		} finally {
			await Promise.all(repos.map((repo) => Bun.write(join(repo, "release"), "cleanup")));
			try {
				await cleanupDaemon(socket, daemonPid);
			} finally {
				await cleanupWorkers(state);
				if (sentinel) {
					sentinel.kill();
					await sentinel.exited;
				}
			}
			if (passed) {
				await rm(root, { force: true, recursive: true });
			}
		}
	},
	SMOKE_TIMEOUT,
);

// --- Private functions ---
async function writeFixture(repo: string): Promise<void> {
	await Bun.write(
		join(repo, ".hive", "bees.toml"),
		`owner="ct"
humans=["ct"]
ranking="fifo"
retry_delay_ms=0
[kinds.worker]
description = "Implement the linked task beads and verify their outcomes."
harness="fixture"
model="fixture"
effort="low"
prompt="fixture"
[formulas.fixture]
executable=${JSON.stringify(process.execPath)}
argv=[${JSON.stringify(join(repo, "worker.ts"))}]
`,
	);
	await Bun.write(
		join(repo, "worker.ts"),
		`
const repo=${JSON.stringify(repo)};
const identity=process.env.HIVE_AGENT_NAME;
const attempt=Number(process.env.HIVE_ATTEMPT_NUMBER);
await Bun.write(repo+"/"+identity+"-"+attempt+".json",JSON.stringify({attempt,id:process.env.HIVE_ATTEMPT_ID,identity,pid:process.pid}));
const deadline=Date.now()+90000;
const emit=repo+"/"+identity+"-"+attempt+".emit";
let emitted=false;
while(!(await Bun.file(repo+"/release").exists())&&!(await Bun.file(repo+"/"+identity+".release").exists())){
 if(!emitted&&await Bun.file(emit).exists()){
  console.log("actual fixture stdout");
  emitted=true;
  await Bun.write(emit+".done","written");
 }
 if(Date.now()>=deadline)throw new Error("Fixture deadline expired");
 await Bun.sleep(20);
}
`,
	);
}

async function until(label: string, condition: () => Promise<boolean>): Promise<void> {
	const deadline = Date.now() + DEADLINE;
	/* eslint-disable no-await-in-loop -- Bounded polling yields only while an observable condition is unmet. */
	while (!(await condition())) {
		if (Date.now() >= deadline) {
			throw new Error(`Timed out waiting for ${label}`);
		}
		await Bun.sleep(POLL_INTERVAL);
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

// eslint-disable-next-line max-statements -- Identify and stop only the server bound to the private test socket, including failed wake startup.
async function cleanupDaemon(socket: string, knownPid: number | undefined): Promise<void> {
	let pid = knownPid;
	try {
		const exists = await access(socket).then(
			() => true,
			() => false,
		);
		if (exists) {
			const request = async (kind: "status" | "stop") => {
				const response = await fetch("http://localhost/", {
					body: JSON.stringify({ kind }),
					method: "POST",
					signal: AbortSignal.timeout(DEADLINE),
					unix: socket,
				});
				return colonyResponseSchema.parse(await response.json());
			};
			const current = await request("status");
			if (current.kind !== "status") {
				throw new Error(`Cannot identify owned daemon at ${socket}: ${JSON.stringify(current)}`);
			}
			({ pid } = current);
			const stopped = await request("stop");
			if (stopped.kind !== "stopped") {
				throw new Error(`Cannot stop owned daemon at ${socket}: ${JSON.stringify(stopped)}`);
			}
			await until("private daemon cleanup", () => Promise.resolve(!alive(current.pid)));
		}
	} finally {
		if (pid !== undefined && alive(pid)) {
			process.kill(pid, "SIGTERM");
			const ownedPid = pid;
			await until("terminated private daemon", () => Promise.resolve(!alive(ownedPid)));
		}
	}
}

async function cleanupWorkers(state: string): Promise<void> {
	const entries = await readdir(state, { withFileTypes: true }).catch(() => []);
	await Promise.all(
		entries
			.filter((entry) => entry.isDirectory())
			.map(async (entry) => {
				const file = Bun.file(join(state, entry.name, "worker.json"));
				if (!(await file.exists())) {
					return;
				}
				const worker = await file.json();
				for (const pid of [worker.harnessPid, worker.supervisorPid]) {
					if (typeof pid === "number" && alive(pid)) {
						process.kill(pid, "SIGTERM");
					}
				}
			}),
	);
}

function parseCliResponse(output: string): ColonyResponse {
	const { ok, ...response } = JSON.parse(output);
	expect(ok).toBe(true);
	return colonyResponseSchema.parse(response);
}
