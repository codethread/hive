// eslint-disable-next-line import/no-nodejs-modules -- Disposable real Git/tracker fixtures and owned cleanup.
import { access, mkdir, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { colonyResponseSchema, execute } from "@hive/shared";
import { expect, test } from "bun:test";
import type { ColonyResponse } from "@hive/shared";
import { Database } from "bun:sqlite";
// eslint-disable-next-line import/no-nodejs-modules -- Private fixture paths.
import { join } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Private OS temporary fixture root.
import { tmpdir } from "node:os";

const SUCCESS = 0;
const FIRST = 0;
const NONE = 0;
const POLL_INTERVAL = 20;
const DEADLINE = 10_000;
const SMOKE_TIMEOUT = 30_000;
const COLONY = new URL("../bin/colony.ts", import.meta.url).pathname;
const BEE = new URL("../bin/bee.ts", import.meta.url).pathname;

test(
	"waiting request checkpoints pin their tracker, identity and related tasks before any launch",
	// eslint-disable-next-line max-statements -- One zero-capacity fixture exercises retained authority through public mutations.
	async () => {
		const temporary = await mkdtemp(join(tmpdir(), "colony-authority-"));
		const root = await realpath(temporary);
		const repo = join(root, "repo");
		const alternate = join(root, "alternate");
		const state = join(root, "state");
		const socket = join(root, "daemon.sock");
		const database = join(repo, ".beads", "beads.db");
		const alternateDatabase = join(alternate, ".beads", "beads.db");
		const env = {
			...process.env,
			BD_ACTOR: "smoke-seed",
			BEADS_DB: database,
			XDG_STATE_HOME: join(root, "unused"),
		};
		const run = (args: string[], cwd = repo) => execute(args, cwd, env);
		const tracker = async (args: string[]) =>
			JSON.parse(await run(["br", ...args, "--db", database, "--actor", "smoke-seed", "--json"]));
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
		const mutation = (kind: string, db = database) =>
			client([kind, "--repo", repo, "--beads-db", db]);
		const status = async () => {
			const current = await client(["list"]);
			if (current.kind !== "status") {
				throw new Error(JSON.stringify(current));
			}
			return current;
		};
		const failed = () =>
			until("changed authority rejected", async () => {
				const current = await status();
				return current.colonies[FIRST]?.state === "failed";
			});
		// eslint-disable-next-line unicorn/no-useless-undefined -- Lazy startup can fail before PID is returned.
		let daemonPid: number | undefined = undefined;
		let passed = false;
		try {
			await Promise.all(
				[repo, alternate].map(async (cwd) => {
					await mkdir(cwd);
					await run(["git", "init"], cwd);
					await execute(["br", "init", "--prefix", "smoke"], cwd, {
						...env,
						BEADS_DB: join(cwd, ".beads", "beads.db"),
					});
				}),
			);
			await Bun.write(
				join(repo, ".hive", "bees.toml"),
				`owner="ct"
humans=["ct"]
ranking="fifo"
[limits]
colony=0
[kinds.worker]
description = "Implement the linked task beads and verify their outcomes."
harness="fixture"
model="fixture"
effort="low"
prompt="fixture"
[formulas.fixture]
executable=${JSON.stringify(process.execPath)}
argv=["-e", "throw new Error('zero capacity must not launch')"]
`,
			);
			const first = await tracker(["create", "--title", "Captured task", "--owner", "ct"]);
			const changed = await tracker(["create", "--title", "Later related task", "--owner", "ct"]);
			const created = JSON.parse(
				await run([
					process.execPath,
					BEE,
					"spawn",
					"worker",
					first.id,
					"--repo",
					repo,
					"--beads-db",
					database,
					"--actor",
					"smoke-seed",
					"--json",
				]),
			);
			const spawn = created.request.id;
			await mutation("wake");
			({ pid: daemonPid } = await status());
			const durable = new Database(join(state, "colony.sqlite"), { readonly: true });
			try {
				await until("waiting request persisted", () => {
					const rows = durable.query("SELECT snapshot FROM requests WHERE spawn_id = ?").all(spawn);
					return Promise.resolve(rows.length > NONE);
				});
				expect(durable.query("SELECT COUNT(*) AS count FROM attempts").get()).toEqual({
					count: NONE,
				});
			} finally {
				durable.close();
			}
			await mutation("remove");
			await expect(mutation("add", alternateDatabase)).rejects.toBeInstanceOf(Error);
			await expect(mutation("wake", alternateDatabase)).rejects.toBeInstanceOf(Error);
			await mutation("add");
			await tracker(["update", spawn, "--assignee", "blue-calm-lynx"]);
			await mutation("wake");
			await failed();
			const afterIdentity = await tracker(["show", first.id]);
			expect(afterIdentity[FIRST].assignee).toBeUndefined();
			await mutation("sleep");
			await tracker(["update", spawn, "--assignee", created.request.assignee]);
			await tracker(["dep", "add", spawn, changed.id, "--type", "related"]);
			await mutation("wake");
			await failed();
			const final = await status();
			expect(final.colonies[FIRST]?.attempts).toHaveLength(NONE);
			const tasks = await Promise.all([first.id, changed.id].map((id) => tracker(["show", id])));
			expect(tasks.map((rows) => rows[FIRST].assignee)).toEqual([undefined, undefined]);
			expect(tasks.map((rows) => rows[FIRST].status)).toEqual(["open", "open"]);
			passed = true;
		} catch (error) {
			throw new Error(`Authority smoke artifacts retained at ${root}`, { cause: error });
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
