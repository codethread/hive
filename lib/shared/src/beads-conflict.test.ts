import { BeadsGitConflictError, isBeadsConflict, notifyBeadsConflict } from "./beads-conflict.ts";
import { expect, test } from "bun:test";
import { CommandError } from "@hive/beads";

const context = {
	beadsDb: "/tracker/.beads/beads.db",
	host: "test-host",
	operation: "sync",
	root: "/repo",
};

test.each([
	{ code: "SYNC_CONFLICT", message: "native failure", expected: true },
	{ code: "UPDATE_PRECONDITION_FAILED", message: "native failure", expected: false },
	{ code: "VALIDATION_FAILED", message: "native failure", expected: false },
	{
		code: "CONFIG_ERROR",
		message: "Configuration error: Merge conflicts detected:\\n  - hv-a: BothModified\\n",
		expected: true,
	},
	{ code: "CONFIG_ERROR", message: "Configuration error: invalid configuration", expected: false },
])("recognizes verified native conflict: $code / $message", ({ code, message, expected }) => {
	const error = new CommandError("br sync", {
		code: 6,
		stderr: "SYNC_CONFLICT in unrelated stderr",
		stdout: JSON.stringify({ error: { code, message } }),
	});
	expect(isBeadsConflict(error)).toBe(expected);
});

test("ordinary command text cannot trigger a conflict notification", async () => {
	const bodies: string[] = [];
	await notifyBeadsConflict(new Error("SYNC_CONFLICT BEADS CONFLICT"), context, {
		notify: (body) => {
			bodies.push(body);
			return Promise.resolve();
		},
		report: () => {},
	});
	expect(bodies).toEqual([]);
});

test.each(["SYNC_CONFLICT", "IO_ERROR"])(
	"recognizes verified causes through publication wrappers: %s",
	(code) => {
		const cause = new CommandError("br update", {
			code: 6,
			stderr: "",
			stdout: JSON.stringify({ error: { code, message: "native diagnostic" } }),
		});
		const inner = new Error(`Publication failed: ${String(cause)}`, { cause });
		const outer = new Error("Operation failed", { cause: inner });
		expect(isBeadsConflict(outer)).toBe(code === "SYNC_CONFLICT");
	},
);

test("Git conflict alert contains host, repository, tracker, original diagnostic and action", async () => {
	const error = new BeadsGitConflictError(".beads/issues.jsonl");
	const bodies: string[] = [];
	await notifyBeadsConflict(error, context, {
		notify: (body) => {
			bodies.push(body);
			return Promise.resolve();
		},
		report: () => {},
	});
	expect(bodies).toEqual([
		`Beads conflict stopped sync.
Host: test-host
Repository: /repo
Tracker: /tracker/.beads/beads.db
BEADS CONFLICT: unresolved tracker merge: .beads/issues.jsonl
Action: stop tracker work, resolve the tracker conflict, then run bun run beads:sync before resuming.`,
	]);
});

test("notification failure is reported while leaving original conflict intact", async () => {
	const error = new BeadsGitConflictError(".beads/issues.jsonl");
	const reports: string[] = [];
	await notifyBeadsConflict(error, context, {
		notify: () => Promise.reject(new Error("cc-notify unavailable")),
		report: (message) => {
			reports.push(message);
		},
	});
	expect(reports).toEqual([
		`Beads conflict notification failed: Error: cc-notify unavailable\n${error.message}`,
	]);
});
