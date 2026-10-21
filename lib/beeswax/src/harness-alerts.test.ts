/* eslint-disable unicorn/no-null -- Missing alert state is explicitly not clearance. */
import { expect, test } from "bun:test";
import type { HarnessAlertDependencies } from "./harness-alerts.ts";
import type { TrackerAlertObservation } from "./beads/alerts.ts";
import { fixture } from "../tests/support.ts";
import { runHarnessAlert } from "./harness-alerts.ts";

const CONTEXT_PREVIEW_CHARACTERS = 2000;
const FIRST_CHARACTER = 0;
const active: TrackerAlertObservation = {
	ok: true,
	kind: "tracker_alert",
	database: "/selected/tracker.db",
	alert: {
		id: "incident-one",
		generation: 1,
		state: "active",
		reason: "Snapshot publication failed",
		raisedAt: "2026-10-18T05:00:00Z",
	},
};
const cleared: TrackerAlertObservation = {
	...active,
	alert: {
		...active.alert!,
		state: "cleared",
		clearedAt: "2026-10-18T06:00:00Z",
		evidence: "Authorized recovery and writer pause verified",
	},
};
const receiptPath: HarnessAlertDependencies["receiptPath"] = (database, session) =>
	`/user-state/${encodeURIComponent(database)}/${session.harness}-${session.id}.json`;
const input = JSON.stringify({
	session_id: "session-one",
	cwd: "/different/code/worktree",
	hook_event_name: "PostToolUse",
});

test.each(["claude", "codex", "pi"] as const)(
	"%s delivers the hold and exact incident clearance on successive callbacks #test-571",
	// eslint-disable-next-line max-statements -- Verify one continuous active-to-clear callback sequence.
	// eslint-disable-next-line max-statements -- Verify one continuous active-to-clear callback sequence per vendor.
	async (harness) => {
		const fx = fixture();
		let current = active;
		const deps = { ...fx.deps, receiptPath, observe: () => Promise.resolve(current) };
		const held = await runHarnessAlert(harness, input, deps);
		expect(JSON.stringify(held)).toContain("do not merge");
		expect(JSON.stringify(held)).toContain("explicitly authorized");
		expect(JSON.stringify(held)).toContain("--timeout 60");
		expect([...fx.files.keys()]).toEqual([
			expect.stringMatching(/^\/user-state\/%2Fselected%2Ftracker.db\//u),
		]);
		current = cleared;
		expect(JSON.stringify(await runHarnessAlert(harness, input, deps))).toContain(
			"verified cleared",
		);
		expect(JSON.stringify(await runHarnessAlert(harness, input, deps))).not.toContain(
			"verified cleared",
		);
	},
);

test.each([null, { ...cleared.alert!, id: "another-incident" }])(
	"missing or unrelated clearance does not release a previously observed hold: %j #test-465",
	async (alert) => {
		const fx = fixture();
		let current = active;
		const deps = { ...fx.deps, receiptPath, observe: () => Promise.resolve(current) };
		await runHarnessAlert("codex", input, deps);
		current = { ...active, alert };
		const output = JSON.stringify(await runHarnessAlert("codex", input, deps));
		expect(output).toContain("hold remains");
		expect(output).not.toContain("verified cleared");
	},
);

test("a newer verified endpoint clearance releases an earlier incident even if its activation was missed", async () => {
	const fx = fixture();
	let current = active;
	const deps = { ...fx.deps, receiptPath, observe: () => Promise.resolve(current) };
	await runHarnessAlert("codex", input, deps);
	current = { ...cleared, alert: { ...cleared.alert!, id: "new-incident", generation: 2 } };
	expect(JSON.stringify(await runHarnessAlert("codex", input, deps))).toContain("verified cleared");
});

test("a stale lower-generation clearance cannot release the current hold", async () => {
	const fx = fixture();
	let current: TrackerAlertObservation = { ...active, alert: { ...active.alert!, generation: 2 } };
	const deps = { ...fx.deps, receiptPath, observe: () => Promise.resolve(current) };
	await runHarnessAlert("codex", input, deps);
	current = cleared;
	expect(JSON.stringify(await runHarnessAlert("codex", input, deps))).toContain("hold remains");
});

test.each([
	{ id: "incident-one", generation: 1 },
	{ id: "unrelated-incident", generation: 2 },
])("a late active observation cannot replace a known newer hold: %j", async (late) => {
	const fx = fixture();
	let current: TrackerAlertObservation = {
		...active,
		alert: { ...active.alert!, id: "incident-two", generation: 2 },
	};
	const deps = { ...fx.deps, receiptPath, observe: () => Promise.resolve(current) };
	await runHarnessAlert("codex", input, deps);
	current = { ...active, alert: { ...active.alert!, ...late } };
	await runHarnessAlert("codex", input, deps);
	current = { ...cleared, alert: { ...cleared.alert!, ...late } };
	const output = JSON.stringify(await runHarnessAlert("codex", input, deps));
	expect(output).toContain("hold remains");
	expect(JSON.parse([...fx.files.values()].join(""))).toMatchObject({
		id: "incident-two",
		generation: 2,
		state: "active",
	});
});

test("repeated active callbacks remain concise and retain the recovery exception", async () => {
	const fx = fixture();
	const deps = { ...fx.deps, receiptPath, observe: () => Promise.resolve(active) };
	const first = JSON.stringify(await runHarnessAlert("codex", input, deps));
	const next = JSON.stringify(await runHarnessAlert("codex", input, deps));
	expect(next.length).toBeLessThan(first.length);
	expect(next).toContain("user-authorized recovery");
	expect(next).toContain("do not merge");
});

test("a fresh observer outage returns to baseline after healthy absence without claiming clearance", async () => {
	const fx = fixture();
	let failed = true;
	const deps = {
		...fx.deps,
		receiptPath,
		observe: () => {
			if (failed) {
				throw new Error("Temporary observation failure");
			}
			return Promise.resolve({ ...active, alert: null });
		},
	};
	const paused = JSON.stringify(await runHarnessAlert("codex", input, deps));
	expect(paused).toContain("do not merge");
	failed = false;
	expect(await runHarnessAlert("codex", input, deps)).toEqual({});
	expect([...fx.files.keys()]).toEqual([]);
});

test.each(["unavailable"] as const)(
	"%s callbacks keep immediate guidance visible before long diagnostics",
	async (state) => {
		const fx = fixture();
		const reason = "diagnostic ".repeat(CONTEXT_PREVIEW_CHARACTERS);
		const observe = () => {
			if (state === "unavailable") {
				throw new Error(reason);
			}
			return Promise.resolve({ ...active, alert: { ...active.alert!, reason } });
		};
		const output = JSON.stringify(
			await runHarnessAlert("claude", input, { ...fx.deps, receiptPath, observe }),
		);
		const preview = output.slice(FIRST_CHARACTER, CONTEXT_PREVIEW_CHARACTERS);
		expect(preview).toContain("do not merge");
		expect(preview).toContain("Unrelated non-Beads work");
		expect(preview).toContain("authorized");
		expect(output).toContain(reason);
	},
);
