import { afterAll, beforeAll, expect, test } from "bun:test";
// eslint-disable-next-line import/no-nodejs-modules -- Owned temporary process fixture and artifacts.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import {
	observeExecution,
	observeProcess,
	resumeExecution,
	runOwnedExecution,
	stopExecution,
} from "./processes.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Private process fixture paths.
import { join } from "node:path";
import psList from "ps-list";
// eslint-disable-next-line import/no-nodejs-modules -- Private OS fixture directory.
import { tmpdir } from "node:os";

const PREVIOUS_LIFETIME = 1000;
const TIMEOUT = 20_000;
const INTERVAL = 20;
const SUCCESS = 0;
const DESCENDANTS = 2;

// Bun test parses dates in UTC; make ps-list's timezone-less ps output and subprocess fixtures agree.
const originalTimezone = process.env.TZ;
beforeAll(() => {
	process.env.TZ = "UTC";
});
afterAll(() => {
	if (originalTimezone === undefined) {
		delete process.env.TZ;
	} else {
		process.env.TZ = originalTimezone;
	}
});

test(
	"owned separate-group descendants stop while unrelated sentinel survives",
	// eslint-disable-next-line max-statements -- Keep owned processes, assertions and guaranteed cleanup in one fixture.
	async () => {
		const directory = await mkdtemp(join(tmpdir(), "colony-owned-"));
		const ref = { directory, token: crypto.randomUUID() };
		const sentinel = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], {
			stderr: "ignore",
			stdout: "ignore",
		});
		const script = join(directory, "harness.ts");
		await Bun.write(
			script,
			`import {spawn} from 'node:child_process';
const child=spawn(process.execPath,['-e','setInterval(() => {}, 1000)'],{detached:true,stdio:'ignore'});
child.unref();
while (!(await Bun.file(import.meta.dirname + "/release").exists())) await Bun.sleep(20);
`,
		);
		const completion = runOwnedExecution(
			ref,
			() =>
				Bun.spawn([process.execPath, script], {
					stderr: "ignore",
					stdout: "ignore",
				}),
			() => Promise.resolve(),
		);
		try {
			await until(async () => {
				const file = Bun.file(join(directory, "ownership.json"));
				if (!(await file.exists())) {
					return false;
				}
				const owned = JSON.parse(await readFile(join(directory, "ownership.json"), "utf8"));
				return owned.processes.length === DESCENDANTS;
			});
			expect(await observeExecution(ref)).toEqual({ kind: "live" });
			await expect(stopExecution({ ...ref, token: "wrong" })).rejects.toBeInstanceOf(Error);
			expect(await observeExecution(ref)).toEqual({ kind: "live" });
			await Bun.write(join(directory, "release"), "exit root");
			await completion;
			expect(await observeExecution(ref)).toEqual({ kind: "live" });
			await stopExecution(ref);
			expect(await observeExecution(ref)).toEqual({ kind: "stopped" });
			expect(sentinel.exitCode).toBeNull();
		} finally {
			try {
				await stopExecution(ref);
				await completion;
			} finally {
				sentinel.kill();
				await sentinel.exited;
				await rm(directory, { force: true, recursive: true });
			}
		}
	},
	TIMEOUT,
);

test(
	"child handle proves short-lived harness exit",
	async () => {
		const directory = await mkdtemp(join(tmpdir(), "colony-short-"));
		const ref = { directory, token: crypto.randomUUID() };
		try {
			const result = await runOwnedExecution(
				ref,
				() =>
					Bun.spawn([process.execPath, "-e", "process.exit(0)"], {
						stderr: "ignore",
						stdout: "ignore",
					}),
				() => Promise.resolve(),
			);
			expect(result.code).toBe(SUCCESS);
			expect(await observeExecution(ref)).toEqual({ kind: "stopped" });
		} finally {
			await rm(directory, { force: true, recursive: true });
		}
	},
	TIMEOUT,
);

test(
	"stopping an actively observed harness confirms exit without poisoning ownership",
	// eslint-disable-next-line max-statements -- Keep active child observation, termination and owned teardown in one fixture.
	async () => {
		const directory = await mkdtemp(join(tmpdir(), "colony-stop-live-"));
		const ref = { directory, token: crypto.randomUUID() };
		const completion = runOwnedExecution(
			ref,
			() =>
				Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], {
					stderr: "ignore",
					stdout: "ignore",
				}),
			() => Promise.resolve(),
		);
		try {
			await until(async () => {
				const file = Bun.file(join(directory, "ownership.json"));
				if (!(await file.exists())) {
					return false;
				}
				const owned = JSON.parse(await readFile(join(directory, "ownership.json"), "utf8"));
				return owned.phase === "running" && owned.processes.length > SUCCESS;
			});
			await stopExecution(ref);
			await completion;
			expect(await observeExecution(ref)).toEqual({ kind: "stopped" });
			const owned = await Bun.file(join(directory, "ownership.json")).json();
			expect(owned.error).toBeNull();
		} finally {
			await stopExecution(ref);
			await completion;
			await rm(directory, { force: true, recursive: true });
		}
	},
	TIMEOUT,
);

test(
	"owned harness title changes preserve cleanup and reject a changed start time",
	// eslint-disable-next-line max-statements -- Exercise mutable OS argv with owned handles and an unrelated live sentinel.
	async () => {
		const directory = await mkdtemp(join(tmpdir(), "colony-title-"));
		const ref = { directory, token: crypto.randomUUID() };
		const sentinel = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], {
			stderr: "ignore",
			stdout: "ignore",
		});
		const script = join(directory, "harness.mjs");
		await Bun.write(
			script,
			`import {existsSync,writeFileSync} from "node:fs";
import {setTimeout} from "node:timers/promises";
while (!existsSync(import.meta.dirname + "/rename")) await setTimeout(20);
process.title = "colony-renamed-harness";
writeFileSync(import.meta.dirname + "/renamed", "ready");
setInterval(() => {}, 1000);
`,
		);
		const child = Bun.spawn(["node", script], { stderr: "ignore", stdout: "ignore" });
		const completion = runOwnedExecution(
			ref,
			() => child,
			async () => {
				await Bun.write(join(directory, "rename"), "rename after ownership capture");
			},
		);
		// eslint-disable-next-line promise/prefer-await-to-then, promise/prefer-await-to-callbacks -- Retain a concurrent capture failure until assertions or guaranteed cleanup await it.
		const outcome = completion.catch((error: unknown) => error);
		try {
			await until(() => Bun.file(join(directory, "renamed")).exists());
			const owned = await Bun.file(join(directory, "ownership.json")).json();
			const recorded = owned.processes.find(({ pid }: { pid: number }) => pid === child.pid);
			expect(await observeProcess(recorded)).toBe("live");
			await expect(observeProcess({ ...recorded, startTime: SUCCESS })).rejects.toBeInstanceOf(
				Error,
			);
			expect(await observeExecution(ref)).toEqual({ kind: "live" });
			await stopExecution(ref);
			expect(await outcome).not.toBeInstanceOf(Error);
			expect(await observeExecution(ref)).toEqual({ kind: "stopped" });
			expect(sentinel.exitCode).toBeNull();
		} finally {
			child.kill();
			sentinel.kill();
			await Promise.all([child.exited, sentinel.exited, outcome]);
			await rm(directory, { force: true, recursive: true });
		}
	},
	TIMEOUT,
);

test(
	"cleanup retains a new owned lifetime while unrelated reused PIDs survive",
	// eslint-disable-next-line max-statements -- Reproduce historical PID reuse with real owned handles and persisted cleanup evidence.
	async () => {
		const directory = await mkdtemp(join(tmpdir(), "colony-reused-"));
		const ref = { directory, token: crypto.randomUUID() };
		const children = Array.from({ length: DESCENDANTS }, () =>
			Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], {
				stderr: "ignore",
				stdout: "ignore",
			}),
		);
		const [ownedChild, sentinel] = children;
		try {
			const snapshot = await psList();
			const fingerprints = children.map(({ pid }) => {
				const current = snapshot.find((candidate) => candidate.pid === pid)!;
				return {
					cmd: current.cmd,
					pid,
					ppid: current.ppid,
					startTime: current.startTime!.getTime(),
				};
			});
			const [ownedProcess] = fingerprints;
			await Bun.write(
				join(directory, "ownership.json"),
				JSON.stringify({
					// eslint-disable-next-line unicorn/no-null -- Persist the explicit successful ownership state.
					error: null,
					harnessPid: ownedChild!.pid,
					phase: "exited",
					// eslint-disable-next-line oxc/no-map-spread -- Keep the current fingerprints intact as separate cleanup evidence.
					processes: fingerprints.map((recorded) => ({
						...recorded,
						startTime: recorded.startTime - PREVIOUS_LIFETIME,
					})),
					supervisor: ownedProcess,
					token: ref.token,
				}),
			);
			await Bun.write(
				join(directory, "cleanup.json"),
				JSON.stringify({ processes: [ownedProcess], token: ref.token }),
			);
			expect(await observeExecution(ref)).toEqual({ kind: "live" });
			await stopExecution(ref);
			await ownedChild!.exited;
			expect(await observeExecution(ref)).toEqual({ kind: "stopped" });
			expect(sentinel!.exitCode).toBeNull();
			const cleanup = await Bun.file(join(directory, "cleanup.json")).json();
			expect(cleanup.processes).toContainEqual(ownedProcess);
		} finally {
			for (const child of children) {
				child.kill();
			}
			await Promise.all(children.map((child) => child.exited));
			await rm(directory, { force: true, recursive: true });
		}
	},
	TIMEOUT,
);

test.each(["authorize", "cancel", "dead"] as const)(
	"supervisor handoff %s preserves launch permission and stopped evidence",
	// eslint-disable-next-line max-statements -- Exercise the detached permission waiter and cleanup through actual OS processes.
	async (action) => {
		const directory = await mkdtemp(join(tmpdir(), "colony-handoff-"));
		const ref = { directory, token: crypto.randomUUID() };
		const marker = join(directory, "launched");
		const script = join(directory, "supervisor.ts");
		const boundary = new URL("processes.ts", import.meta.url).pathname;
		await Bun.write(
			script,
			`import {awaitExecutionPermission,runOwnedExecution} from ${JSON.stringify(boundary)};
const ref=JSON.parse(Bun.argv[2]);
await awaitExecutionPermission(ref);
await runOwnedExecution(ref,()=>Bun.spawn([process.execPath,"-e",${JSON.stringify(`await Bun.write(${JSON.stringify(marker)},"launched");setInterval(()=>{},1000);`)}],{stdout:"ignore",stderr:"ignore"}),()=>Promise.resolve());
`,
		);
		const supervisor = Bun.spawn([process.execPath, script, JSON.stringify(ref)], {
			stderr: "inherit",
			stdout: "ignore",
		});
		try {
			await until(() => Bun.file(join(directory, "supervisor.json")).exists());
			expect(await Bun.file(marker).exists()).toBe(false);
			if (action === "authorize") {
				await resumeExecution(ref, (owner) => {
					expect(owner.pid).toBe(supervisor.pid);
				});
				await until(() => Bun.file(marker).exists());
				await stopExecution(ref);
			} else {
				if (action === "dead") {
					supervisor.kill("SIGKILL");
					await supervisor.exited;
				}
				await stopExecution(ref);
				await resumeExecution(ref, () => {
					throw new Error("Stopped supervisor must not be authorized");
				});
				expect(await Bun.file(marker).exists()).toBe(false);
			}
			await supervisor.exited;
			expect(await observeExecution(ref)).toEqual({ kind: "stopped" });
		} finally {
			await stopExecution(ref);
			await supervisor.exited;
			await rm(directory, { force: true, recursive: true });
		}
	},
	TIMEOUT,
);

test(
	"supervisor deadline stops only verified owned execution without Colony polling",
	// eslint-disable-next-line max-statements -- A real owned harness and unrelated sentinel verify deadline cleanup and retained evidence.
	async () => {
		const directory = await mkdtemp(join(tmpdir(), "colony-deadline-"));
		const ref = { directory, token: crypto.randomUUID() };
		const sentinel = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], {
			stderr: "ignore",
			stdout: "ignore",
		});
		const runtimeMs = 1000;
		try {
			await runOwnedExecution(
				ref,
				() =>
					Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], {
						stderr: "ignore",
						stdout: "ignore",
					}),
				() => Promise.resolve(),
				Date.now() + runtimeMs,
			);
			expect(await observeExecution(ref)).toEqual({ kind: "stopped" });
			const ownership = await Bun.file(join(directory, "ownership.json")).json();
			expect(ownership.phase).toBe("exited");
			expect(ownership.error).toBeNull();
			expect(sentinel.exitCode).toBeNull();
		} finally {
			await stopExecution(ref);
			sentinel.kill();
			await sentinel.exited;
			await rm(directory, { force: true, recursive: true });
		}
	},
	TIMEOUT,
);

// --- Private functions ---
async function until(condition: () => Promise<boolean>): Promise<void> {
	const deadline = Date.now() + TIMEOUT;
	/* eslint-disable no-await-in-loop -- Wait only for the owned process handshake with a bounded deadline. */
	while (!(await condition())) {
		if (Date.now() >= deadline) {
			throw new Error("Owned process fixture did not become observable");
		}
		await Bun.sleep(INTERVAL);
	}
	/* eslint-enable no-await-in-loop */
}
