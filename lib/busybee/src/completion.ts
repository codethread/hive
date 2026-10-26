import { BusyBeeError, conditionalUpdate, readBead } from "./native.ts";
import type { MutationEndpoint, Services } from "./native.ts";
import type { Ownership, Run } from "./checkpoint.ts";
import {
	nativeWorkflowState,
	workflowOutcomeLabels,
	workflowOutcomeLabelsCurrent,
} from "@hive/shared";
import type { BeadRecord } from "@hive/beads";
import type { WorkflowCompletion } from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Structural original JSON comparison at the persistence seam.
import { isDeepStrictEqual } from "node:util";
import { patchOwned } from "./checkpoint.ts";

const FIRST = 0;
const ONE = 1;
const blockingTypes = new Set(["blocks", "conditional-blocks", "waits-for"]);
export interface CompletionPublication {
	/** Fresh system state under this invocation's ownership. */
	run: Run;
	/** Selected native endpoint and caller identity. */
	endpoint: MutationEndpoint;
	/** Short system-description ownership window. */
	locked: Ownership;
}

/** Saved chart progress and current native projection are distinct compact observations. */
export function completionStatus(run: Run, record: BeadRecord) {
	const state = nativeWorkflowState(record, { runId: run.id, scope: "run" }, run);
	const chartStatus = run.snapshot.status;
	let completion: "pending" | "projection_pending" | "succeeded" | "failed" | "cancelled" =
		"pending";
	if (state.kind === "terminal") {
		completion = state.fact.outcome;
	} else if (state.kind === "mismatch" || chartStatus === "done") {
		completion = "projection_pending";
	}
	let status: string = chartStatus;
	if (chartStatus === "done" && completion !== "succeeded") {
		status = "completion_pending";
	}
	return { status, chartStatus, completion, nativeStatus: record.status };
}

/** Save the immutable original and successful closure intent together, never in work notes. */
export async function saveOriginal(
	input: CompletionPublication & { bead: string; choice: string; data: unknown },
	services: Services,
): Promise<void> {
	const { bead, choice, data } = input;
	await patchControl(
		input,
		(run) => {
			const saved = run.results[bead];
			if (saved && !isDeepStrictEqual(saved, { choice, data })) {
				throw new BusyBeeError(
					"stage_result_conflict",
					`Task ${bead} has a different saved original result.`,
					{
						context: { runId: run.id, bead },
					},
				);
			}
			const completion = run.completions[bead];
			if (completion && completion.outcome !== "succeeded") {
				throw new BusyBeeError(
					"retired_visit",
					`Task ${bead} was retired without successful completion.`,
					{
						context: { runId: run.id, bead, outcome: completion.outcome },
					},
				);
			}
			run.results[bead] ??= { choice, data };
			run.completions[bead] ??= successfulCompletion("visit", choice);
		},
		services,
	);
}

/** Generated prose is retained once; consumers compare it, never parse its grammar. */
export function successfulCompletion(
	scope: WorkflowCompletion["scope"],
	choice?: string,
): WorkflowCompletion {
	let reason =
		"Authored workflow completed; accepted history and final snapshot saved in the workflow system record.";
	if (scope === "visit") {
		reason =
			`Completed workflow visit with outcome “${choice}”; ` +
			"original result recorded in the workflow system record.";
	} else if (scope === "group") {
		reason =
			"Authored workflow group completed; accepted history and snapshot saved in the workflow system record.";
	}
	return { scope, outcome: "succeeded", state: "requested", reason };
}

/** Validate all generated identities and ancestry before attempting any projection repair. */
// eslint-disable-next-line max-statements -- Reject corrupt identities and ancestry before any repair.
export async function generatedInventory(
	input: CompletionPublication,
	services: Services,
): Promise<BeadRecord[]> {
	const { run, endpoint } = input;
	const ids = new Set([run.id]);
	for (const entry of run.created) {
		if (ids.has(entry.bead) || !["visit", "group"].includes(entry.scope)) {
			throw new BusyBeeError(
				"unsupported_inventory",
				`Workflow ${run.id} repeats or misclassifies generated task ${entry.bead}.`,
			);
		}
		ids.add(entry.bead);
	}
	const records = await services.beads.showMany({ cwd: endpoint.repo, db: endpoint.db }, [...ids]);
	const byId = new Map(records.map((record) => [record.id, record]));
	for (const entry of run.created) {
		const record = byId.get(entry.bead);
		const parents = record?.dependencies.filter((edge) => edge.dependency_type === "parent-child");
		if (
			!record ||
			parents?.length !== ONE ||
			parents[FIRST]!.id !== entry.parent ||
			!ids.has(entry.parent)
		) {
			throw new BusyBeeError(
				"unsupported_inventory",
				`Generated task ${entry.bead} is missing or its ancestry changed.`,
				{ context: { runId: run.id, bead: entry.bead } },
			);
		}
		const ancestors = new Set([entry.bead]);
		let { parent } = entry;
		while (parent !== run.id) {
			if (ancestors.has(parent)) {
				throw new BusyBeeError(
					"unsupported_inventory",
					`Workflow ${run.id} has cyclic generated ancestry.`,
				);
			}
			ancestors.add(parent);
			const ancestor = parent;
			const next = run.created.find((item) => item.bead === ancestor);
			if (!next) {
				throw new BusyBeeError(
					"unsupported_inventory",
					`Workflow ${run.id} has unknown parent ${parent}.`,
				);
			}
			({ parent } = next);
		}
	}
	for (const id of Object.keys(run.completions)) {
		if (!ids.has(id)) {
			throw new BusyBeeError(
				"unsupported_inventory",
				`Completion ${id} is outside workflow ${run.id}.`,
			);
		}
	}
	for (const id of Object.keys(run.results)) {
		if (run.created.find((item) => item.bead === id)?.scope !== "visit") {
			throw new BusyBeeError(
				"unsupported_inventory",
				`Original result ${id} is not a generated visit of ${run.id}.`,
			);
		}
	}
	for (const record of records) {
		nativeWorkflowState(record, { runId: run.id, scope: generatedScope(run, record.id) }, run);
	}
	return records.toSorted((left, right) => depth(run, left.id) - depth(run, right.id));
}

/** Reconcile only known completion projections; never advance charts or recreate work. */
// eslint-disable-next-line max-statements -- Reopen ancestors top-down, then project descendants bottom-up.
export async function projectCompletions(
	input: CompletionPublication & { settlementCleared?: boolean },
	services: Services,
): Promise<{ repairedIds: string[]; confirmedIds: string[] }> {
	const records = await generatedInventory(input, services);
	const repairedIds: string[] = [];
	const confirmedIds: string[] = [];
	// Reopen ancestors first so descendants never need to publish beneath a closed container.
	for (const record of records) {
		const scope = generatedScope(input.run, record.id);
		const state = nativeWorkflowState(record, { runId: input.run.id, scope }, input.run);
		if (state.kind === "mismatch") {
			assertSettlementClearance(input, record.id);
			if (record.status === "closed") {
				assertReservation(record, input.endpoint, services);
				// eslint-disable-next-line no-await-in-loop -- Guarded top-down reopening precedes descendant work.
				await reopen(input.endpoint, record, services);
				repairedIds.push(record.id);
			}
		}
	}
	for (const original of records.toReversed()) {
		// eslint-disable-next-line no-await-in-loop -- Project through fresh gates in bottom-up containment order.
		await projectOne({ ...input, id: original.id, repairedIds, confirmedIds }, services);
	}
	return { repairedIds, confirmedIds };
}

/** Reservations are current native facts, including on a closed task being repaired. */
export function assertReservation(
	record: BeadRecord,
	endpoint: MutationEndpoint,
	services: Services,
): void {
	if (
		record.labels.includes("system") ||
		record.labels.includes("hitl") ||
		(record.assignee && (record.assignee !== endpoint.actor || record.assignee === record.owner))
	) {
		throw new BusyBeeError(
			"reserved_work",
			`Task ${record.id} is reserved; preserve its identity and obtain the owning actor's action.`,
			{
				context: { bead: record.id, assignee: record.assignee },
			},
		);
	}
	if (
		record.status === "blocked" ||
		record.status === "deferred" ||
		record.status === "draft" ||
		(record.defer_until && Date.parse(record.defer_until) > services.now())
	) {
		throw new BusyBeeError(
			"work_not_ready",
			`Task ${record.id} is ${record.status} or deferred; resolve its native readiness before completion repair.`,
			{ context: { bead: record.id } },
		);
	}
}

/** Explicit work gates complement (never bypass) native close policy. */
export async function assertCloseGates(
	record: BeadRecord,
	endpoint: MutationEndpoint,
	services: Services,
): Promise<void> {
	assertReservation(record, endpoint, services);
	const unchecked = record.acceptance_items?.filter((item) => !item.checked) ?? [];
	if (unchecked.length > FIRST) {
		throw new BusyBeeError(
			"acceptance_unchecked",
			`Task ${record.id} has unchecked native acceptance items; verify and tick them before retrying.`,
			{
				context: { bead: record.id, acceptanceItems: unchecked.map((item) => item.index) },
			},
		);
	}
	const edges = [
		...record.dependencies.filter((edge) => blockingTypes.has(edge.dependency_type)),
		...record.dependents.filter((edge) => edge.dependency_type === "parent-child"),
	];
	for (const edge of edges) {
		// eslint-disable-next-line no-await-in-loop -- Native blockers and manual descendants are fresh close gates.
		const related = await readBead(endpoint, edge.id, services);
		if (related.status !== "closed") {
			throw new BusyBeeError(
				"unfinished_work",
				`Task ${record.id} has unfinished child or blocker ${related.id}; complete that work before retrying.`,
				{ context: { bead: record.id, blocker: related.id } },
			);
		}
	}
}

// --- Private functions ---

async function patchControl(
	input: CompletionPublication,
	patch: (run: Run) => void,
	services: Services,
): Promise<void> {
	const fresh = await patchOwned(
		{ endpoint: input.endpoint, locked: input.locked, patch },
		services,
	);
	Object.assign(input.run, fresh);
}

// eslint-disable-next-line max-statements -- Keep closure, confirmation, labels and verification ordered.
async function projectOne(
	input: CompletionPublication & {
		id: string;
		settlementCleared?: boolean;
		repairedIds: string[];
		confirmedIds: string[];
	},
	services: Services,
): Promise<void> {
	const { id, endpoint, run } = input;
	let record = await readBead(endpoint, id, services);
	const scope = generatedScope(run, id);
	let state = nativeWorkflowState(record, { runId: run.id, scope }, run);
	const completion = run.completions[id];
	if (completion && state.kind !== "terminal") {
		assertSettlementClearance(input, id);
		if (record.status === "closed") {
			assertReservation(record, endpoint, services);
			await reopen(endpoint, record, services);
			record = await readBead(endpoint, id, services);
		}
		await assertCloseGates(record, endpoint, services);
		services.beforeWrite();
		await services.beads.close({ actor: endpoint.actor, cwd: endpoint.repo, db: endpoint.db }, id, {
			reason: completion.reason,
			ifUnchanged: record.updated_at,
		});
		record = await readBead(endpoint, id, services);
		if (
			record.status !== "closed" ||
			!record.closed_at ||
			record.close_reason !== completion.reason
		) {
			throw new BusyBeeError(
				"completion_pending",
				`Task ${id} native close response is not a confirmed projection; inspect it and retry.`,
				{ context: { runId: run.id, bead: id } },
			);
		}
		const closedAt = record.closed_at;
		await patchControl(
			input,
			(fresh) => {
				fresh.completions[id] = { ...completion, state: "confirmed", closedAt };
			},
			services,
		);
		input.confirmedIds.push(id);
		state = nativeWorkflowState(record, { runId: run.id, scope }, run);
	}
	if (!workflowOutcomeLabelsCurrent(record.labels, state)) {
		assertReservation(record, endpoint, services);
		if (
			!(await conditionalUpdate(
				{
					endpoint,
					bead: record,
					input: { setLabels: workflowOutcomeLabels(record.labels, state) },
				},
				services,
			))
		) {
			throw new BusyBeeError(
				"workflow_labels_pending",
				`Task ${id} changed during outcome-label projection; retry reconciliation.`,
				{ context: { runId: run.id, bead: id, nativeClosed: record.status === "closed" } },
			);
		}
		input.repairedIds.push(id);
	}
	const fresh = await readBead(endpoint, id, services);
	const observed = nativeWorkflowState(fresh, { runId: run.id, scope }, run);
	if (observed.kind === "mismatch" || !workflowOutcomeLabelsCurrent(fresh.labels, observed)) {
		throw new BusyBeeError(
			"completion_pending",
			`Task ${id} completion projection changed; retry reconciliation without resubmitting its transition.`,
			{ context: { runId: run.id, bead: id } },
		);
	}
}

function assertSettlementClearance(
	input: CompletionPublication & { settlementCleared?: boolean },
	id: string,
): void {
	if (
		((input.run.completions[id] && input.run.completions[id]!.outcome !== "succeeded") ||
			(input.run.settlement?.state === "pending" && !input.run.completions[id])) &&
		!input.settlementCleared
	) {
		throw new BusyBeeError(
			"settlement_pending",
			`Workflow ${input.run.id} requires fresh execution clearance; resume the same settle ` +
				`operation, not generic reconciliation.`,
			{ context: { runId: input.run.id, bead: id } },
		);
	}
}

async function reopen(
	endpoint: MutationEndpoint,
	record: BeadRecord,
	services: Services,
): Promise<void> {
	if (!(await conditionalUpdate({ endpoint, bead: record, input: { status: "open" } }, services))) {
		throw new BusyBeeError("task_changed", `Task ${record.id} changed before guarded reopening.`, {
			context: { bead: record.id },
		});
	}
}

function generatedScope(run: Run, id: string): WorkflowCompletion["scope"] {
	if (id === run.id) {
		return "run";
	}
	return run.created.find((entry) => entry.bead === id)!.scope;
}

function depth(run: Run, id: string): number {
	let count = FIRST;
	let parent = id;
	while (parent !== run.id) {
		count += ONE;
		const ancestor = parent;
		({ parent } = run.created.find((entry) => entry.bead === ancestor)!);
	}
	return count;
}
