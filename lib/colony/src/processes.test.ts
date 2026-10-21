import { expect, test } from "bun:test";
import { parseProcess, stopExecution } from "./processes.ts";
import type { ExecutionControl } from "./processes.ts";

const TERM_GRACE = 1000;
const STOP_TIMEOUT = 5000;
const NEXT = 1;
const START = "Sun Oct 18 20:00:00 2026";

test("single-PID parsing retains lifetime and group with renamed argv #test-557", () => {
	const result = parseProcess(` 123 1 123 ${START} renamed worker --argument with spaces\n`);
	expect(result).toEqual({
		group: 123,
		process: {
			cmd: "renamed worker --argument with spaces",
			pid: 123,
			ppid: 1,
			startTime: Date.parse(START),
		},
	});
});

test.each([
	{ name: "missing start time", output: "123 1 123 worker" },
	{ name: "invalid start time", output: "123 1 123 Sun Bad 18 20:00:00 2026 worker" },
	{ name: "multiple processes", output: `123 1 123 ${START} worker\n456 1 456 ${START} unrelated` },
])("$name process evidence is refused", ({ output }) => {
	expect(() => parseProcess(output)).toThrow(Error);
});

test.each([
	{ name: "exits on TERM", waits: [true], expected: ["verify", "SIGTERM", TERM_GRACE] },
	{
		name: "requires KILL",
		waits: [false, true],
		expected: ["verify", "SIGTERM", TERM_GRACE, "verify", "SIGKILL", STOP_TIMEOUT],
	},
])(
	"owned group $name with bounded grace and verified signal authority",
	async ({ waits, expected }) => {
		const { control, effects, ref } = stopFixture(waits);
		await stopExecution(ref, control);
		expect(effects).toEqual([...expected]);
	},
);

test("an owned group that survives KILL fails after its bounded stop timeout", async () => {
	const { control, effects, ref } = stopFixture([false, false]);
	await expect(stopExecution(ref, control)).rejects.toBeInstanceOf(Error);
	expect(effects).toEqual(["verify", "SIGTERM", TERM_GRACE, "verify", "SIGKILL", STOP_TIMEOUT]);
});

test("ownership failure prevents signalling the process group", async () => {
	const { control, effects, ref } = stopFixture([]);
	control.verify = () => Promise.reject(new Error("Changed process lifetime"));
	await expect(stopExecution(ref, control)).rejects.toBeInstanceOf(Error);
	expect(effects).toEqual([]);
});

test("stop revalidates ownership before escalating beyond TERM", async () => {
	const { control, effects, ref } = stopFixture([false]);
	let verified = false;
	control.verify = () => {
		if (verified) {
			return Promise.reject(new Error("Changed process lifetime"));
		}
		verified = true;
		return Promise.resolve();
	};
	await expect(stopExecution(ref, control)).rejects.toBeInstanceOf(Error);
	expect(effects).toEqual(["SIGTERM", TERM_GRACE]);
});

function stopFixture(waits: readonly boolean[]) {
	const supervisor = { cmd: "worker", pid: 123, ppid: 1, startTime: 1000 };
	const ref = { directory: "/execution", token: "token" };
	const effects: (string | number)[] = [];
	let waited = 0;
	const control: ExecutionControl = {
		supervisor: (execution) => {
			expect(execution).toEqual(ref);
			return Promise.resolve(supervisor);
		},
		verify: (recorded) => {
			expect(recorded).toEqual(supervisor);
			effects.push("verify");
			return Promise.resolve();
		},
		signal: (pid, signal) => {
			expect(pid).toBe(supervisor.pid);
			effects.push(signal);
			return true;
		},
		wait: (pid, timeout) => {
			expect(pid).toBe(supervisor.pid);
			effects.push(timeout);
			const result = waits[waited]!;
			waited += NEXT;
			return Promise.resolve(result);
		},
	};
	return { control, effects, ref };
}
