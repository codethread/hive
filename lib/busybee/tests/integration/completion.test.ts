/* eslint-disable unicorn/no-null -- System control encodes absent ownership, settlement and dispatch as null. */
import { BusyBeeError, createServices } from "../../src/native.ts";
import { CommandError, createMemoryBeads } from "@hive/beads";
import { assign, createMachine } from "xstate";
import { complete, navigate, reconcile } from "../../src/runtime.ts";
import { expect, test } from "bun:test";
import type { BeadsService } from "@hive/beads";
import type { Definition } from "../../src/definition.ts";
import type { Run } from "../../src/checkpoint.ts";
import type { Services } from "../../src/native.ts";
import { readCheckpoint } from "../../src/checkpoint.ts";
import { settle } from "../../src/settlement.ts";
import { successfulCompletion } from "../../src/completion.ts";
import { z } from "zod";

const FIRST = 0;
const ONE = 1;
const TWO = 2;
const repo = "/completion-repo";
const db = "/completion-tracker/beads.db";
const scope = { actor: "worker", cwd: repo, db };
const original = { value: "13", extra: ["original", "payload"] };
const transformed = { ...original, value: 13 };
const task = { title: "Work", commands: { next: "NEXT" }, task: () => ({ instructions: "Work" }) };
const definition = {
	inputSchema: z.object({}),
	commandSchemas: {
		next: z.object({ value: z.string().transform(Number), extra: z.array(z.string()) }),
	},
	runBrief: () => ({ title: "Completion", description: "Complete work" }),
	machine: createMachine({
		id: "completion",
		context: { saved: {} },
		initial: "work",
		states: {
			work: {
				meta: task,
				on: { NEXT: { target: "done", actions: assign({ saved: ({ event }) => event.data }) } },
			},
			done: { type: "final" },
		},
	}),
};
const parallelDefinition: Definition = {
	...definition,
	commandSchemas: { left: z.object({}), right: z.object({}) },
	machine: createMachine({
		id: "parallel",
		type: "parallel",
		states: {
			left: {
				initial: "work",
				states: {
					work: { meta: { ...task, commands: { left: "LEFT" } }, on: { LEFT: "done" } },
					done: { type: "final" },
				},
			},
			right: {
				initial: "work",
				states: {
					work: { meta: { ...task, commands: { right: "RIGHT" } }, on: { RIGHT: "done" } },
					done: { type: "final" },
				},
			},
		},
	}),
};

// One original-to-transformed lifecycle also verifies its identical consumed retry.
// eslint-disable-next-line max-statements
test("matching original retry retains notes and transformed collection #test-397", async () => {
	const context = await fixture();
	const notes = '{"choice":"old","data":{"keep":"notes"}}\nAuthored findings.';
	await context.beads.update(scope, [context.request.bead, context.run.id, context.checkpoint], {
		notes,
	});
	await complete(context.request, {}, context.io);
	const saved = await context.control();
	const native = await context.beads.show(scope, context.request.bead);
	expect(native.close_reason).not.toStartWith("{");
	expect(saved.results[context.request.bead]).toEqual({ choice: "next", data: original });
	expect(saved.completions[context.request.bead]).toMatchObject({
		state: "confirmed",
		outcome: "succeeded",
	});
	const done = await navigate({ id: context.run.id, operation: "collect" }, {}, context.io);
	expect(done).toMatchObject({
		status: "done",
		chartStatus: "done",
		completion: "succeeded",
		nativeStatus: "closed",
	});
	await complete(
		{ ...context.request, data: { extra: original.extra, value: original.value } },
		{},
		context.io,
	);
	const collected = await context.control();
	expect(collected.history).toMatchObject([{ data: transformed }]);
	const records = await context.beads.showMany(scope, [
		context.request.bead,
		context.run.id,
		context.checkpoint,
	]);
	expect(records.map((record) => record.notes)).toEqual([notes, notes, notes]);
});

test.each([
	{ point: "original", closes: ONE },
	{ point: "close", closes: TWO },
	{ point: "close-response", closes: TWO },
	{ point: "confirmation", closes: TWO },
	{ point: "labels", closes: ONE },
])(
	"known $point interruption releases ownership and an identical completion converges #test-526",
	// eslint-disable-next-line max-statements -- Check saved intent, recovery and exact native close effects.
	async ({ point, closes }) => {
		const context = await fixture();
		const failure = failOnce(context.beads, point);
		const io = { ...context.io, beads: failure.beads };
		await expect(complete(context.request, {}, io)).rejects.toBeInstanceOf(BusyBeeError);
		const interrupted = await context.control();
		expect(interrupted.lock).toBeNull();
		await complete(context.request, {}, io);
		const repaired = await context.control();
		const native = await context.beads.show(scope, context.request.bead);
		expect(repaired.results[context.request.bead]).toEqual({ choice: "next", data: original });
		expect(repaired.completions[context.request.bead]).toMatchObject({ state: "confirmed" });
		expect(native).toMatchObject({
			status: "closed",
			labels: ["busybee-workflow", "workflow-outcome:succeeded"],
		});
		expect(failure.closes()).toBe(closes);
	},
);

test("conflicting consumed originals cannot replace retained input", async () => {
	const context = await confirmedFixture();
	await expect(
		complete({ ...context.request, data: { ...original, value: "14" } }, {}, context.io),
	).rejects.toMatchObject({ reason: "stage_result_conflict" });
	const saved = await context.control();
	expect(saved.results[context.request.bead]!.data).toEqual(original);
	expect(saved.history).toMatchObject([{ data: transformed }]);
});

test("unchecked native acceptance refuses even without policy and keeps saved intent retryable", async () => {
	const context = await fixture();
	await context.beads.update(scope, [context.request.bead], {
		acceptanceCriteria: "- [ ] Verify actual work",
	});
	await expect(complete(context.request, {}, context.io)).rejects.toMatchObject({
		reason: "acceptance_unchecked",
		context: { resultSaved: true },
	});
	const interrupted = await context.control();
	expect(interrupted.completions[context.request.bead]).toMatchObject({ state: "requested" });
	await context.beads.update(scope, [context.request.bead], {
		acceptanceCriteria: "- [x] Verify actual work",
	});
	await reconcile(context.run.id, {}, context.io);
	const repaired = await context.control();
	expect(repaired.completions[context.request.bead]!.state).toBe("confirmed");
});

test.each(["child", "blocker"] as const)(
	"unfinished native %s prevents successful closure",
	async (kind) => {
		const context = await requestedFixture();
		const dependency = await context.beads.create(scope, { title: "Unfinished work" });
		const edges = {
			child: [dependency.id, context.request.bead, "parent-child"],
			blocker: [context.request.bead, dependency.id, "blocks"],
		} as const;
		const [from, to, type] = edges[kind];
		await context.beads.dep.add(scope, from, to, type);
		await expect(reconcile(context.run.id, {}, context.io)).rejects.toMatchObject({
			reason: "unfinished_work",
		});
		const saved = await context.control();
		const native = await context.beads.show(scope, dependency.id);
		expect(saved.lock).toBeNull();
		expect(native.status).toBe("open");
	},
);

test.each([
	{ status: "blocked", assignee: "worker", labels: [] },
	{ status: "deferred", assignee: "worker", labels: [] },
	{ status: "open", assignee: "other-agent", labels: [] },
	{ status: "open", assignee: "ct", labels: [] },
	{ status: "open", assignee: "worker", labels: ["hitl"] },
])("completion preserves native reservation $status/$assignee/$labels", async (fields) => {
	const context = await fixture();
	await context.beads.update(scope, [context.request.bead], fields);
	const before = await context.beads.show(scope, context.request.bead);
	await expect(complete(context.request, {}, context.io)).rejects.toBeInstanceOf(BusyBeeError);
	expect(await context.beads.show(scope, context.request.bead)).toEqual(before);
	const saved = await context.control();
	expect(saved.results).toEqual({});
});

test("a native revision race cannot close newly edited acceptance", async () => {
	const context = await requestedFixture();
	const beads: BeadsService = {
		...context.beads,
		close: async (selected, id, input) => {
			await context.beads.update(selected, [id], {
				acceptanceCriteria: "- [ ] New work discovered",
			});
			return context.beads.close(selected, id, input);
		},
	};
	await expect(reconcile(context.run.id, {}, { ...context.io, beads })).rejects.toBeInstanceOf(
		CommandError,
	);
	const native = await context.beads.show(scope, context.request.bead);
	const saved = await context.control();
	expect(native.status).toBe("in_progress");
	expect(saved.completions[context.request.bead]!.state).toBe("requested");
	expect(saved.lock).toBeNull();
});

test("definition-free reconcile rejects native closure as result authority", async () => {
	const context = await fixture();
	await context.beads.update(scope, [context.request.bead], {
		notes: "Keep my findings",
		labels: ["unrelated", "workflow-outcome:succeeded"],
	});
	await context.beads.close(scope, context.request.bead, {
		reason: "A direct closure is not a result",
	});
	await reconcile(
		context.run.id,
		{},
		{
			...context.io,
			importModule: () => Promise.reject(new Error("definition unavailable")),
		},
	);
	expect(await context.beads.show(scope, context.request.bead)).toMatchObject({
		status: "open",
		notes: "Keep my findings",
		assignee: "worker",
		labels: ["unrelated"],
	});
	const saved = await context.control();
	expect(saved.results).toEqual({});
	expect(saved.history).toEqual([]);
});

test.each(["reopened", "reason", "timestamp"])(
	"confirmed %s repair retains original history and unrelated mutable work",
	// Compare projection repair against one retained original/history and current work.
	// eslint-disable-next-line max-statements
	async (mutation) => {
		const context = await confirmedFixture();
		const before = await context.control();
		await context.beads.update(scope, [context.request.bead], {
			status: "open",
			notes: "Human findings",
			labels: ["unrelated"],
		});
		if (mutation !== "reopened") {
			let { reason } = before.completions[context.request.bead]!;
			if (mutation === "reason") {
				reason = "Changed prose";
			}
			await context.beads.close(scope, context.request.bead, { reason });
		}
		await reconcile(context.run.id, {}, context.io);
		const after = await context.control();
		expect(after.results).toEqual(before.results);
		expect(after.history).toEqual(before.history);
		expect(after.completions[context.request.bead]).toMatchObject({
			state: "confirmed",
			outcome: "succeeded",
		});
		expect(await context.beads.show(scope, context.request.bead)).toMatchObject({
			status: "closed",
			notes: "Human findings",
			labels: ["unrelated", "workflow-outcome:succeeded"],
		});
	},
);

test("closed work with a human reservation cannot have its claim restored", async () => {
	const context = await confirmedFixture();
	await context.beads.update(scope, [context.request.bead], {
		assignee: "ct",
		notes: "Reserved for inspection",
		status: "open",
	});
	const before = await context.beads.show(scope, context.request.bead);
	await expect(reconcile(context.run.id, {}, context.io)).rejects.toMatchObject({
		reason: "reserved_work",
	});
	expect(await context.beads.show(scope, context.request.bead)).toEqual(before);
});

test.each(["pending", "complete"] as const)(
	"saved %s unsuccessful settlement requires fresh owning-host clearance",
	// eslint-disable-next-line max-statements -- Check retained evidence and fresh host clearance together.
	async (state) => {
		const context = await settledFixture(state);
		const before = await context.control();
		await context.beads.update(scope, [context.request.bead, context.run.id, context.checkpoint], {
			notes: "Keep authored settlement findings",
		});
		let clearances = FIRST;
		const io: Services = {
			...context.io,
			executionClearance: async (selection) => {
				clearances += ONE;
				expect(await context.control()).toMatchObject({ settlement: { state: "pending" } });
				return {
					kind: "execution-clearance",
					repository: { root: repo, beadsDb: db },
					host: "fixture-host",
					observedAt: "2026-01-01T00:00:00Z",
					scope: selection,
					result: { kind: "clear", proof: "no-managed-requests", requests: [] },
				};
			},
		};
		await context.beads.update(scope, [context.request.bead], { status: "open" });
		await expect(reconcile(context.run.id, {}, io)).rejects.toMatchObject({
			reason: "settlement_pending",
		});
		expect(clearances).toBe(FIRST);
		await settle({ id: context.run.id, operation: "fail", reason: "Explicit failure" }, {}, io);
		expect(clearances).toBe(ONE);
		const after = await context.control();
		expect(after).toMatchObject({ settlement: { state: "complete" } });
		expect(after.snapshot).toEqual(before.snapshot);
		const records = await context.beads.showMany(scope, [
			context.request.bead,
			context.run.id,
			context.checkpoint,
		]);
		expect(records.map((record) => record.notes)).toEqual([
			"Keep authored settlement findings",
			"Keep authored settlement findings",
			"Keep authored settlement findings",
		]);
	},
);

test("clearance refusal persists an admission fence before native retirement", async () => {
	const context = await fixture();
	await context.save((saved) => {
		saved.managedExecution = "managed";
	});
	const io: Services = {
		...context.io,
		executionClearance: () => Promise.reject(new Error("owning host unavailable")),
	};
	const request = {
		id: context.run.id,
		operation: "cancel" as const,
		reason: "Operator cancellation",
	};
	await expect(settle(request, {}, io)).rejects.toBeInstanceOf(Error);
	expect(await context.control()).toMatchObject({
		lock: null,
		settlement: { operation: "cancel", state: "pending" },
		completions: {},
	});
	await expect(complete(context.request, {}, io)).rejects.toMatchObject({
		reason: "settlement_pending",
	});
	await expect(
		navigate({ id: context.run.id, operation: "collect" }, {}, io),
	).rejects.toMatchObject({
		reason: "settlement_pending",
	});
	await expect(settle({ ...request, reason: "Different" }, {}, io)).rejects.toMatchObject({
		reason: "settlement_conflict",
	});
	expect(await context.beads.show(scope, context.request.bead)).toMatchObject({
		status: "in_progress",
	});
});

test.each([
	{
		phase: "unchecked",
		state: "requested",
		rootStatus: "in_progress",
		stageStatus: "in_progress",
		labels: ["busybee-workflow"],
	},
	{
		phase: "resolved",
		state: "confirmed",
		rootStatus: "closed",
		stageStatus: "closed",
		labels: ["busybee-workflow", "workflow-outcome:succeeded"],
	},
] as const)(
	"$phase requested success keeps its outcome while settlement retires only unsuccessful scope",
	// eslint-disable-next-line max-statements -- Check intent/native joins at each seeded settlement frontier.
	async ({ phase, state, rootStatus, stageStatus, labels }) => {
		const context = await requestedSuccessFixture(phase);
		const before = await context.control();
		const preserved = await context.beads.show(scope, context.preserved);
		const closed: string[] = [];
		let clearances = FIRST;
		const io: Services = {
			...context.io,
			beads: {
				...context.beads,
				close: (selected, id, input) => {
					closed.push(id);
					return context.beads.close(selected, id, input);
				},
			},
			executionClearance: async (selection) => {
				clearances += ONE;
				expect(await context.control()).toMatchObject({ settlement: { state: "pending" } });
				return {
					kind: "execution-clearance",
					repository: { root: repo, beadsDb: db },
					host: "fixture-host",
					observedAt: "2026-01-01T00:00:00Z",
					scope: selection,
					result: { kind: "clear", proof: "no-managed-requests", requests: [] },
				};
			},
		};
		const retirement = settle(
			{ id: context.run.id, operation: "cancel", reason: "Operator cancellation" },
			{},
			io,
		);
		// eslint-disable-next-line unicorn/prefer-ternary -- Assert rejected and resolved boundaries without a ternary.
		if (phase === "unchecked") {
			await expect(retirement).rejects.toMatchObject({ reason: "settlement_partial" });
		} else {
			await retirement;
		}
		const after = await context.control();
		expect(clearances).toBe(ONE);
		expect(after.lock).toBeNull();
		expect(after.results).toEqual(before.results);
		expect(after.completions[context.request.bead]).toMatchObject({
			state,
			outcome: "succeeded",
			scope: "visit",
			reason: before.completions[context.request.bead]!.reason,
		});
		expect(await context.beads.show(scope, context.request.bead)).toMatchObject({
			status: stageStatus,
			labels,
		});
		expect(after.completions[context.retired]).toMatchObject({
			state: "confirmed",
			outcome: "cancelled",
		});
		expect(after.snapshot).toEqual(before.snapshot);
		expect(after.history).toEqual(before.history);
		expect(await context.beads.show(scope, context.run.id)).toMatchObject({ status: rootStatus });
		expect(await context.beads.show(scope, context.preserved)).toMatchObject({
			updated_at: preserved.updated_at,
			closed_at: preserved.closed_at,
			close_reason: preserved.close_reason,
			assignee: preserved.assignee,
			notes: preserved.notes,
			labels: preserved.labels,
		});
		expect(closed).not.toContain(context.preserved);
	},
);

test("parallel successful originals are serialized without losing either completion", async () => {
	const context = await fixture(parallelDefinition);
	const io = { ...context.io, sleep: () => Promise.resolve() };
	await Promise.all(
		context.run.active.map((entry) =>
			complete(
				{
					id: context.run.id,
					bead: entry.bead,
					choice: Object.keys(entry.meta.commands!)[FIRST]!,
					data: {},
				},
				{},
				io,
			),
		),
	);
	const saved = await context.control();
	expect(Object.keys(saved.results)).toHaveLength(TWO);
	expect(saved.completions).toMatchObject(
		Object.fromEntries(
			context.run.active.map((entry) => [entry.bead, { state: "confirmed", outcome: "succeeded" }]),
		),
	);
});

// --- Fixtures ---

// eslint-disable-next-line max-statements -- Seed trusted system/native state without running completion as setup.
async function fixture(selected: Definition = definition) {
	const beads = createMemoryBeads({ db });
	const io: Services = {
		...createServices(),
		actor: scope.actor,
		beads,
		cwd: repo,
		importModule: () => Promise.resolve(selected),
		readBytes: () => Promise.resolve(new ArrayBuffer(FIRST)),
	};
	const root = await beads.create(scope, {
		title: "Completion run",
		owner: "ct",
		assignee: scope.actor,
		status: "in_progress",
		labels: ["busybee-workflow"],
	});
	let context: Record<string, unknown> = { saved: {} };
	let value: string | Record<string, string> = "work";
	let entries = [{ node: "completion.work", commands: { next: "NEXT" } as Record<string, string> }];
	if (selected === parallelDefinition) {
		context = {};
		value = { left: "work", right: "work" };
		entries = [
			{ node: "parallel.left.work", commands: { left: "LEFT" } },
			{ node: "parallel.right.work", commands: { right: "RIGHT" } },
		];
	}
	const snapshot = {
		status: "active" as const,
		output: undefined,
		error: undefined,
		value,
		context,
		children: {},
		historyValue: {},
	};
	const state: Run = {
		id: root.id,
		formatVersion: 2,
		lock: null,
		managedExecution: "unmanaged",
		results: {},
		completions: {},
		settlement: null,
		active: [],
		created: [],
		definition: { kind: "source", source: "/workflow.ts" },
		// SHA-256 of the empty source supplied by readBytes. Fingerprint loading is outside this fixture boundary.
		hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		history: [],
		visits: {},
		snapshot,
	};
	for (const entry of entries) {
		// eslint-disable-next-line no-await-in-loop -- Native creation assigns each fixture visit its own identity.
		const bead = await beads.create(scope, {
			title: "Work",
			description: "Work",
			parent: root.id,
			owner: "ct",
			assignee: scope.actor,
			status: "in_progress",
			labels: ["busybee-workflow"],
		});
		const key = `:${entry.node}`;
		state.active.push({
			key,
			node: entry.node,
			path: [],
			context,
			bead: bead.id,
			request: null,
			meta: { title: "Work", instructions: "Work", commands: entry.commands },
		});
		state.created.push({
			bead: bead.id,
			scope: "visit",
			node: entry.node,
			parent: root.id,
			path: [],
			request: null,
			visit: ONE,
		});
		state.visits[key] = ONE;
	}
	const system = await beads.create(scope, {
		title: "System",
		description: JSON.stringify(state),
		labels: ["system", "busybee-checkpoint"],
	});
	await beads.dep.add(scope, root.id, system.id, "related");
	const control = async () => readCheckpoint(await beads.show(scope, system.id));
	const save = async (patch: (saved: Run) => void) => {
		const saved = await control();
		patch(saved);
		await beads.update(scope, [system.id], { description: JSON.stringify(saved) });
	};
	const request = {
		id: root.id,
		bead: state.active.find((entry) => entry.meta.commands)!.bead,
		choice: "next",
		data: original,
	};
	return {
		beads,
		checkpoint: system.id,
		control,
		save,
		io,
		request,
		run: { id: root.id, active: state.active },
	};
}

async function requestedFixture(selected: Definition = definition, confirmed = false) {
	const context = await fixture(selected);
	const completion = successfulCompletion("visit", "next");
	await context.save((saved) => {
		saved.results[context.request.bead] = { choice: "next", data: original };
		saved.completions[context.request.bead] = completion;
	});
	if (confirmed) {
		await seedClosure(context, context.request.bead);
	}
	return context;
}

async function confirmedFixture() {
	const context = await requestedFixture(definition, true);
	await context.save((saved) => {
		saved.active = [];
		saved.history = [
			{ bead: context.request.bead, command: "next", data: transformed, request: null },
		];
		const snapshot = {
			...saved.snapshot,
			status: "done" as const,
			error: undefined,
			output: undefined,
			value: "done",
			context: { saved: transformed },
		};
		saved.snapshot = snapshot;
		saved.completions[context.run.id] = successfulCompletion("run");
	});
	await seedClosure(context, context.run.id);
	return context;
}

async function settledFixture(state: "pending" | "complete") {
	const context = await fixture();
	const inventory: NonNullable<Run["settlement"]>["inventory"] = [
		{ id: context.request.bead, scope: "visit" },
		{ id: context.run.id, scope: "run" },
	];
	await context.save((saved) => {
		saved.managedExecution = "managed";
		saved.settlement = {
			operation: "fail",
			reason: "Explicit failure",
			state,
			inventory,
		};
		for (const entry of inventory) {
			saved.completions[entry.id] = {
				scope: entry.scope,
				outcome: "failed",
				state: "requested",
				reason: "Explicit failure",
			};
		}
	});
	for (const entry of inventory) {
		// eslint-disable-next-line no-await-in-loop -- Native child closure must precede its parent.
		await seedClosure(context, entry.id);
	}
	return context;
}

// eslint-disable-next-line max-statements -- Seed exact refused settlement states without replaying their lifecycle.
async function requestedSuccessFixture(phase: "unchecked" | "resolved") {
	const context = await fixture(parallelDefinition);
	const retired = context.run.active[ONE]!.bead;
	const previous = await context.beads.create(scope, {
		title: "Preserved prior visit",
		parent: context.run.id,
		owner: "ct",
		assignee: scope.actor,
		status: "in_progress",
		labels: ["busybee-workflow"],
	});
	await context.save((saved) => {
		saved.managedExecution = "managed";
		saved.created.push({
			bead: previous.id,
			scope: "visit",
			node: "previous",
			parent: context.run.id,
			path: [],
			request: null,
			visit: ONE,
		});
		saved.visits[":previous"] = ONE;
		saved.results[previous.id] = { choice: "next", data: {} };
		saved.completions[previous.id] = successfulCompletion("visit", "next");
		saved.history = [{ bead: previous.id, command: "next", data: {}, request: null }];
		saved.results[context.request.bead] = { choice: "left", data: {} };
		saved.completions[context.request.bead] = successfulCompletion("visit", "left");
	});
	await seedClosure(context, previous.id);
	let acceptanceCriteria = "- [ ] Verify retained successful work";
	if (phase === "resolved") {
		acceptanceCriteria = "- [x] Verify retained successful work";
		await context.save((saved) => {
			saved.settlement = {
				operation: "cancel",
				reason: "Operator cancellation",
				state: "pending",
				inventory: [
					{ id: retired, scope: "visit" },
					{ id: context.run.id, scope: "run" },
				],
			};
			saved.completions[retired] = {
				scope: "visit",
				outcome: "cancelled",
				state: "requested",
				reason: "Operator cancellation",
			};
			saved.completions[context.run.id] = {
				scope: "run",
				outcome: "cancelled",
				state: "requested",
				reason: "Operator cancellation",
			};
		});
		await seedClosure(context, retired);
	}
	await context.beads.update(scope, [context.request.bead], { acceptanceCriteria });
	return { ...context, retired, preserved: previous.id };
}

async function seedClosure(context: Awaited<ReturnType<typeof fixture>>, id: string) {
	const control = await context.control();
	const completion = control.completions[id]!;
	await context.beads.close(scope, id, { reason: completion.reason });
	const record = await context.beads.show(scope, id);
	await context.beads.update(scope, [id], {
		labels: ["busybee-workflow", `workflow-outcome:${completion.outcome}`],
	});
	await context.save((saved) => {
		saved.completions[id] = { ...completion, state: "confirmed", closedAt: record.closed_at! };
	});
}

function failOnce(beads: BeadsService, point: string) {
	let failed = false;
	let closes = FIRST;
	const service: BeadsService = {
		...beads,
		close: async (selected, id, input) => {
			closes += ONE;
			if (point === "close" && !failed) {
				failed = true;
				throw new Error("close interrupted");
			}
			const closed = await beads.close(selected, id, input);
			if (point === "close-response" && !failed) {
				failed = true;
				throw new Error("close response lost");
			}
			return closed;
		},
		update: (selected, ids, input) => {
			let matches = point === "labels" && Boolean(input.setLabels);
			if (input.description) {
				const next = JSON.parse(input.description) as Run;
				const completions = Object.values(next.completions);
				matches ||= point === "original" && completions.some((item) => item.state === "requested");
				matches ||=
					point === "confirmation" && completions.some((item) => item.state === "confirmed");
			}
			if (matches && !failed) {
				failed = true;
				return Promise.reject(new Error(`${point} interrupted`));
			}
			return beads.update(selected, ids, input);
		},
	};
	return { beads: service, closes: () => closes };
}
