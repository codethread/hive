import { CommandError, colonyResponseSchema, execute } from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Disposable real tracker and process artifacts.
import { access, mkdir, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
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
const DEADLINE = 15_000;
const POLL_INTERVAL = 20;
const SMOKE_TIMEOUT = 90_000;
const COLONY = new URL("../bin/colony.ts", import.meta.url).pathname;
const BEE = new URL("../bin/bee.ts", import.meta.url).pathname;

test(
	"self-report preserves partial blocked work across recovery and validates attempt-scoped success",
	// eslint-disable-next-line max-statements -- One native lifecycle fixture keeps daemon, tracker and worker cleanup together.
	async () => {
		const temporary = await mkdtemp(join(tmpdir(), "bee-finish-"));
		const root = await realpath(temporary);
		const repo = join(root, "repo");
		const state = join(root, "state");
		const socket = join(root, "daemon.sock");
		const database = join(repo, ".beads", "beads.db");
		const env = { ...process.env, BD_ACTOR: "smoke-seed", BEADS_DB: database };
		const run = (args: string[], override: Record<string, string | undefined> = env) =>
			execute(args, repo, override);
		const br = async (args: string[]) =>
			JSON.parse(await run(["br", ...args, "--db", database, "--actor", "smoke-seed", "--json"]));
		const show = async (id: string) => {
			const rows = await br(["show", id]);
			return rows[FIRST];
		};
		const bee = async (args: string[]) =>
			JSON.parse(
				await run([
					process.execPath,
					BEE,
					...args,
					"--repo",
					repo,
					"--beads-db",
					database,
					"--json",
				]),
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
		const operation = (kind: string) => client([kind, "--repo", repo, "--beads-db", database]);
		const inspect = async () => {
			const value = await operation("inspect");
			if (value.kind !== "inspection") {
				throw new Error("Expected inspection");
			}
			return value;
		};
		const task = async (title: string) => {
			const created = await br(["create", "--title", title, "--owner", "ct"]);
			return created.id as string;
		};
		const spawn = async (ids: string[]) => {
			const created = await bee(["spawn", "worker", ...ids]);
			return created.request.id as string;
		};
		const worker = async (id: string, attempt = ONE) => {
			const path = join(repo, `${id}-${attempt}.json`);
			await until("worker started", () => Bun.file(path).exists());
			return Bun.file(path).json();
		};
		const report = async (record: { env: Record<string, string | undefined> }, args: string[]) =>
			JSON.parse(
				await run([process.execPath, BEE, "finish", ...args, "--json"], { ...env, ...record.env }),
			);
		const terminal = (id: string) =>
			until("request settled", async () => {
				const current = await inspect();
				return current.requests.some((entry) => entry.id === id && entry.state === "terminal");
			});
		// eslint-disable-next-line unicorn/no-useless-undefined -- Startup may fail before returning a PID.
		let daemonPid: number | undefined = undefined;
		let passed = false;
		try {
			await mkdir(repo);
			await run(["git", "init"]);
			await br(["init", "--prefix", "smoke"]);
			await writeFixture(repo);
			const done = await task("Complete possible work");
			const blocked = await task("Requires external credential");
			const original = await spawn([done, blocked]);
			await operation("wake");
			const status = await client(["list"]);
			if (status.kind !== "status") {
				throw new Error("Expected daemon status");
			}
			daemonPid = status.pid;
			const first = await worker(original);
			await br(["close", done]);
			await br([
				"update",
				blocked,
				"--status",
				"blocked",
				"--append-notes",
				"Operator must supply credential",
			]);
			await operation("sleep");
			await expect(report(first, ["blocked"])).rejects.toBeInstanceOf(CommandError);
			await expect(report(first, ["blocked", "--reason", "   "])).rejects.toBeInstanceOf(
				CommandError,
			);
			await expect(
				report({ env: { ...first.env, HIVE_ATTEMPT_TOKEN: crypto.randomUUID() } }, ["success"]),
			).rejects.toBeInstanceOf(CommandError);
			const reason = "Credential unavailable; operator must supply it before retry";
			expect(await report(first, ["blocked", "--reason", reason])).toMatchObject({
				kind: "finish_submitted",
				ok: true,
				requestId: original,
			});
			expect(await report(first, ["blocked", "--reason", reason])).toMatchObject({ ok: true });
			await expect(report(first, ["success"])).rejects.toBeInstanceOf(CommandError);
			await Bun.write(join(repo, `${first.id}.release`), "exit after handoff");
			await until("worker exited while asleep", () => Promise.resolve(!alive(first.pid)));
			process.kill(daemonPid, "SIGKILL");
			await until("daemon crashed", () => Promise.resolve(!alive(status.pid)));
			daemonPid = undefined;
			await operation("wake");
			const restored = await client(["list"]);
			if (restored.kind !== "status") {
				throw new Error("Expected restored daemon");
			}
			daemonPid = restored.pid;
			await terminal(original);
			expect(await show(done)).toMatchObject({ status: "closed" });
			expect(await show(blocked)).toMatchObject({ status: "blocked" });
			const remaining = await show(blocked);
			expect(remaining.assignee).toBeUndefined();
			const observed = await bee(["status", original]);
			expect(observed.request).toMatchObject({
				closeReason: "blocked",
				disposition: { outcome: "failed", resolution: "unresolved" },
				needsAttention: true,
			});
			expect(observed.request.lastObservation.text).toContain(reason);
			expect(observed.request.lastObservation.text).toContain(blocked);
			expect(observed.request.lastObservation.text).toContain(first.id);
			await operation("sleep");
			await operation("wake");
			await operation("sleep");
			const paused = await inspect();
			expect(paused.attempts.filter((entry) => entry.spawnId === original)).toHaveLength(ONE);
			const retried = await bee(["retry", original]);
			const replacement = retried.request.id;
			const view = await bee(["status", replacement]);
			expect(view.request.tasks.map((entry: { id: string }) => entry.id)).toEqual([blocked]);
			expect(view.request.supersedes).toEqual([original]);
			const predecessor = await bee(["status", original]);
			expect(predecessor.request.disposition).toEqual({
				outcome: "failed",
				resolution: "resolved",
			});
			// Native blocking is an external prerequisite, not a state retry silently erases.
			await br(["update", blocked, "--status", "open"]);
			await operation("wake");
			const next = await worker(replacement);
			await report(first, ["blocked", "--reason", reason]);
			await br(["close", blocked]);
			// Drain a complete awake pass while the worker deliberately remains alive.
			await operation("sleep");
			await operation("wake");
			await operation("sleep");
			expect(alive(next.pid)).toBe(true);
			const live = await inspect();
			expect(live.requests.find((entry) => entry.id === replacement)?.state).toBe("executing");
			// Bypassing CLI validation still cannot give an old report current-attempt authority.
			const forged = join(state, next.id, "finish.json");
			await Bun.write(forged, await Bun.file(join(state, first.id, "finish.json")).text());
			await operation("wake");
			await until("stale report rejected by Colony", async () => {
				const current = await inspect();
				return current.colony?.state === "failed";
			});
			expect(alive(next.pid)).toBe(true);
			const rejected = await inspect();
			expect(rejected.requests.find((entry) => entry.id === replacement)?.state).toBe("executing");
			await rm(forged);
			await report(next, ["success"]);
			await operation("wake");
			await terminal(replacement);
			expect(alive(next.pid)).toBe(false);
			const completed = await bee(["status", replacement]);
			expect(completed.request.disposition).toEqual({
				outcome: "succeeded",
				resolution: "resolved",
			});

			const unfinished = await task("Success report must not cancel unfinished work");
			const retrying = await spawn([unfinished]);
			const attemptOne = await worker(retrying);
			await report(attemptOne, ["success"]);
			const attemptTwo = await worker(retrying, TWO);
			// Repeating a stale report has no authority over the new current attempt.
			await report(attemptOne, ["success"]);
			await operation("sleep");
			await operation("wake");
			await operation("sleep");
			expect(alive(attemptTwo.pid)).toBe(true);
			const current = await inspect();
			expect(current.requests.find((entry) => entry.id === retrying)?.attemptId).toBe(
				attemptTwo.id,
			);
			await report(attemptTwo, ["success"]);
			await operation("wake");
			await terminal(retrying);
			const exhausted = await bee(["status", retrying]);
			expect(exhausted.request).toMatchObject({
				closeReason: "exhausted",
				needsAttention: true,
			});
			const exhaustedRuntime = await inspect();
			expect(exhaustedRuntime.attempts.filter((entry) => entry.spawnId === retrying)).toHaveLength(
				TWO,
			);
			expect(await show(unfinished)).toMatchObject({ status: "open" });
			passed = true;
		} catch (error) {
			throw new Error(`Self-report artifacts retained at ${root}`, { cause: error });
		} finally {
			await cleanupDaemon(socket, daemonPid);
			await cleanupWorkers(state);
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
		join(repo, "bees.toml"),
		`owner="ct"
humans=["ct"]
ranking="fifo"
max_retries=1
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
const env = process.env;
const id = env.HIVE_ATTEMPT_ID;
await Bun.write(${JSON.stringify(repo)}+"/"+env.HIVE_SPAWN_ID+"-"+env.HIVE_ATTEMPT_NUMBER+".json", JSON.stringify({ env: { HIVE_COLONY_STATE: env.HIVE_COLONY_STATE, HIVE_SPAWN_ID: env.HIVE_SPAWN_ID, HIVE_ATTEMPT_ID: id, HIVE_ATTEMPT_TOKEN: env.HIVE_ATTEMPT_TOKEN }, id, pid: process.pid }));
const deadline = Date.now()+90000;
while(!(await Bun.file(${JSON.stringify(repo)}+"/"+id+".release").exists())) {
 if(Date.now() >= deadline) throw new Error("Fixture deadline expired");
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
