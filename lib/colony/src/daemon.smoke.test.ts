/* eslint-disable unicorn/no-null -- Persisted request fixtures explicitly encode absent attempt, pending claim and retry time. */
// eslint-disable-next-line import/no-nodejs-modules -- Disposable real repository and tracker fixtures.
import { access, cp, mkdir, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { colonyResponseSchema, execute } from "@hive/shared";
import { expect, test } from "bun:test";
import type { ColonyResponse } from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve owned fixture paths.
import { join } from "node:path";
import { openStore } from "./store.ts";
import { subscribeColonyEvents } from "@hive/shared/colony-events/client";
// eslint-disable-next-line import/no-nodejs-modules -- Private OS temporary fixture root.
import { tmpdir } from "node:os";

const FIRST = 0;
const SUCCESS = 0;
const ONE_ATTEMPT = 1;
const TWO_REPOSITORIES = 2;
const POLL_INTERVAL = 20;
const DEADLINE = 10_000;
const SMOKE_TIMEOUT = 30_000;
const COLONY = new URL("../bin/colony.ts", import.meta.url).pathname;
const BEE = new URL("../bin/bee.ts", import.meta.url).pathname;

test(
	"private lazy daemon routes colliding task IDs to independent repositories and leaves workers alive on stop",
	// eslint-disable-next-line max-statements -- One real daemon lifecycle shares disposable repositories and teardown.
	async () => {
		const temporary = await mkdtemp(join(tmpdir(), "colony-daemon-"));
		const root = await realpath(temporary);
		const state = join(root, "state");
		const socket = join(root, "server.sock");
		const defaultState = join(root, "default-state");
		const repos = [join(root, "first"), join(root, "second")];
		const env = {
			...process.env,
			BD_ACTOR: "smoke-seed",
			BEADS_DB: join(root, "unused.db"),
			XDG_STATE_HOME: defaultState,
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
		const status = async () => {
			const result = await client(["daemon", "status"]);
			if (result.kind !== "status") {
				throw new Error(JSON.stringify(result));
			}
			return result;
		};
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
		// eslint-disable-next-line unicorn/no-useless-undefined -- Explicit initialization required; absent until the daemon reports ownership.
		let daemonPid: number | undefined = undefined;
		let passed = false;
		let attempts: string[] = [];
		const identities = new Map<string, string>();
		try {
			await mkdir(defaultState);
			await Promise.all(
				repos.map(async (repo) => {
					await mkdir(repo);
					await run(["git", "init"], repo);
				}),
			);
			const first = repos[FIRST]!;
			await tracker(first, ["init", "--prefix", "smoke"]);
			const task = await tracker(first, [
				"create",
				"--title",
				"Same task ID in both trackers",
				"--owner",
				"ct",
			]);
			const second = repos.at(-ONE_ATTEMPT)!;
			await cp(join(first, ".beads"), join(second, ".beads"), { recursive: true });
			await Promise.all(
				repos.map(async (repo) => {
					await run([
						process.execPath,
						COLONY,
						"init",
						"--repo",
						repo,
						"--owner",
						"ct",
						"--model",
						"fixture",
						"--json",
					]);
					await writeWorker(repo, task.id);
					const canonicalConfig = await Bun.file(join(repo, ".hive", "bees.toml")).text();
					const config = canonicalConfig.replace('ranking = "bv-pagerank"', 'ranking = "fifo"');
					await Bun.write(
						join(repo, ".hive", "bees.toml"),
						`${config}\n[formulas.fixture]\nexecutable=${JSON.stringify(process.execPath)}\nargv=[${JSON.stringify(join(repo, "worker.ts"))}]\n`,
					);
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
							"smoke-requester",
							"--harness",
							"fixture",
							"--json",
						]),
					);
					identities.set(repo, created.request.assignee);
				}),
			);
			const customSocket = Bun.spawn(
				[process.execPath, COLONY, "daemon", "status", "--socket", socket, "--json"],
				{ cwd: root, env, stderr: "pipe", stdout: "pipe" },
			);
			const [customOut, customErr, customCode] = await Promise.all([
				new Response(customSocket.stdout).text(),
				new Response(customSocket.stderr).text(),
				customSocket.exited,
			]);
			expect(customCode).not.toBe(SUCCESS);
			expect(customErr).toBe("");
			expect(JSON.parse(customOut)).toEqual({
				kind: "error",
				message: "--socket requires an explicit --state directory",
				ok: false,
				reason: "operation_failed",
			});
			// A rejected wake can leave a successfully started daemon before any PID was returned.
			const firstConfig = await Bun.file(join(first, ".hive", "bees.toml")).text();
			await Bun.write(join(first, ".hive", "bees.toml"), "invalid canonical config");
			await expect(
				client(["wake", "--repo", first, "--beads-db", join(first, ".beads", "beads.db")]),
			).rejects.toBeInstanceOf(Error);
			await cleanupDaemon(socket, daemonPid);
			expect(
				await access(socket).then(
					() => true,
					() => false,
				),
			).toBe(false);
			await Bun.write(join(first, ".hive", "bees.toml"), firstConfig);
			// The first public wake owns lazy startup; the second registers with that server.
			/* eslint-disable no-await-in-loop -- Sequential wakes make server reuse explicit. */
			for (const repo of repos) {
				expect(
					await client(["wake", "--repo", repo, "--beads-db", join(repo, ".beads", "beads.db")]),
				).toEqual({
					kind: "awake",
					repository: { beadsDb: join(repo, ".beads", "beads.db"), root: repo },
				});
				const current = await status();
				daemonPid ??= current.pid;
				expect(current.pid).toBe(daemonPid);
			}
			/* eslint-enable no-await-in-loop */
			await until("both fixture workers started", async () => {
				const receipts = await Promise.all(
					repos.map((repo) => Bun.file(join(repo, "started.json")).exists()),
				);
				return receipts.every(Boolean);
			});
			await until("both attempts are running", async () => {
				const current = await status();
				return (
					current.colonies.length === TWO_REPOSITORIES &&
					current.colonies.every(
						(colony) =>
							colony.attempts.length === ONE_ATTEMPT && colony.attempts[FIRST]?.state === "running",
					)
				);
			});
			const running = await status();
			attempts = running.colonies.flatMap((colony) => colony.attempts.map((attempt) => attempt.id));
			expect(new Set(attempts).size).toBe(TWO_REPOSITORIES);
			await Promise.all(
				repos.map(async (repo) => {
					expect(await Bun.file(join(repo, "started.json")).json()).toEqual({
						actor: identities.get(repo),
						cwd: repo,
						db: join(repo, ".beads", "beads.db"),
						identity: identities.get(repo),
						kind: "worker",
					});
					const rows = await tracker(repo, ["show", task.id]);
					expect(rows[FIRST].notes).toBe(identities.get(repo));
					await client(["wake", "--repo", repo, "--beads-db", join(repo, ".beads", "beads.db")]);
				}),
			);
			expect(await status()).toEqual(running);
			expect(await readdir(defaultState)).toEqual([]);
			expect(await client(["daemon", "stop"])).toEqual({ kind: "stopped" });
			await until("daemon exited", () => Promise.resolve(!alive(daemonPid!)));
			daemonPid = undefined;
			await Promise.all(
				repos.map(async (repo) => {
					expect(await Bun.file(join(repo, "done.json")).exists()).toBe(false);
					await Bun.write(join(repo, "release"), "release");
				}),
			);
			await until("detached supervisors recorded exit", async () => {
				const finished = await Promise.all(
					attempts.map(async (id) => {
						const worker = await Bun.file(join(state, id, "worker.json")).json();
						return worker.kind === "exited" && !alive(worker.supervisorPid);
					}),
				);
				return finished.every(Boolean);
			});
			expect(
				await Promise.all(repos.map((repo) => Bun.file(join(repo, "done.json")).json())),
			).toEqual(repos.map((repo) => identities.get(repo)));
			const missing = Bun.spawn(
				[
					process.execPath,
					COLONY,
					"daemon",
					"status",
					"--state",
					state,
					"--socket",
					socket,
					"--json",
				],
				{ cwd: root, env, stderr: "pipe", stdout: "pipe" },
			);
			const [stdout, stderr, code] = await Promise.all([
				new Response(missing.stdout).text(),
				new Response(missing.stderr).text(),
				missing.exited,
			]);
			expect(code).not.toBe(SUCCESS);
			expect(stderr).toBe("");
			expect(JSON.parse(stdout)).toMatchObject({
				kind: "error",
				message: expect.any(String),
				ok: false,
			});
			passed = true;
		} catch (error) {
			throw new Error(`Daemon smoke artifacts retained at ${root}`, { cause: error });
		} finally {
			await Promise.all(repos.map((repo) => Bun.write(join(repo, "release"), "cleanup")));
			await cleanupDaemon(socket, daemonPid);
			// Every process here belongs to a receipt under this test's private state root.
			await cleanupWorkers(state);
			if (passed) {
				await rm(root, { force: true, recursive: true });
			}
		}
	},
	SMOKE_TIMEOUT,
);

test(
	"foreground daemon exposes status and stops through its explicit public endpoint",
	// eslint-disable-next-line max-statements -- Keep the owned foreground child and its teardown together.
	async () => {
		const root = await mkdtemp(join(tmpdir(), "colony-foreground-"));
		const state = join(root, "state");
		const socket = join(root, "server.sock");
		const env = {
			...process.env,
			BEADS_DB: join(root, "unused.db"),
			XDG_STATE_HOME: join(root, "default"),
		};
		const args = ["--state", state, "--socket", socket, "--json"];
		await mkdir(state);
		const seed = openStore(state);
		const repository = { root: join(root, "repository"), beadsDb: join(root, "beads.db") };
		seed.settleRequest(
			repository.root,
			{
				id: "settled-before-restart",
				beadsDb: repository.beadsDb,
				state: "terminal",
				context: {
					attemptId: null,
					attempts: FIRST,
					claims: [],
					identity: "fixture-worker",
					message: "private",
					outcome: "completed",
					pendingClaim: null,
					retryAt: null,
					taskIds: [],
				},
			},
			undefined,
		);
		seed.close();
		const server = Bun.spawn([process.execPath, COLONY, "daemon", "serve", ...args], {
			cwd: root,
			env,
			stderr: "pipe",
			stdout: "pipe",
		});
		const stdout = new Response(server.stdout).text();
		const stderr = new Response(server.stderr).text();
		let serverPid = server.pid;
		let passed = false;
		try {
			await until("foreground socket", () =>
				access(socket).then(
					() => true,
					() => false,
				),
			);
			const status = JSON.parse(
				await execute([process.execPath, COLONY, "daemon", "status", ...args], root, env),
			);
			expect(status).toEqual({
				colonies: [],
				id: expect.any(String),
				kind: "status",
				ok: true,
				pid: expect.any(Number),
				socket,
				state,
			});
			serverPid = status.pid;
			expect(alive(serverPid)).toBe(true);
			expect(server.exitCode).toBeNull();
			const events = subscribeColonyEvents({
				state,
				socket,
				subscription: {
					colonies: [repository],
					types: ["request.settled"],
					start: { kind: "retained" },
				},
			});
			const initial = await events.next();
			expect(initial.value).toMatchObject({ kind: "checkpoint" });
			const settlement = await events.next();
			expect(settlement.value).toMatchObject({
				kind: "event",
				event: { repository, request: { id: "settled-before-restart", outcome: "completed" } },
			});
			// A live event connection must not occupy the control queue or prevent orderly shutdown.
			const streamEnded = events.next();
			const stopped = JSON.parse(
				await execute([process.execPath, COLONY, "daemon", "stop", ...args], root, env),
			);
			expect(stopped).toEqual({ kind: "stopped", ok: true });
			expect(await streamEnded).toMatchObject({ done: true });
			await until("foreground exit", () => Promise.resolve(server.exitCode !== null));
			expect(await server.exited).toBe(SUCCESS);
			expect(alive(serverPid)).toBe(false);
			expect(JSON.parse(await stdout)).toEqual({ exitCode: 0, kind: "daemon_completed", ok: true });
			expect(await stderr).toBe("");
			passed = true;
		} catch (error) {
			throw new Error(`Foreground smoke artifacts retained at ${root}`, { cause: error });
		} finally {
			if (alive(serverPid)) {
				process.kill(serverPid, "SIGTERM");
			}
			server.kill();
			await server.exited;
			if (passed) {
				await rm(root, { force: true, recursive: true });
			}
		}
	},
	SMOKE_TIMEOUT,
);

// --- Private functions ---
async function writeWorker(repo: string, taskId: string): Promise<void> {
	await Bun.write(
		join(repo, "worker.ts"),
		`
const repo = ${JSON.stringify(repo)};
const child = Bun.spawn(["br", "update", ${JSON.stringify(taskId)}, "--append-notes", process.env.HIVE_AGENT_NAME, "--db", process.env.BEADS_DB, "--actor", process.env.BD_ACTOR, "--json"], {stdout:"pipe",stderr:"pipe"});
if (await child.exited !== 0) throw new Error(await new Response(child.stderr).text());
await Bun.write(repo + "/started.json", JSON.stringify({cwd:process.cwd(),db:process.env.BEADS_DB,actor:process.env.BD_ACTOR,identity:process.env.HIVE_AGENT_NAME,kind:process.env.BR_AGENT_NAME}));
const deadline = Date.now() + 20000;
while (!(await Bun.file(repo + "/release").exists())) {
 if (Date.now() >= deadline) throw new Error("Fixture release deadline expired");
 await Bun.sleep(20);
}
await Bun.write(repo + "/done.json", JSON.stringify(process.env.HIVE_AGENT_NAME));
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
