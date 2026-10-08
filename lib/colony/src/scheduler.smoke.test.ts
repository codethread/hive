// eslint-disable-next-line import/no-nodejs-modules -- Real private tracker, launch directories, and owned cleanup.
import { access, mkdir, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
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
const DEADLINE = 10_000;
const SMOKE_TIMEOUT = 90_000;
const COLONY = new URL("../bin/colony.ts", import.meta.url).pathname;
const BEE = new URL("../bin/bee.ts", import.meta.url).pathname;

test(
	"real scheduler ranks ready related tasks and applies non-preemptive colony, kind and launch-bucket limits",
	// eslint-disable-next-line max-statements -- Keep one sequential scheduler scenario and its owned teardown together.
	async () => {
		const directory = await mkdtemp(join(tmpdir(), "colony-scheduler-"));
		const root = await realpath(directory);
		const repo = join(root, "repo");
		const state = join(root, "state");
		const socket = join(root, "daemon.sock");
		const bucketB = join(root, "bucket-b");
		const env = {
			...process.env,
			BD_ACTOR: "smoke-seed",
			BEADS_DB: join(repo, ".beads", "beads.db"),
			XDG_STATE_HOME: join(root, "unused"),
		};
		const run = (args: string[], cwd = root) => execute(args, cwd, env);
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
		const wake = () => client(["wake", "--repo", repo, "--beads-db", env.BEADS_DB]);
		const tracker = async (args: string[]) =>
			JSON.parse(
				await run(["br", ...args, "--db", env.BEADS_DB, "--actor", "smoke-seed", "--json"], repo),
			);
		const task = async (title: string, priority = "2") => {
			const created = await tracker([
				"create",
				"--title",
				title,
				"--owner",
				"ct",
				"--priority",
				priority,
			]);
			return created.id as string;
		};
		const workerAtA = { cwd: repo, kind: "worker" };
		const request = async (tasks: string[], options = workerAtA) => {
			const created = JSON.parse(
				await run([
					process.execPath,
					BEE,
					"spawn",
					options.kind,
					...tasks,
					"--repo",
					repo,
					"--beads-db",
					env.BEADS_DB,
					"--actor",
					"smoke-seed",
					"--cwd",
					options.cwd,
					"--json",
				]),
			);
			return { identity: created.request.assignee as string, spawn: created.request.id as string };
		};
		const started = (name: string) => Bun.file(join(root, `${name}.json`)).exists();
		const waitStarted = (name: string) => until(`worker ${name}`, () => started(name));
		const release = async (name: string) => {
			await Bun.write(join(root, `${name}.release`), "release");
			const worker = await Bun.file(join(root, `${name}.json`)).json();
			await until(`worker ${name} exited`, () => Promise.resolve(!alive(worker.pid)));
		};
		const status = async () => {
			const result = await client(["list"]);
			if (result.kind !== "status") {
				throw new Error(JSON.stringify(result));
			}
			return result;
		};
		const pass = async (name: string) => {
			const closed = await task(name);
			await tracker(["close", closed]);
			const requested = await request([closed]);
			await until(`scheduler reconciled ${name}`, async () => {
				const rows = await tracker(["show", requested.spawn]);
				return rows[FIRST].status === "closed";
			});
			expect(await started(requested.identity)).toBe(false);
		};
		// eslint-disable-next-line unicorn/no-useless-undefined -- Lazy startup may fail before reporting its PID.
		let daemonPid: number | undefined = undefined;
		let passed = false;
		try {
			await Promise.all([repo, bucketB].map((path) => mkdir(path)));
			await run(["git", "init", "-b", "main"], repo);
			await run(["git", "init", "--bare", join(root, "remote.git")], repo);
			await run(["git", "remote", "add", "origin", join(root, "remote.git")], repo);
			await run(
				[
					"git",
					"-c",
					"user.name=Smoke",
					"-c",
					"user.email=smoke@example.invalid",
					"commit",
					"--allow-empty",
					"-m",
					"fixture",
				],
				repo,
			);
			await run(["git", "push", "-u", "origin", "main"], repo);
			await run(["honeycomb", "--cwd", repo, "add", "--branch", "fixture", "--base-current"]);
			const linkedOutput = await run(["honeycomb", "--cwd", repo, "path", "--branch", "fixture"]);
			const bucketA = await realpath(linkedOutput.trim());
			const workerDirectory = join(bucketA, "worker");
			const reviewerDirectory = join(bucketA, "reviewer");
			await Promise.all([workerDirectory, reviewerDirectory].map((path) => mkdir(path)));
			workerAtA.cwd = workerDirectory;
			await tracker(["init", "--prefix", "smoke"]);
			await writeWorker(root);
			await writeConfig(repo, root, { colony: 1, kind: 4, worktree: 4 });
			const holding = await request([await task("holder")]);
			await wake();
			({ pid: daemonPid } = await status());
			await waitStarted(holding.identity);
			const blocker = await task("dependency");
			const blocked = await task("blocked", "0");
			await tracker(["dep", "add", blocked, blocker]);
			const ready = await task("ready", "0");
			const satisfied = await task("already satisfied", "0");
			await tracker(["close", satisfied]);
			const multi = await request([blocked, ready, satisfied]);
			const low = await request([await task("P1", "1")]);
			const high = await request([await task("P0", "0")]);
			await pass("closed-before-launch");
			await release(holding.identity);
			await waitStarted(high.identity);
			expect(await started(low.identity)).toBe(false);
			expect(await started(multi.identity)).toBe(false);
			await release(high.identity);
			await waitStarted(low.identity);
			expect(await started(multi.identity)).toBe(false);
			await release(low.identity);
			await pass("blocked-poll");
			expect(await started(multi.identity)).toBe(false);
			await tracker(["close", blocker]);
			await waitStarted(multi.identity);
			await release(multi.identity);
			await client(["sleep", "--repo", repo, "--beads-db", env.BEADS_DB]);
			await writeConfig(repo, root, { colony: 3, kind: 2, worktree: 2 });
			const workerAOne = await request([await task("worker a one")]);
			const workerATwo = await request([await task("worker a two")]);
			await wake();
			await Promise.all([waitStarted(workerAOne.identity), waitStarted(workerATwo.identity)]);
			const workerB = await request([await task("worker b")], { cwd: bucketB, kind: "worker" });
			const reviewerA = await request([await task("reviewer a")], {
				cwd: reviewerDirectory,
				kind: "reviewer",
			});
			const reviewerB = await request([await task("reviewer b")], {
				cwd: bucketB,
				kind: "reviewer",
			});
			await waitStarted(reviewerB.identity);
			await pass("three-scopes-full");
			expect(await started(workerB.identity)).toBe(false);
			expect(await started(reviewerA.identity)).toBe(false);
			const capacities = await status();
			expect(capacities.colonies[FIRST]?.policy).toMatchObject({
				limits: { colony: 3, kind: 2, worktree: 2 },
				ranking: "fifo",
			});
			const running = await Promise.all(
				[workerAOne.identity, workerATwo.identity, reviewerB.identity].map((name) =>
					Bun.file(join(root, `${name}.json`)).json(),
				),
			);
			expect(running.map((worker) => worker.cwd)).toEqual([
				workerDirectory,
				workerDirectory,
				bucketB,
			]);
			const receipts = await Promise.all(
				capacities.colonies[FIRST]!.attempts.map((attempt) =>
					Bun.file(join(state, attempt.id, "receipt.json")).json(),
				),
			);
			expect(
				receipts
					.filter((receipt) =>
						[workerAOne.identity, workerATwo.identity, reviewerB.identity].includes(
							receipt.identity,
						),
					)
					.map((receipt) => receipt.bucket),
			).toEqual([bucketA, bucketA, bucketB]);
			await writeConfig(repo, root, { colony: 1, kind: 2, worktree: 2 });
			await wake();
			await pass("lowered-cap");
			expect(running.every((worker) => alive(worker.pid))).toBe(true);
			expect(await started(workerB.identity)).toBe(false);
			expect(await started(reviewerA.identity)).toBe(false);
			await release(workerAOne.identity);
			await pass("occupancy-two");
			expect(await started(workerB.identity)).toBe(false);
			expect(await started(reviewerA.identity)).toBe(false);
			await release(workerATwo.identity);
			await pass("occupancy-one");
			expect(await started(workerB.identity)).toBe(false);
			expect(await started(reviewerA.identity)).toBe(false);
			await release(reviewerB.identity);
			await waitStarted(workerB.identity);
			expect(await started(reviewerA.identity)).toBe(false);
			await release(workerB.identity);
			await waitStarted(reviewerA.identity);
			passed = true;
		} catch (error) {
			throw new Error(`Scheduler smoke artifacts retained at ${root}`, { cause: error });
		} finally {
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
async function writeConfig(
	repo: string,
	root: string,
	limits: { colony: number; kind: number; worktree: number },
): Promise<void> {
	await Bun.write(
		join(repo, "bees.toml"),
		`owner="ct"
humans=["ct"]
ranking="fifo"
[limits]
colony=${limits.colony}
kind=${limits.kind}
worktree=${limits.worktree}
[kinds.worker]
description = "Implement the linked task beads and verify their outcomes."
harness="fixture"
model="fixture"
effort="low"
prompt="fixture"
[kinds.reviewer]
description = "Review code, tests and documentation against repository standards."
harness="fixture"
model="fixture"
effort="low"
prompt="fixture"
[formulas.fixture]
executable=${JSON.stringify(process.execPath)}
argv=[${JSON.stringify(join(root, "worker.ts"))}]
`,
	);
}
async function writeWorker(root: string): Promise<void> {
	await Bun.write(
		join(root, "worker.ts"),
		`
const root=${JSON.stringify(root)};
const name=process.env.HIVE_AGENT_NAME;
await Bun.write(root+"/"+name+".json", JSON.stringify({pid:process.pid, cwd:process.cwd()}));
const deadline=Date.now()+90000;
while (!(await Bun.file(root+"/"+name+".release").exists())) {
 if (Date.now()>=deadline) throw new Error("Fixture deadline expired");
 await Bun.sleep(20);
}
const receipt=await Bun.file(process.env.HIVE_COLONY_STATE+"/"+process.env.HIVE_ATTEMPT_ID+"/receipt.json").json();
const close=Bun.spawn(["br","close",...receipt.taskIds,"--actor",process.env.BD_ACTOR,"--db",process.env.BEADS_DB,"--json"], {env:process.env,stdout:"ignore",stderr:"inherit"});
if (await close.exited !== 0) throw new Error("Fixture task completion failed");
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
