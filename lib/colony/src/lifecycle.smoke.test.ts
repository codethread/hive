// eslint-disable-next-line import/no-nodejs-modules -- Disposable real repositories and owned process cleanup.
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
const ONE = 1;
const TWO = 2;
const POLL_INTERVAL = 20;
const DEADLINE = 10_000;
const SMOKE_TIMEOUT = 60_000;
const COLONY = new URL("../bin/colony.ts", import.meta.url).pathname;
const BEE = new URL("../bin/bee.ts", import.meta.url).pathname;

test(
	"public registry lifecycle suspends dispatch, refreshes formulas, and restores only durable membership",
	// eslint-disable-next-line max-statements -- One public lifecycle keeps daemon and detached worker ownership in a single teardown.
	async () => {
		const directory = await mkdtemp(join(tmpdir(), "colony-lifecycle-"));
		const root = await realpath(directory);
		const xdg = join(root, "xdg");
		const state = join(xdg, "hive", "colony");
		const socket = join(state, "colony.sock");
		const target = join(root, "target");
		const witness = join(root, "witness");
		const temporary = join(root, "temporary");
		const repos = [target, witness, temporary];
		const env = {
			...process.env,
			BD_ACTOR: "smoke-seed",
			BEADS_DB: join(root, "unused.db"),
			XDG_STATE_HOME: xdg,
		};
		const run = (args: string[], cwd = root) => execute(args, cwd, env);
		// Deliberately omit both endpoint flags: all public operations use the private XDG default.
		const client = async (args: string[]) =>
			parseCliResponse(await run([process.execPath, COLONY, ...args, "--json"]));
		const registry = async () => {
			const result = await client(["list"]);
			if (result.kind !== "status") {
				throw new Error(JSON.stringify(result));
			}
			return result;
		};
		const operation = (kind: string, repo: string, extra: string[] = []) =>
			client([kind, "--repo", repo, "--beads-db", join(repo, ".beads", "beads.db"), ...extra]);
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
		const request = async (repo: string, title: string) => {
			const task = await tracker(repo, ["create", "--title", title, "--owner", "ct"]);
			const result = JSON.parse(
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
					"--harness",
					"fixture",
					"--json",
				]),
			);
			return { identity: result.request.assignee, spawn: result.request.id, task: task.id };
		};
		const colony = async (repo: string) => {
			const current = await registry();
			return current.colonies.find((entry) => entry.repository.root === repo);
		};
		const started = (repo: string, identity: string) =>
			Bun.file(join(repo, `${identity}.json`)).exists();
		const pass = async (title: string) => {
			const work = await request(witness, title);
			const { identity } = work;
			await until(`awake witness ${identity}`, () => started(witness, identity));
			const { pid } = await Bun.file(join(witness, `${identity}.json`)).json();
			await tracker(witness, ["close", work.task]);
			await Bun.write(join(witness, `${identity}.release`), "witness complete");
			await until(`witness ${identity} stopped`, () => Promise.resolve(!alive(pid)));
		};
		// eslint-disable-next-line unicorn/no-useless-undefined -- PID remains unknown if initial lazy startup fails.
		let daemonPid: number | undefined = undefined;
		let passed = false;
		try {
			await Promise.all(
				repos.map(async (repo) => {
					await mkdir(repo);
					await run(["git", "init"], repo);
					await tracker(repo, ["init", "--prefix", "smoke"]);
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
					await writeWorker(repo);
					const canonicalConfig = await Bun.file(join(repo, "bees.toml")).text();
					const config = canonicalConfig.replace('ranking = "bv-pagerank"', 'ranking = "fifo"');
					await Bun.write(
						join(repo, "bees.toml"),
						`${config}\n[formulas.fixture]\nexecutable=${JSON.stringify(process.execPath)}\nargv=[${JSON.stringify(join(repo, "worker.ts"))}, "original"]\n`,
					);
				}),
			);
			await operation("add", target);
			({ pid: daemonPid } = await registry());
			expect(await colony(target)).toMatchObject({
				attempts: [],
				intent: "asleep",
				registration: "durable",
				state: "asleep",
			});
			await operation("wake", witness);
			const original = await request(target, "Original worker");
			await pass("blue-calm-lynx");
			expect(await started(target, original.identity)).toBe(false);
			await operation("wake", target);
			await until("target worker", () => started(target, original.identity));
			await operation("add", target);
			expect(await colony(target)).toMatchObject({
				intent: "awake",
				registration: "durable",
				state: "awake",
			});
			await expect(operation("wake", target, ["--temp"])).rejects.toBeInstanceOf(Error);
			await operation("sleep", target);
			const worker = await Bun.file(join(target, `${original.identity}.json`)).json();
			expect(alive(worker.pid)).toBe(true);
			const pending = await request(target, "Pending worker");
			const closed = await request(target, "red-brave-hare");
			await tracker(target, ["close", closed.task]);
			await pass("gold-bright-wren");
			expect(await started(target, pending.identity)).toBe(false);
			const sleepingRequest = await tracker(target, ["show", closed.spawn]);
			expect(sleepingRequest[FIRST].status).toBe("open");
			const sleeping = await colony(target);
			expect(sleeping?.attempts).toHaveLength(ONE);
			expect(alive(worker.pid)).toBe(true);
			const config = await Bun.file(join(target, "bees.toml")).text();
			await Bun.write(join(target, "bees.toml"), config.replace('"original"', '"refreshed"'));
			await operation("wake", target);
			await until("fresh formula used", () => started(target, pending.identity));
			const refreshed = await Bun.file(join(target, `${pending.identity}.json`)).json();
			expect(refreshed.version).toBe("refreshed");
			const active = await colony(target);
			const beforeRemoval = active!.attempts;
			expect(beforeRemoval).toHaveLength(TWO);
			expect(await operation("remove", target)).toMatchObject({
				attempts: beforeRemoval,
				kind: "removed",
			});
			expect(await colony(target)).toBeUndefined();
			expect(alive(worker.pid)).toBe(true);
			await operation("add", target);
			expect(await colony(target)).toMatchObject({ attempts: beforeRemoval });
			await operation("wake", target);
			await pass("white-soft-deer");
			expect(await colony(target)).toMatchObject({ attempts: beforeRemoval });
			await operation("sleep", target);
			await operation("wake", temporary, ["--temp"]);
			await pass("black-bold-rook");
			expect(await colony(temporary)).toMatchObject({
				attempts: [],
				intent: "awake",
				registration: "temporary",
				state: "awake",
			});
			await operation("sleep", temporary);
			expect(await colony(temporary)).toBeUndefined();
			await operation("wake", temporary, ["--temp"]);
			await operation("add", temporary);
			expect(await colony(temporary)).toMatchObject({
				intent: "awake",
				registration: "durable",
				state: "awake",
			});
			await operation("remove", temporary);
			await operation("wake", temporary, ["--temp"]);
			await client(["daemon", "stop"]);
			await until("first daemon exited", () => Promise.resolve(!alive(daemonPid!)));
			daemonPid = undefined;
			await operation("add", target);
			({ pid: daemonPid } = await registry());
			expect(await colony(target)).toMatchObject({
				attempts: beforeRemoval,
				intent: "asleep",
				registration: "durable",
				state: "asleep",
			});
			expect(await colony(witness)).toMatchObject({
				intent: "awake",
				registration: "durable",
				state: "awake",
			});
			expect(await colony(temporary)).toBeUndefined();
			await pass("silver-fair-seal");
			expect(alive(worker.pid)).toBe(true);
			passed = true;
		} catch (error) {
			throw new Error(`Lifecycle smoke artifacts retained at ${root}`, { cause: error });
		} finally {
			await Promise.all(repos.map((repo) => Bun.write(join(repo, "release"), "cleanup")));
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
async function writeWorker(repo: string): Promise<void> {
	await Bun.write(
		join(repo, "worker.ts"),
		`
const repo = ${JSON.stringify(repo)};
await Bun.write(repo + "/" + process.env.HIVE_AGENT_NAME + ".json", JSON.stringify({ pid: process.pid, version: process.argv[2] }));
const deadline = Date.now() + 60000;
while (!(await Bun.file(repo + "/release").exists()) && !(await Bun.file(repo + "/" + process.env.HIVE_AGENT_NAME + ".release").exists())) {
 if (Date.now() >= deadline) throw new Error("Fixture release deadline expired");
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
