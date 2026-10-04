import { colonyResponseSchema, execute } from "@hive/shared";
import { expect, test } from "bun:test";
// eslint-disable-next-line import/no-nodejs-modules -- Private endpoint fixtures and inode observations.
import { lstat, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import type { ColonyResponse } from "@hive/shared";
import type { Subprocess } from "bun";
// eslint-disable-next-line import/no-nodejs-modules -- Private fixture paths.
import { join } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- OS-owned disposable test directory.
import { tmpdir } from "node:os";

const SUCCESS = 0;
const ONE = 1;
const INTERVAL = 20;
const DEADLINE = 10_000;
const TIMEOUT = 60_000;
const COLONY = new URL("../bin/colony.ts", import.meta.url).pathname;
interface Target {
	/** Private registry and daemon ownership directory. */
	state: string;
	/** Selected Unix socket belonging to this fixture. */
	socket: string;
}

test(
	"daemon ownership excludes shared state, recovers known stale sockets, and preserves unknown endpoints",
	// eslint-disable-next-line max-statements -- One public ownership lifecycle keeps all spawned processes in one teardown.
	async () => {
		const temporary = await mkdtemp(join(tmpdir(), "colony-server-owner-"));
		const root = await realpath(temporary);
		const repo = join(root, "repo");
		const database = join(repo, ".beads", "beads.db");
		const env = {
			...process.env,
			BD_ACTOR: "smoke-seed",
			BEADS_DB: database,
			XDG_STATE_HOME: join(root, "unused"),
		};
		const owner = { socket: join(root, "owner.sock"), state: join(root, "owner-state") };
		const alternate = { ...owner, socket: join(root, "alternate.sock") };
		const wrongState = { ...owner, state: join(root, "wrong-state") };
		const concurrent = {
			socket: join(root, "concurrent.sock"),
			state: join(root, "concurrent-state"),
		};
		const unknown = { socket: join(root, "unknown.sock"), state: join(root, "unknown-state") };
		const ordinary = { socket: join(root, "ordinary.sock"), state: join(root, "ordinary-state") };
		const daemons = new Set<number>();
		const children: Subprocess[] = [];
		const argv = (target: Target, args: string[]) => [
			process.execPath,
			COLONY,
			...args,
			"--state",
			target.state,
			"--socket",
			target.socket,
			"--json",
		];
		const client = async (target: Target, args: string[]) => {
			const output = await execute(argv(target, args), repo, env);
			return parseCliResponse(output);
		};
		const add = (target: Target) => client(target, ["add", "--repo", repo, "--beads-db", database]);
		const status = async (target: Target) => {
			const current = await client(target, ["daemon", "status"]);
			if (current.kind !== "status") {
				throw new Error(JSON.stringify(current));
			}
			daemons.add(current.pid);
			return current;
		};
		let passed = false;
		try {
			await mkdir(repo);
			await execute(["git", "init", "--quiet"], repo, env);
			await execute(
				["br", "init", "--prefix", "smoke", "--db", database, "--actor", "smoke-seed"],
				repo,
				env,
			);
			const foreground = Bun.spawn(argv(owner, ["daemon", "serve"]), {
				cwd: repo,
				env,
				stderr: "ignore",
				stdout: "ignore",
			});
			children.push(foreground);
			await until("foreground owner ready", async () => {
				try {
					await status(owner);
					return true;
				} catch {
					return false;
				}
			});
			await add(owner);
			const first = await status(owner);
			await expect(client(wrongState, ["daemon", "stop"])).rejects.toBeInstanceOf(Error);
			await expect(
				client(wrongState, ["wake", "--repo", repo, "--beads-db", database]),
			).rejects.toBeInstanceOf(Error);
			const correctlyTargeted = await status(owner);
			expect(correctlyTargeted.pid).toBe(first.pid);
			expect(correctlyTargeted.colonies).toMatchObject([{ state: "asleep" }]);
			const contender = Bun.spawn(argv(alternate, ["daemon", "serve"]), {
				cwd: repo,
				env,
				stderr: "ignore",
				stdout: "ignore",
			});
			children.push(contender);
			let contenderExited = false;
			// eslint-disable-next-line promise/prefer-await-to-then -- Observe bounded foreground rejection while retaining its cleanup handle.
			const contenderResult = contender.exited.then((code) => {
				contenderExited = true;
				return code;
			});
			await until("competing foreground rejected", () => contenderExited);
			expect(await contenderResult).not.toBe(SUCCESS);
			await expect(add(alternate)).rejects.toBeInstanceOf(Error);
			const unchanged = await status(owner);
			expect(unchanged.pid).toBe(first.pid);
			expect(unchanged.colonies).toHaveLength(ONE);
			process.kill(first.pid, "SIGKILL");
			await foreground.exited;
			await until("killed daemon disappeared", () => !alive(first.pid));
			daemons.delete(first.pid);
			const deadSocket = await lstat(owner.socket);
			expect(deadSocket.isSocket()).toBe(true);
			await add(owner);
			const recovered = await status(owner);
			expect(recovered.pid).not.toBe(first.pid);
			expect(recovered.colonies).toHaveLength(ONE);
			const starts = await Promise.allSettled([add(concurrent), add(concurrent)]);
			expect(starts.some(({ status: result }) => result === "fulfilled")).toBe(true);
			const winner = await status(concurrent);
			await add(concurrent);
			const reused = await status(concurrent);
			expect(reused.pid).toBe(winner.pid);
			expect(winner.colonies).toHaveLength(ONE);
			const fixture = Bun.spawn(
				[
					process.execPath,
					"-e",
					`Bun.serve({unix:${JSON.stringify(unknown.socket)},fetch:()=>new Response('fixture')})`,
				],
				{ cwd: repo, env, stderr: "ignore", stdout: "ignore" },
			);
			children.push(fixture);
			await until("unknown socket bound", () =>
				lstat(unknown.socket).then(
					(info) => info.isSocket(),
					() => false,
				),
			);
			fixture.kill("SIGKILL");
			await fixture.exited;
			const stale = await lstat(unknown.socket);
			expect(stale.isSocket()).toBe(true);
			await expect(add(unknown)).rejects.toBeInstanceOf(Error);
			const preservedSocket = await lstat(unknown.socket);
			expect(preservedSocket.ino).toBe(stale.ino);
			await Bun.write(ordinary.socket, "unrelated fixture contents");
			const file = await lstat(ordinary.socket);
			await expect(add(ordinary)).rejects.toBeInstanceOf(Error);
			const preservedFile = await lstat(ordinary.socket);
			expect(preservedFile.ino).toBe(file.ino);
			expect(await Bun.file(ordinary.socket).text()).toBe("unrelated fixture contents");
			passed = true;
		} catch (error) {
			throw new Error(`Server ownership smoke artifacts retained at ${root}`, { cause: error });
		} finally {
			for (const pid of daemons) {
				if (alive(pid)) {
					process.kill(pid, "SIGTERM");
				}
			}
			for (const child of children) {
				child.kill();
			}
			await Promise.all(children.map((child) => child.exited));
			await Promise.all(
				[...daemons].map((pid) => until("owned daemon cleanup", () => !alive(pid))),
			);
			if (passed) {
				await rm(root, { force: true, recursive: true });
			}
		}
	},
	TIMEOUT,
);

// --- Private functions ---
async function until(label: string, condition: () => boolean | Promise<boolean>): Promise<void> {
	const deadline = Date.now() + DEADLINE;
	/* eslint-disable no-await-in-loop -- Bounded waits synchronize only with owned process/socket observations. */
	while (!(await condition())) {
		if (Date.now() >= deadline) {
			throw new Error(`Timed out waiting for ${label}`);
		}
		await Bun.sleep(INTERVAL);
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

function parseCliResponse(output: string): ColonyResponse {
	const { ok, ...response } = JSON.parse(output);
	expect(ok).toBe(true);
	return colonyResponseSchema.parse(response);
}
