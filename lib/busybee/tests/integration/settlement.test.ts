/* eslint-disable max-statements --
 * Keep complete scenario setup and observable retirement assertions in each measured test.
 */
import { BusyBeeError, createServices } from "../../src/native.ts";
import { advance, complete, start } from "../../src/runtime.ts";
import { expect, test } from "bun:test";
import type { ExecutionClearanceSelection } from "@hive/shared";
import { createMachine } from "xstate";
import { createMemoryBeads } from "@hive/beads";
import { inspectLifecycle } from "../../src/lifecycle.ts";
import { invoke } from "./support.ts";
import { parseWorkflowClosure } from "@hive/shared";
import { settle } from "../../src/settlement.ts";
import { z } from "zod";

const FIRST = 0;
const SECOND = 1;
const LOCK_INTERVAL = 10_000;
const scope = { actor: "worker", cwd: "/settlement", db: "/settlement/beads.db" };
const definition = {
	inputSchema: z.object({}),
	commandSchemas: { next: z.object({ decision: z.string() }) },
	runBrief: () => ({ title: "Settlement", description: "Retire unfinished scope" }),
	machine: createMachine({
		initial: "group",
		states: {
			group: {
				meta: { title: "Group", task: () => ({ instructions: "Group work" }) },
				initial: "first",
				states: {
					first: {
						meta: {
							title: "First",
							commands: { next: "NEXT" },
							task: () => ({ instructions: "Decide" }),
						},
						on: { NEXT: "second" },
					},
					second: {
						meta: {
							title: "Second",
							commands: { next: "NEXT" },
							task: () => ({ instructions: "Continue" }),
						},
						on: { NEXT: "done" },
					},
					done: { type: "final" },
				},
				onDone: "done",
			},
			done: { type: "final" },
		},
	}),
};

test("#test-85 settlement preserves completed results and retires remaining work without author access", async () => {
	const selected = await fixture();
	const first = selected.run.active.find((entry) => entry.commands.includes("next"))!.bead;
	const data = { decision: "reject", extra: ["preserved"] };
	await complete({ id: selected.run.id, bead: first, choice: "next", data }, {}, selected.services);
	await advance({ id: selected.run.id, mode: "results" }, {}, selected.services);
	const before = await selected.beads.show(scope, first);
	await selected.beads.update(scope, [selected.run.id], {
		notes: "Retain the original run narrative.",
	});
	const replacement = await start(
		"workflow.ts",
		{ owner: "ct", parent: selected.parent },
		selected.services,
	);
	const result = await settle(
		{
			id: selected.run.id,
			operation: "supersede",
			reason: "Remaining scope withdrawn",
			replacementId: replacement.id,
		},
		{},
		selected.sourceFree,
	);
	expect(result).toMatchObject({
		lifecycle: { kind: "terminal", fact: { outcome: "cancelled" } },
		resolution: { kind: "superseded", replacementIds: [replacement.id] },
		publication: { locked: false, settlement: "none" },
	});
	const { dependencies: _beforeDependencies, dependents: _beforeDependents, ...original } = before;
	const {
		dependencies: _afterDependencies,
		dependents: _afterDependents,
		...preserved
	} = await selected.beads.show(scope, first);
	expect(preserved).toEqual(original);
	const root = await selected.beads.show(scope, selected.run.id);
	expect(root.notes).toBe("Retain the original run narrative.");
	const group = await selected.beads.show(scope, selected.run.active[FIRST]!.bead);
	const second = await selected.beads.show(
		scope,
		group.dependents.find((edge) => edge.id !== first)!.id,
	);
	expect(parseWorkflowClosure(second.close_reason)).toMatchObject({
		scope: "visit",
		outcome: "cancelled",
	});
	expect(second.notes).toBe("");
	expect(parseWorkflowClosure(group.close_reason)).toMatchObject({
		scope: "group",
		outcome: "cancelled",
	});
	await expect(
		complete({ id: selected.run.id, bead: first, choice: "next", data }, {}, selected.services),
	).rejects.toMatchObject({ reason: "workflow_retired" });
});

test("#test-86 failed acknowledgment and replacement resolve follow-up without rewriting failure", async () => {
	const selected = await fixture();
	await settle(
		{ id: selected.run.id, operation: "fail", reason: "Execution cannot deliver" },
		{},
		selected.sourceFree,
	);
	const original = await selected.beads.show(scope, selected.run.id);
	const acknowledged = await settle(
		{ id: selected.run.id, operation: "ack", reason: "Accepted failure" },
		{},
		selected.sourceFree,
	);
	expect(acknowledged).toMatchObject({
		lifecycle: { fact: { outcome: "failed" } },
		resolution: { kind: "acknowledged", actor: "worker", reason: "Accepted failure" },
	});
	await settle(
		{ id: selected.run.id, operation: "ack", reason: "Repeated acknowledgment" },
		{},
		selected.sourceFree,
	);
	const replacement = await start(
		"workflow.ts",
		{ owner: "ct", parent: selected.parent },
		selected.services,
	);
	const replaced = await settle(
		{
			id: selected.run.id,
			operation: "supersede",
			reason: "New authorized attempt",
			replacementId: replacement.id,
		},
		{},
		selected.sourceFree,
	);
	expect(replaced).toMatchObject({
		lifecycle: { fact: { outcome: "failed" } },
		resolution: { kind: "superseded", replacementIds: [replacement.id] },
	});
	const retained = await selected.beads.show(scope, selected.run.id);
	expect(retained.close_reason).toBe(original.close_reason);
	expect(retained.closed_at).toBe(original.closed_at);
	expect(retained.comments).toHaveLength(SECOND + SECOND);
});

test.each([
	{ kind: "manual", reason: "unfinished_manual_work" },
	{ kind: "nested", reason: "unfinished_manual_work" },
	{ kind: "human", reason: "reserved_work" },
	{ kind: "hitl", reason: "reserved_work" },
	{ kind: "other-agent", reason: "reserved_work" },
])(
	"#test-87 settlement refuses $kind work before writing an intent or closure",
	async ({ kind, reason }) => {
		const selected = await fixture();
		const visit = selected.run.active[SECOND]!.bead;
		if (kind === "manual") {
			await selected.beads.create(scope, { title: "Manual child", parent: visit });
		} else if (kind === "nested") {
			await start("workflow.ts", { owner: "ct", parent: visit }, selected.services);
		} else if (kind === "hitl") {
			await selected.beads.update(scope, [visit], { addLabels: ["hitl"] });
		} else {
			let assignee = "another-bee";
			if (kind === "human") {
				assignee = "ct";
			}
			await selected.beads.update(scope, [visit], { assignee });
		}
		const result = settle(
			{ id: selected.run.id, operation: "cancel", reason: "Withdraw scope" },
			{},
			selected.sourceFree,
		);
		await expect(result).rejects.toBeInstanceOf(BusyBeeError);
		await expect(result).rejects.toMatchObject({ reason });
		expect(await selected.beads.show(scope, selected.run.id)).toMatchObject({
			status: "in_progress",
			notes: "",
		});
		const checkpointRecord = await checkpoint(selected);
		expect(checkpointRecord.notes).toBe("");
	},
);

test.each([false, true])(
	"#test-88 uncertain native close preserves publication intent and honest facts (write happened: %s)",
	async (written) => {
		const selected = await fixture();
		const failing = {
			...selected.sourceFree,
			beads: {
				...selected.beads,
				close: async (...args: Parameters<typeof selected.beads.close>) => {
					if (args[SECOND] === selected.run.id) {
						if (written) {
							await selected.beads.close(...args);
						}
						throw new Error("Native close did not confirm its effect");
					}
					return selected.beads.close(...args);
				},
			},
		};
		await expect(
			settle({ id: selected.run.id, operation: "fail", reason: "Failed scope" }, {}, failing),
		).rejects.toMatchObject({
			reason: "partial_effects",
			context: { attemptedId: selected.run.id },
		});
		const observed = await inspectLifecycle(selected.run.id, {}, selected.sourceFree);
		expect(observed.publication).toMatchObject({ locked: true, settlement: "pending" });
		let expected: typeof observed.lifecycle.kind = "pending";
		if (written) {
			expected = "terminal";
		}
		expect(observed.lifecycle.kind).toBe(expected);
		if (observed.lifecycle.kind === "terminal") {
			expect(observed.lifecycle.fact.outcome).toBe("failed");
		}
		await expect(
			advance({ id: selected.run.id, mode: "results" }, {}, selected.services),
		).rejects.toMatchObject({ reason: "checkpoint_locked" });
		await expect(
			advance({ id: selected.run.id, mode: "prepare-driver" }, {}, selected.services),
		).rejects.toMatchObject({
			reason: "checkpoint_locked",
		});
	},
);

test(
	"#test-89 retirement between saved result and final close " +
		"cannot publish successful visit completion",
	async () => {
		const selected = await fixture();
		const { bead } = selected.run.active[SECOND]!;
		let retired = false;
		const services = {
			...selected.services,
			beads: {
				...selected.beads,
				update: async (...args: Parameters<typeof selected.beads.update>) => {
					const [selectedScope, ids, input] = args;
					const result = await selected.beads.update(selectedScope, ids, input);
					if (!retired && input.notes === "") {
						retired = true;
						await settle(
							{ id: selected.run.id, operation: "cancel", reason: "Concurrent withdrawal" },
							{},
							selected.sourceFree,
						);
					}
					return result;
				},
			},
		};
		await expect(
			complete(
				{ id: selected.run.id, bead, choice: "next", data: { decision: "saved" } },
				{},
				services,
			),
		).rejects.toMatchObject({ reason: "stage_close_failed" });
		const record = await selected.beads.show(scope, bead);
		expect(record.notes).toBe(JSON.stringify({ choice: "next", data: { decision: "saved" } }));
		expect(parseWorkflowClosure(record.close_reason)).toMatchObject({ outcome: "cancelled" });
		const checkpointRecord = await checkpoint(selected);
		expect(checkpointRecord.notes).toBe("");
	},
);

test("#test-90 the final native visit close holds the same lock needed by retirement", async () => {
	const selected = await fixture();
	const { bead } = selected.run.active[SECOND]!;
	let checked = false;
	const services = {
		...selected.services,
		beads: {
			...selected.beads,
			close: async (...args: Parameters<typeof selected.beads.close>) => {
				checked = true;
				await expect(
					settle(
						{ id: selected.run.id, operation: "cancel", reason: "Concurrent withdrawal" },
						{},
						selected.sourceFree,
					),
				).rejects.toMatchObject({ reason: "checkpoint_locked" });
				return selected.beads.close(...args);
			},
		},
	};
	await complete(
		{ id: selected.run.id, bead, choice: "next", data: { decision: "saved" } },
		{},
		services,
	);
	expect(checked).toBe(true);
	const visit = await selected.beads.show(scope, bead);
	expect(parseWorkflowClosure(visit.close_reason)).toMatchObject({
		outcome: "succeeded",
	});
	const checkpointRecord = await checkpoint(selected);
	expect(checkpointRecord.notes).toBe("");
});

test("#test-91 settlement schema and invalid success operation never select a native endpoint", async () => {
	const services = createServices();
	const offline = {
		...services,
		beads: {
			...services.beads,
			where: () => Promise.reject(new Error("Unexpected native endpoint")),
		},
	};
	expect(await invoke(["settle", "--schema"], offline)).toMatchObject({
		code: 0,
		document: {
			kind: "workflow_settlement_schema",
			inputSchema: { oneOf: expect.any(Array) },
			schema: { type: "object" },
		},
	});
	expect(
		await invoke(["settle", "run", "succeed", "--reason", "Invalid success"], offline),
	).toMatchObject({ code: 1, document: { reason: "invalid_input" } });
});

// --- Private functions ---

async function fixture() {
	const beads = createMemoryBeads({ db: scope.db });
	let now = FIRST;
	const services = {
		...createServices(),
		actor: scope.actor,
		beads,
		cwd: scope.cwd,
		executionClearance: (selection: ExecutionClearanceSelection) =>
			Promise.resolve({
				kind: "execution-clearance" as const,
				repository: { root: scope.cwd, beadsDb: scope.db },
				host: "test-host",
				observedAt: "sampled",
				scope: selection,
				result: { kind: "clear" as const, proof: "no-managed-requests" as const, requests: [] },
			}),
		importModule: () => Promise.resolve(definition),
		readBytes: () => Promise.resolve(new ArrayBuffer(FIRST)),
		now: () => {
			now += LOCK_INTERVAL;
			return now;
		},
		sleep: () => Promise.resolve(),
	};
	const parent = await beads.create(scope, { title: "Pilot B", owner: "ct" });
	const run = await start("workflow.ts", { owner: "ct", parent: parent.id }, services);
	return {
		beads,
		services,
		parent: parent.id,
		run,
		sourceFree: {
			...services,
			importModule: () => Promise.reject(new Error("No author access")),
			readBytes: () => Promise.reject(new Error("No author access")),
		},
	};
}

async function checkpoint(selected: Awaited<ReturnType<typeof fixture>>) {
	const root = await selected.beads.show(scope, selected.run.id);
	return selected.beads.show(
		scope,
		root.dependencies.find((edge) => edge.dependency_type === "related")!.id,
	);
}
