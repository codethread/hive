// eslint-disable-next-line import/no-nodejs-modules -- Disposable native trackers, missing-config inspection and owned cleanup.
import { access, cp, mkdir, mkdtemp, readdir, realpath, rm, stat } from "node:fs/promises";
import { colonyResponseSchema, execute } from "@hive/shared";
import { expect, test } from "bun:test";
import type { ColonyResponse } from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Private fixture paths.
import { join } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Private OS temporary fixture root.
import { tmpdir } from "node:os";

const SUCCESS = 0;
const FIRST = 0;
const POLL_INTERVAL = 20;
const DEADLINE = 15_000;
const SMOKE_TIMEOUT = 60_000;
const COLONY = new URL("../bin/colony.ts", import.meta.url).pathname;
const BEE = new URL("../bin/bee.ts", import.meta.url).pathname;
const PRIVATE_LOG = "PRIVATE-FIXTURE-LOG";

test(
	"Bee inspects and closes only its selected tracker offline and distinguishes asleep observations from later cancellation",
	// eslint-disable-next-line max-statements -- Offline and live phases share selected tracker authority and strict owned cleanup.
	async () => {
		const directory = await mkdtemp(join(tmpdir(), "bee-inspection-"));
		const root = await realpath(directory);
		const target = join(root, "target");
		const witness = join(root, "witness");
		const alternate = join(root, "alternate");
		const state = join(root, "state");
		const socket = join(root, "daemon.sock");
		const env = {
			...process.env,
			BD_ACTOR: "environment-actor",
			BEADS_DB: join(alternate, ".beads", "beads.db"),
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
		const bee = (repo: string, args: string[]) =>
			run([
				process.execPath,
				BEE,
				...args,
				"--repo",
				repo,
				"--beads-db",
				join(repo, ".beads", "beads.db"),
			]);
		const inspect = async (id: string) => JSON.parse(await bee(target, ["status", id, "--json"]));
		const stop = async (id: string) =>
			JSON.parse(await bee(target, ["stop", id, "--actor", "stop-actor", "--json"]));
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
		const operation = (kind: string, repo: string) =>
			client([kind, "--repo", repo, "--beads-db", join(repo, ".beads", "beads.db")]);
		const request = async (repo: string, title: string) => {
			const task = await tracker(repo, ["create", "--title", title, "--owner", "ct"]);
			const created = JSON.parse(
				await bee(repo, ["spawn", "worker", task.id, "--actor", "smoke-seed", "--json"]),
			);
			return { identity: created.request.assignee, spawn: created.request.id, task: task.id };
		};
		const worker = async (repo: string, identity: string) => {
			const path = join(repo, `${identity}.json`);
			await until(`worker ${identity}`, () => Bun.file(path).exists());
			return Bun.file(path).json();
		};
		const observed = async (id: string, outcome: string) => {
			await until(`last observation ${outcome}`, async () => {
				const current = await inspect(id);
				return current.request.lastObservation?.text.toLowerCase().includes(outcome) === true;
			});
			return inspect(id);
		};
		const pass = async () => {
			const work = await request(witness, "gold-bright-wren");
			const running = await worker(witness, work.identity);
			await tracker(witness, ["close", work.task]);
			await Bun.write(join(witness, "release"), "complete");
			await until("awake witness completed", () => Promise.resolve(!alive(running.pid)));
		};
		// eslint-disable-next-line unicorn/no-useless-undefined -- Lazy daemon ownership is unknown until status succeeds.
		let daemonPid: number | undefined = undefined;
		let passed = false;
		try {
			await Promise.all(
				[target, witness, alternate].map(async (repo) => {
					await mkdir(repo);
					await run(["git", "init"], repo);
				}),
			);
			await Promise.all(
				[target, witness].map(async (repo) => {
					await execute(["br", "init", "--prefix", "smoke"], repo, { ...env, BEADS_DB: undefined });
					await writeFixture(repo);
				}),
			);
			const queued = await request(target, "Queued work");
			const blocker = await tracker(target, ["create", "--title", "Dependency", "--owner", "ct"]);
			await tracker(target, ["dep", "add", queued.task, blocker.id]);
			await cp(join(target, ".beads"), join(alternate, ".beads"), { recursive: true });
			const canonical = await Bun.file(join(target, ".hive", "bees.toml")).text();
			await rm(join(target, ".hive", "bees.toml"));
			const offline = await inspect(queued.spawn);
			expect(offline).toMatchObject({
				kind: "request_status",
				repository: { beadsDb: join(target, ".beads", "beads.db"), root: target },
				request: {
					disposition: { outcome: "pending", resolution: "unresolved" },
					id: queued.spawn,
					identity: queued.identity,
					labelPublication: "current",
					status: "open",
					tasks: [{ id: queued.task, readiness: "blocked" }],
				},
			});
			expect(offline.request.lastObservation).toBeNull();
			expect(offline.request.stdoutActivity).toBeNull();
			const offlineHuman = await bee(target, ["status", queued.spawn]);
			expect(offlineHuman).toContain(`Request ${queued.spawn}: open`);
			expect(offlineHuman).toContain("blocked");
			expect(offlineHuman).toContain("Last recorded observation: none (execution state unknown)");
			const listing = JSON.parse(await bee(target, ["list", "--json"]));
			expect(listing.requests.map((entry: { id: string }) => entry.id)).toEqual([queued.spawn]);
			expect(await stop(queued.spawn)).toMatchObject({
				kind: "request_stopped",
				request: {
					disposition: { outcome: "cancelled", resolution: "resolved" },
					labelPublication: "current",
					status: "closed",
				},
			});
			const closed = await inspect(queued.spawn);
			expect(closed.request.lastObservation).toBeNull();
			expect(Number.isNaN(Date.parse(closed.request.closedAt))).toBe(false);
			const openOnly = JSON.parse(await bee(target, ["list", "--json"]));
			expect(openOnly.requests).toEqual([]);
			const all = JSON.parse(await bee(target, ["list", "--all", "--json"]));
			expect(all.requests.map((entry: { id: string }) => entry.id)).toEqual([queued.spawn]);
			const unselected = await tracker(alternate, ["show", queued.spawn]);
			expect(unselected[FIRST].status).toBe("open");
			await expect(stop(queued.task)).rejects.toBeInstanceOf(Error);
			expect(await Bun.file(join(state, "colony.sqlite")).exists()).toBe(false);
			expect(await Bun.file(socket).exists()).toBe(false);
			await Bun.write(join(target, ".hive", "bees.toml"), canonical);
			const awake = await request(target, "Awake work");
			await operation("wake", target);
			const current = await client(["list"]);
			if (current.kind !== "status") {
				throw new Error(JSON.stringify(current));
			}
			daemonPid = current.pid;
			await operation("wake", witness);
			const first = await worker(target, awake.identity);
			await observed(awake.spawn, "running");
			const firstOutput = await stat(join(state, first.id, "stdout.log"));
			const firstInspection = await inspect(awake.spawn);
			expect(firstInspection.request.stdoutActivity).toMatchObject({
				attemptId: first.id,
				attemptNumber: 1,
				lastOutputAt: firstOutput.mtime.toISOString(),
			});
			await stop(awake.spawn);
			await until("awake stop stopped process", () => Promise.resolve(!alive(first.pid)));
			const cancelled = await observed(awake.spawn, "cancelled");
			expect(cancelled.request.status).toBe("closed");
			expect(Number.isNaN(Date.parse(cancelled.request.lastObservation.createdAt))).toBe(false);
			const asleep = await request(target, "Sleeping work");
			const second = await worker(target, asleep.identity);
			await observed(asleep.spawn, "running");
			await operation("sleep", target);
			const beforeStop = await inspect(asleep.spawn);
			await Bun.write(join(target, "emit"), "write stdout while asleep");
			await until("stdout written while asleep", () => Bun.file(join(target, "emitted")).exists());
			const asleepOutput = await stat(join(state, second.id, "stdout.log"));
			await stop(asleep.spawn);
			await pass();
			const sleeping = await inspect(asleep.spawn);
			expect(sleeping.request.status).toBe("closed");
			expect(sleeping.request.lastObservation).toEqual(beforeStop.request.lastObservation);
			expect(sleeping.request.stdoutActivity).toEqual(beforeStop.request.stdoutActivity);
			expect(alive(second.pid)).toBe(true);
			const claimed = await tracker(target, ["show", asleep.task]);
			expect(claimed[FIRST]).toMatchObject({ assignee: asleep.identity, status: "in_progress" });
			const human = await bee(target, ["status", asleep.spawn]);
			expect(human).toContain(`Request ${asleep.spawn}: closed`);
			expect(human).toContain("Last recorded observation (");
			expect(human).toContain("Observations may be stale; daemon availability is not queried.");
			expect(human).toContain(sleeping.request.lastObservation.createdAt);
			expect(human).toContain(sleeping.request.lastObservation.text);
			expect(human).toContain(sleeping.request.stdoutActivity.lastOutputAt);
			expect(human).toContain("Stdout silence does not establish idle, stalled or dead execution.");
			await operation("wake", target);
			await until("wake stopped sleeping request", () => Promise.resolve(!alive(second.pid)));
			const settled = await observed(asleep.spawn, "cancelled");
			expect(settled.request.lastObservation).not.toEqual(beforeStop.request.lastObservation);
			expect(settled.request.stdoutActivity).toMatchObject({
				attemptId: second.id,
				attemptNumber: 1,
				lastOutputAt: asleepOutput.mtime.toISOString(),
			});
			expect(settled.request.stdoutActivity.lastOutputAt).not.toBe(
				beforeStop.request.stdoutActivity.lastOutputAt,
			);
			const released = await tracker(target, ["show", asleep.task]);
			expect(released[FIRST].assignee).toBeUndefined();
			const native = await tracker(target, ["show", asleep.spawn]);
			expect(native[FIRST].comments).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ created_at: settled.request.lastObservation.createdAt }),
				]),
			);
			expect(JSON.stringify(native[FIRST].comments)).not.toContain(PRIVATE_LOG);
			expect(native[FIRST].notes).toBeFalsy();
			const sentinel = await tracker(alternate, ["show", queued.spawn]);
			expect(sentinel[FIRST].status).toBe("open");
			passed = true;
		} catch (error) {
			throw new Error(`Bee inspection smoke artifacts retained at ${root}`, { cause: error });
		} finally {
			await Promise.all(
				[target, witness].map((repo) => Bun.write(join(repo, "release"), "cleanup")),
			);
			try {
				await cleanupDaemon(socket, daemonPid);
			} finally {
				await cleanupWorkers(state);
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
console.log(${JSON.stringify(PRIVATE_LOG)});
await Bun.write(repo+"/"+process.env.HIVE_AGENT_NAME+".json",JSON.stringify({id:process.env.HIVE_ATTEMPT_ID,pid:process.pid}));
const deadline=Date.now()+60000;
let emitted=false;
while(!(await Bun.file(repo+"/release").exists())){
 if(!emitted&&await Bun.file(repo+"/emit").exists()){
  console.log(${JSON.stringify(PRIVATE_LOG)});
  emitted=true;
  await Bun.write(repo+"/emitted","done");
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
