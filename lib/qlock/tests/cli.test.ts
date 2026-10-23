// Tests spell out expected IDs, timings and the domain null urgency.
/* eslint-disable no-magic-numbers, unicorn/no-null */
import type { Dependencies, LockTarget, Request, TicketRequest } from "../src/run.ts";
import { QlockError, emptyQueue, finish } from "../src/queue.ts";
import { expect, test } from "bun:test";
import type { QueueState } from "../src/queue.ts";
import { runCli } from "../src/cli.ts";
import { runRequest } from "../src/run.ts";

// Initialize Commander parsing and help before timing individual contracts.
await runCli(["status", "--json", "--lock", "/lock"], fixture().deps);
await runCli(["--help"], fixture().deps);

test("status emits one JSON envelope without allocating a ticket #test-634", async () => {
	const harness = fixture(occupiedQueue());
	expect(await runCli(["status", "--json", "--lock", "/lock"], harness.deps)).toBe(0);
	expect(JSON.parse(harness.out.join(""))).toMatchObject({
		ok: true,
		kind: "status",
		lock: "/lock",
		tickets: [
			{ id: 1, state: "running" },
			{ id: 2, state: "queued" },
		],
	});
	expect(harness.queue).toEqual(occupiedQueue());
	expect(harness.err).toEqual([]);
	expect(harness.commands).toEqual([]);
});

test("status of a free queue never joins it #test-639", async () => {
	const harness = fixture();
	expect(await runCli(["status", "--lock", "/lock"], harness.deps)).toBe(0);
	expect(harness.out).toEqual(["free\n"]);
	expect(harness.queue).toEqual(emptyQueue());
});

// eslint-disable-next-line max-statements -- Verify ticket identity throughout timeout, resumption and completion.
test("new exec times out retaining its ticket, and resumed exec does not reallocate #test-478", async () => {
	const harness = fixture(finish(occupiedQueue(), 2));
	expect(
		await runCli(["exec", "-w", "2", "-E", "91", "--lock", "/lock", "--", "child"], harness.deps),
	).toBe(91);
	expect(harness.sleeps).toEqual([1000, 1000]);
	expect(harness.err.join("")).toContain("--ticket 3");
	expect(harness).toMatchObject({ out: [], commands: [] });
	expect(harness.queue.tickets.map(({ id }) => id)).toEqual([1, 3]);
	const resume = execRequest({ kind: "existing", id: 3 });
	const waiting = runRequest(resume, harness.deps);
	await expect(waiting).rejects.toBeInstanceOf(QlockError);
	await expect(waiting).rejects.toMatchObject({
		reason: "timed_out",
		context: { ticket: 3, position: 2, total: 2 },
	});
	expect(harness.queue.nextId).toBe(4);
	expect(harness.queue.tickets.map(({ id }) => id)).toEqual([1, 3]);
	harness.queue = finish(harness.queue, 1);
	await expect(runRequest(resume, harness.deps)).resolves.toEqual({ kind: "executed", code: 23 });
	expect(harness.queue).toEqual({ nextId: 4, tickets: [] });
	expect(harness.commands).toEqual([["child"]]);
	const repeated = runRequest(resume, harness.deps);
	await expect(repeated).rejects.toBeInstanceOf(QlockError);
	await expect(repeated).rejects.toMatchObject({ reason: "ticket_gone", context: { ticket: 3 } });
	expect(harness.queue).toEqual({ nextId: 4, tickets: [] });
	expect(harness.commands).toEqual([["child"]]);
});

test("resumed exec waits for its existing ticket and claims before launching #test-533", async () => {
	const harness = fixture(occupiedQueue());
	harness.deps.sleep = (ms) => {
		harness.sleeps.push(ms);
		harness.now += ms;
		harness.queue = finish(harness.queue, 1);
		return Promise.resolve();
	};
	harness.deps.execute = (command) => {
		expect(harness.queue.tickets).toEqual([
			{
				id: 2,
				cwd: "/caller",
				urgent: null,
				state: "running",
				pid: 42,
				command,
				startedAt: 1000,
			},
		]);
		return Promise.resolve(23);
	};
	expect(
		await runCli(
			["exec", "-w", "2", "--ticket", "2", "--lock", "/lock", "--", "child"],
			harness.deps,
		),
	).toBe(23);
	expect(harness.sleeps).toEqual([1000]);
	expect(harness.queue).toEqual({ nextId: 3, tickets: [] });
});

test.each([
	{ id: "1", code: 75 },
	{ id: "42", code: 3 },
])("refuses running or gone ticket $id without allocating a replacement", async ({ id, code }) => {
	const harness = fixture(occupiedQueue());
	expect(
		await runCli(
			["exec", "-w", "0", "--ticket", id, "--lock", "/lock", "--", "child"],
			harness.deps,
		),
	).toBe(code);
	expect(harness.commands).toEqual([]);
	expect(harness.queue).toEqual(occupiedQueue());
});

test("a new urgent ticket moves ahead of queued work but not the running command", async () => {
	const harness = fixture(occupiedQueue());
	expect(
		await runCli(
			["exec", "-w", "0", "--urgent", "user blocked", "--lock", "/lock", "--", "child"],
			harness.deps,
		),
	).toBe(75);
	expect(harness.queue.tickets.map(({ id }) => id)).toEqual([1, 3, 2]);
	expect(harness.queue.tickets[1]).toMatchObject({ state: "queued", urgent: "user blocked" });
	expect(harness.commands).toEqual([]);
});

test("execution preserves child flags and status and releases its reservation", async () => {
	const harness = fixture();
	expect(
		await runCli(
			["exec", "-w", "0", "--lock", "/lock", "--", "child", "--json", "--help", "space value"],
			harness.deps,
		),
	).toBe(23);
	expect(harness.commands).toEqual([["child", "--json", "--help", "space value"]]);
	expect(harness.queue.tickets).toEqual([]);
	expect(harness.out).toEqual([]);
	expect(harness.closed).toBe(1);
});

test.each([
	{ ticket: { kind: "new", urgent: null }, id: 3 },
	{ ticket: { kind: "existing", id: 2 }, id: 2 },
])("waiting failures retain ticket context: $ticket.kind", async ({ ticket, id }) => {
	const harness = fixture(occupiedQueue());
	harness.deps.sleep = () => Promise.reject(new Error("clock unavailable"));
	const result = runRequest(execRequest(ticket), harness.deps);
	await expect(result).rejects.toBeInstanceOf(QlockError);
	await expect(result).rejects.toMatchObject({
		reason: "execution_failed",
		context: { lock: "/lock", ticket: id },
	});
	expect(harness.queue.tickets.some((entry) => entry.id === id)).toBe(true);
	expect(harness.commands).toEqual([]);
	expect(harness.closed).toBe(1);
});

test.each([
	{ stage: "open", context: { lock: "/lock", ticket: 42 } },
	{ stage: "resolve", context: { ticket: 42 } },
])("$stage failures retain the supplied ticket", async ({ stage, context }) => {
	const harness = fixture();
	if (stage === "open") {
		harness.deps.openQueue = () => Promise.reject(new Error("queue unavailable"));
	} else {
		harness.deps.resolveLock = () => Promise.reject(new Error("repository unavailable"));
	}
	const result = runRequest(execRequest({ kind: "existing", id: 42 }), harness.deps);
	await expect(result).rejects.toBeInstanceOf(QlockError);
	await expect(result).rejects.toMatchObject({ reason: "execution_failed", context });
	expect(harness.commands).toEqual([]);
});

test("spawn failure releases the reservation and does not mistake a flag value for JSON", async () => {
	const harness = fixture();
	harness.deps.execute = () => Promise.reject(new Error("spawn failed"));
	expect(
		await runCli(
			["exec", "-w", "0", "--urgent", "--json", "--lock", "/lock", "--", "child"],
			harness.deps,
		),
	).toBe(1);
	expect(harness.queue.tickets).toEqual([]);
	expect(harness.out).toEqual([]);
	expect(harness.err.join("")).toContain("spawn failed");
	expect(harness.closed).toBe(1);
});

test.each(
	[
		["run", "-w", "0", "/lock", "child"],
		["take", "/lock"],
		["await", "-w", "0", "--ticket", "1", "/lock"],
		["-w", "0", "/lock", "child"],
		["exec", "-w", "0", "/lock", "child"],
		["exec", "--lock", "/lock", "--", "child"],
		["exec", "-w", "0", "--lock", "/lock", "--"],
		["exec", "-w", "0", "--", "child"],
		["exec", "-w", "0", "--lock", " ", "--", "child"],
		["exec", "-w", "1.5", "--lock", "/lock", "--", "child"],
		["exec", "-w", "-2", "--lock", "/lock", "--", "child"],
		["exec", "-w", "0", "--ticket", "9007199254740992", "--lock", "/lock", "--", "child"],
		["exec", "-w", "0", "--ticket", "0", "--lock", "/lock", "--", "child"],
		["exec", "-w", "0", "-E", "256", "--lock", "/lock", "--", "child"],
		["exec", "-w", "0", "--urgent", " ", "--lock", "/lock", "--", "child"],
		["exec", "-w", "0", "--urgent", "fix", "--ticket", "1", "--lock", "/lock", "--", "child"],
		["exec", "-w", "0", "--ticket", "1", "--urgent", "fix", "--lock", "/lock", "--", "child"],
		["exec", "-w", "0", "--merge-target", "refs/tags/main", "--", "child"],
		["exec", "-w", "0", "--lock", "/lock", "--merge-target", "main", "--", "child"],
		["exec", "-w", "0", "--merge-target", "main", "--lock", "/lock", "--", "child"],
		["exec", "-w", "--json", "--lock", "/lock", "--", "child"],
		["exec", "--ticket", "--json", "-w", "0", "--lock", "/lock", "--", "child"],
		["exec", "--json", "-w", "0", "--lock", "/lock", "--", "child"],
		["--json", "exec", "-w", "0", "--lock", "/lock", "--", "child"],
		["status", "/lock"],
		["status", "--lock", " ", "--json"],
		["status", "--lock", "/lock", "--", "--json"],
		["--json", "status", "--lock", "/lock"],
	].map((argv) => ({ argv })),
)("rejects invalid invocation before queue IO: $argv #test-528", async ({ argv }) => {
	const harness = fixture();
	expect(await runCli(argv, harness.deps)).toBe(2);
	expect(harness.err.join("")).toContain("qlock:");
	expect(harness.out).toEqual([]);
	expect(harness.opened).toBe(0);
	expect(harness.commands).toEqual([]);
});

test.each(
	[
		["status", "--json", "--bad", "--lock", "/lock"],
		["status", "--json", "--ticket", "1", "--lock", "/lock"],
		["status", "--json"],
		["status", "--json", "--lock", "/lock", "extra"],
		["status", "--json", "--lock", " "],
		["status", "--json", "--merge-target", "main", "--lock", "/lock"],
	].map((argv) => ({ argv })),
)("recognized JSON mode formats usage failures: $argv #test-342", async ({ argv }) => {
	const harness = fixture();
	expect(await runCli(argv, harness.deps)).toBe(2);
	expect(JSON.parse(harness.out.join(""))).toMatchObject({
		ok: false,
		kind: "error",
		reason: "usage",
	});
	expect(harness.err).toEqual([]);
	expect(harness.opened).toBe(0);
});

test.each([
	{ options: ["--lock", "relative.lock"], target: { lock: "relative.lock" } },
	{ options: ["--merge-target", "main"], target: { mergeTarget: "refs/heads/main" } },
])(
	"JSON usage errors retain parsed target options without resolving: $options #test-341",
	async ({ options, target }) => {
		const harness = fixture();
		expect(await runCli(["status", "--json", ...options, "--bad"], harness.deps)).toBe(2);
		const error = JSON.parse(harness.out.join(""));
		expect(error).toMatchObject({ ok: false, reason: "usage", target });
		expect(error).not.toHaveProperty("lock");
		expect(harness.targets).toEqual([]);
		expect(harness.opened).toBe(0);
		expect(harness.err).toEqual([]);
	},
);

test.each([
	{ argv: ["-h"], heading: "Usage: qlock [options]" },
	{ argv: ["--help"], heading: "Usage: qlock [options]" },
	{ argv: ["exec", "--help"], heading: "Usage: qlock exec [options] -- <command> [args...]" },
	{ argv: ["help", "exec"], heading: "Usage: qlock exec [options] -- <command> [args...]" },
	{ argv: ["status", "--json", "--help"], heading: "Usage: qlock status [options]" },
])(
	"help stays concise and shows only supported options: $argv #test-407",
	async ({ argv, heading }) => {
		const harness = fixture();
		expect(await runCli(argv, harness.deps)).toBe(0);
		const help = harness.out.join("");
		expect(help).toContain(heading);
		expect(help.split("\n").length).toBeLessThanOrEqual(30);
		expect(/^\s+--json\s/mu.test(help)).toBe(argv[0] === "status");
		expect(harness.err).toEqual([]);
		expect(harness.opened).toBe(0);
	},
);

test.each([
	{ argv: ["-h"] },
	{ argv: ["--help"] },
	{ argv: ["exec", "--help"] },
	{ argv: ["help", "exec"] },
])("help illustrates how to resume after a wait timeout: $argv #test-417", async ({ argv }) => {
	const harness = fixture();
	expect(await runCli(argv, harness.deps)).toBe(0);
	const help = harness.out.join("");
	expect(help).toContain("qlock exec --lock /tmp/check.lock -w 180 -- bun run check");
	expect(help).toContain("Queue wait timeout (-w, not command runtime)");
	expect(help).toContain("qlock: Ticket 42 still queued (#2/2); resume with --ticket 42 before --");
	expect(help).toContain("qlock exec --lock /tmp/check.lock -w 180 --ticket 42 -- bun run check");
	expect(help).toContain("--ticket keeps your place; omit it to join again");
	expect(help).toContain("No background execution. Ready tickets expire after 30s");
});

test.each([
	{ argv: ["exec", "-w0", "--lock", "/lock"], target: { kind: "path", path: "/lock" } },
	{ argv: ["exec", "--wait=0", "--lock=/lock"], target: { kind: "path", path: "/lock" } },
	{ argv: ["exec", "-w0", "--lock=--lock"], target: { kind: "path", path: "--lock" } },
	{
		argv: ["exec", "-w0", "--merge-target=main"],
		target: { kind: "merge", ref: "refs/heads/main" },
	},
	{
		argv: ["exec", "-w0", "--merge-target", "refs/heads/main"],
		target: { kind: "merge", ref: "refs/heads/main" },
	},
])(
	"exec forwards the complete child invocation after -- for $argv #test-635",
	async ({ argv, target }) => {
		const harness = fixture();
		const child = ["child", "--help", "--json", "--", "-w", "99", "space value", ""];
		expect(await runCli([...argv, "--", ...child], harness.deps)).toBe(23);
		expect(harness.targets).toEqual([target]);
		expect(harness.commands).toEqual([child]);
		expect(harness.out).toEqual([]);
	},
);

function execRequest(ticket: TicketRequest): Request {
	return {
		operation: { kind: "exec", ticket, command: ["child"], waitSeconds: 2, timeoutCode: 75 },
		target: { kind: "path", path: "/lock" },
	};
}

function occupiedQueue(): QueueState {
	return {
		nextId: 3,
		tickets: [
			{
				id: 1,
				cwd: "/other",
				urgent: null,
				state: "running",
				pid: 99,
				command: ["build"],
				startedAt: 0,
			},
			{ id: 2, cwd: "/caller", urgent: null, state: "queued" },
		],
	};
}

function fixture(queue = emptyQueue()) {
	const state = {
		queue,
		now: 0,
		out: [] as string[],
		err: [] as string[],
		commands: [] as string[][],
		targets: [] as LockTarget[],
		sleeps: [] as number[],
		opened: 0,
		closed: 0,
	};
	const deps: Dependencies = {
		resolveLock: (target) => {
			state.targets.push(target);
			return Promise.resolve("/lock");
		},
		openQueue: () => {
			state.opened += 1;
			return Promise.resolve({
				update: (transform) => {
					state.queue = transform(state.queue);
					return state.queue;
				},
				close: () => {
					state.closed += 1;
				},
			});
		},
		now: () => state.now,
		sleep: (ms) => {
			state.sleeps.push(ms);
			state.now += ms;
			return Promise.resolve();
		},
		isAlive: () => true,
		execute: (command) => {
			state.commands.push(command);
			return Promise.resolve(23);
		},
		pid: 42,
		cwd: "/caller",
		stdout: (text) => {
			state.out.push(text);
		},
		stderr: (text) => {
			state.err.push(text);
		},
	};
	return Object.assign(state, { deps });
}
