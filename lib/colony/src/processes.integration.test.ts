/* eslint-disable import/no-nodejs-modules -- Exercise owned subprocesses and their temporary execution artifacts. */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { observeExecution, stopExecution } from "./processes.ts";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

const EXIT_CODE = 23;
const originalTimezone = process.env["TZ"];
beforeAll(() => {
	process.env["TZ"] = "UTC";
});
afterAll(() => {
	if (originalTimezone === undefined) {
		delete process.env["TZ"];
	} else {
		process.env["TZ"] = originalTimezone;
	}
});

test("ordinary supervision publishes launch and exit artifacts for the managed child #test-553", async () => {
	const execution = await fixture(`
		const result = await api.runOwnedExecution(ref,
			() => Bun.spawn(["/bin/sh", "-c", "exit ${EXIT_CODE}"],
				{ stdout: "ignore", stderr: "ignore" }),
			(pid) => Bun.write(ref.directory + "/started", String(pid)).then(() => {}));
		console.log(JSON.stringify(result));
	`);
	try {
		const [line] = await execution.line;
		const result = JSON.parse(String(line));
		expect(result).toEqual({ code: EXIT_CODE, pid: expect.any(Number) });
		await execution.exited;
		expect(await Bun.file(join(execution.ref.directory, "started")).text()).toBe(
			String(result.pid),
		);
		expect(await Bun.file(join(execution.ref.directory, "ownership.json")).json()).toMatchObject({
			harnessPid: result.pid,
			phase: "exited",
			token: execution.ref.token,
		});
		expect(await observeExecution(execution.ref)).toEqual({ kind: "stopped" });
	} finally {
		await execution.cleanup();
	}
});

test("native owned-group stop terminates the supervisor and managed child #test-554", async () => {
	const execution = await fixture(`
  await api.runOwnedExecution(ref,
   () => Bun.spawn(["/bin/cat"],
    { stdin: "pipe", stdout: "ignore", stderr: "ignore" }),
   async () => { console.log("ready"); });
 `);
	try {
		const [ready] = await execution.line;
		expect(ready).toBe("ready");
		expect(await observeExecution(execution.ref)).toEqual({ kind: "live" });
		await stopExecution(execution.ref);
		await execution.exited;
		expect(await observeExecution(execution.ref)).toEqual({ kind: "stopped" });
	} finally {
		await execution.cleanup();
	}
});

async function fixture(script: string) {
	const directory = await mkdtemp(join(tmpdir(), "colony-owned-process-"));
	const ref = { directory, token: "test-token" };
	const module = new URL("processes.ts", import.meta.url).href;
	const child = spawn(
		process.execPath,
		[
			"-e",
			`const api = await import(${JSON.stringify(module)}); const ref = ${JSON.stringify(ref)}; ${script}`,
		],
		{ detached: true, stdio: ["ignore", "pipe", "inherit"] },
	);
	const lines = createInterface({ input: child.stdout });
	const line = once(lines, "line");
	const exited = once(child, "exit");
	return {
		ref,
		line,
		exited,
		cleanup: async () => {
			child.kill("SIGKILL");
			await exited;
			lines.close();
			await rm(directory, { recursive: true, force: true });
		},
	};
}
