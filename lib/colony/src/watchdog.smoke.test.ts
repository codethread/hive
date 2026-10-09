/* eslint-disable unicorn/no-null -- Exercise the persisted JSON and public status contracts. */
import type { ColonyResponse, ColonyStatus } from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Disposable executable and checkpoint fixtures.
import { chmod, mkdtemp, open, readdir, realpath, rm, stat } from "node:fs/promises";
import { expect, test } from "bun:test";
import type { Subprocess } from "bun";
// eslint-disable-next-line import/no-nodejs-modules -- Private fixture paths.
import { join } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Disposable OS temporary directory.
import { tmpdir } from "node:os";

const WATCHDOG = new URL("../bin/watchdog.ts", import.meta.url).pathname;
const INTERVAL = 20;
const DEADLINE = 40_000;
const TIMEOUT = 60_000;
const EXECUTABLE_MODE = 0o755;
const ONE = 1;
const TWO = 2;

test(
	"watchdog delivers through cc-notify, deduplicates after restart, and atomically replaces its checkpoint",
	// eslint-disable-next-line max-statements -- One isolated executable lifecycle verifies the concrete IO boundary and owns teardown.
	async () => {
		const temporary = await mkdtemp(join(tmpdir(), "watchdog-"));
		const root = await realpath(temporary);
		const state = join(root, "state");
		const socket = join(root, "status.sock");
		const repository = { beadsDb: join(root, "beads.db"), root: join(root, "repo") };
		const notifications = join(root, "notifications.jsonl");
		const notifier = join(root, "cc-notify");
		const key = new Bun.CryptoHasher("sha256").update(socket).digest("hex");
		const directory = join(state, "watchdog");
		const checkpoint = join(directory, `${key}.json`);
		const failed = { failures: [repository], outage: null };
		const recovered = { failures: [], outage: null };
		const children: Subprocess[] = [];
		const requests: unknown[] = [];
		const selections: (string | null)[] = [];
		let colony: ColonyStatus = {
			attempts: [],
			intent: "awake",
			message: "fixture failure",
			policy: null,
			registration: "durable",
			repository,
			state: "failed",
		};
		const server = Bun.serve({
			unix: socket,
			async fetch(request) {
				requests.push(await request.json());
				selections.push(request.headers.get("x-colony-state"));
				const response: ColonyResponse = {
					colonies: [colony],
					id: "watchdog-fixture",
					kind: "status",
					pid: process.pid,
					socket,
					state,
				};
				return Response.json(response);
			},
		});
		const start = () => {
			const child = Bun.spawn([process.execPath, WATCHDOG, "--state", state, "--socket", socket], {
				cwd: root,
				// Only the fake executable is discoverable; no real notification command can run.
				env: { PATH: root },
				stderr: "pipe",
				stdout: "ignore",
			});
			children.push(child);
			return child;
		};
		let passed = false;
		try {
			await Bun.write(
				notifier,
				`#!${process.execPath}\nimport { appendFile } from "node:fs/promises";\nconst body = await Bun.stdin.text();\nawait appendFile(${JSON.stringify(notifications)}, JSON.stringify({ argv: process.argv.slice(2), body }) + "\\n");\n`,
			);
			await chmod(notifier, EXECUTABLE_MODE);
			const first = start();
			await until("failure checkpoint", () => Bun.file(checkpoint).exists());
			expect(await Bun.file(checkpoint).json()).toEqual(failed);
			first.kill();
			await first.exited;
			expect(await new Response(first.stderr).text()).toBe("");
			const oldCheckpoint = await open(checkpoint, "r");
			try {
				const original = await oldCheckpoint.stat();
				const restarted = start();
				await until("restart status request", () => requests.length === TWO);
				// The restarted process first sees the same failure; its next real poll sees recovery.
				colony = {
					attempts: [],
					intent: "asleep",
					policy: null,
					registration: "durable",
					repository,
					state: "asleep",
				};
				await until("recovery checkpoint replacement", async () => {
					const current = await stat(checkpoint);
					return current.ino !== original.ino;
				});
				restarted.kill();
				await restarted.exited;
				expect(await new Response(restarted.stderr).text()).toBe("");
				expect(JSON.parse(await oldCheckpoint.readFile("utf8"))).toEqual(failed);
				expect(await Bun.file(checkpoint).json()).toEqual(recovered);
			} finally {
				await oldCheckpoint.close();
			}
			const notificationText = await Bun.file(notifications).text();
			const records = notificationText
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line));
			const context = `\n\nState: ${state}\nSocket: ${socket}\n`;
			expect(records).toEqual([
				{
					argv: ["Colony health"],
					body: `Colony failed: ${repository.root} (Beads: ${repository.beadsDb})\nfixture failure${context}`,
				},
				{
					argv: ["Colony health"],
					body: `Colony failure cleared: ${repository.root} (Beads: ${repository.beadsDb})\nCurrent state: asleep.${context}`,
				},
			]);
			expect(requests.length).toBe(TWO + ONE);
			expect(requests.every((request) => JSON.stringify(request) === '{"kind":"status"}')).toBe(
				true,
			);
			expect(selections.every((selection) => selection === state)).toBe(true);
			expect(await readdir(directory)).toEqual([`${key}.json`]);
			passed = true;
		} catch (error) {
			throw new Error(`Watchdog smoke artifacts retained at ${root}`, { cause: error });
		} finally {
			for (const child of children) {
				child.kill();
			}
			await Promise.all(children.map((child) => child.exited));
			await server.stop(true);
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
	/* eslint-disable no-await-in-loop -- Bounded waits observe only the fixture's IO. */
	while (!(await condition())) {
		if (Date.now() >= deadline) {
			throw new Error(`Timed out waiting for ${label}`);
		}
		await Bun.sleep(INTERVAL);
	}
	/* eslint-enable no-await-in-loop */
}
