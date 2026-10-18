import {
	BusyBeeError,
	closeObservedTask,
	conditionalUpdate,
	createServices,
	readBead,
} from "./native.ts";
import type { MutationEndpoint, Options, Services } from "./native.ts";
import type { NativeWorkflowState, WorkflowClosure, WorkflowSettlementIntent } from "@hive/shared";
import {
	WORKFLOW_ACKNOWLEDGMENT_PREFIX,
	WORKFLOW_SETTLEMENT_PREFIX,
	nativeWorkflowState,
	parseWorkflowClosure,
	parseWorkflowSettlement,
	readSpawnRequest,
	workflowAcknowledgment,
	workflowLifecycleSchema,
} from "@hive/shared";
import { checkpointRecords, withRunPublication } from "./runtime.ts";
import type { BeadRecord } from "@hive/beads";
import type { Run } from "./checkpoint.ts";
import { inspectLifecycleAt } from "./lifecycle.ts";
import { readCheckpoint } from "./checkpoint.ts";
import { z } from "zod";

const ONE = 1;
const FIRST = 0;
const text = z.string().trim().min(ONE);
export const settlementRequestSchema = z.discriminatedUnion("operation", [
	z.object({
		id: text,
		operation: z.enum(["cancel", "fail"]),
		reason: text,
		replacementId: text.optional(),
	}),
	z.object({ id: text, operation: z.literal("ack"), reason: text }),
	z.object({ id: text, operation: z.literal("supersede"), reason: text, replacementId: text }),
]);
export type SettlementRequest = z.infer<typeof settlementRequestSchema>;
export const settlementResultSchema = workflowLifecycleSchema.extend({
	operation: z.enum(["cancel", "fail", "ack", "supersede"]),
	closedIds: z.array(text),
});
const createdEntrySchema = z.object({ bead: text, parent: text, request: text.nullable() });
const activeMetadataSchema = z.object({ commands: z.record(z.string(), text).optional() });
const activeEntrySchema = z.object({ bead: text, meta: activeMetadataSchema });
const inventorySchema = z.object({
	created: z.array(createdEntrySchema),
	active: z.array(activeEntrySchema),
});
interface PendingTask {
	/** Inspected native revision, checked again before closure. */
	record: BeadRecord;
	/** Published worker or container scope from the recognized inventory. */
	scope: "visit" | "group";
}
interface Inventory {
	/** Unfinished generated work in bottom-up closure order. */
	pending: PendingTask[];
	/** Related requests, including predecessors and explicit replacements. */
	requests: BeadRecord[];
	/** Revisions of the entire inspected descendant tree, including preserved manual work. */
	versions: { id: string; updatedAt: string }[];
}

/** Explicit unsuccessful disposition and follow-up; authored completion alone publishes success. */
export async function settle(
	request: SettlementRequest,
	options: Options = {},
	services: Services = createServices(),
) {
	const { effect, endpoint: selectedEndpoint } = await withRunPublication(
		{ id: request.id, options, services },
		// eslint-disable-next-line max-statements -- Keep disposition preflight and publication under one owner.
		async (publication, writes) => {
			const { endpoint, run, owner } = publication;
			const root = await readBead(endpoint, request.id, writes);
			assertNoIntent(root);
			assertReservation(root, endpoint.actor);
			const state = readLifecycle(root, { runId: run.id, scope: "run" });
			const inventory = await inspectInventory({ run, root, endpoint }, writes);
			await assertExecutionClearance({ run, inventory, endpoint }, writes);
			if (request.operation === "ack") {
				await acknowledge({ root, state, reason: request.reason, endpoint }, writes);
				return { endpoint, effect: { operation: request.operation, closedIds: [] } };
			}
			if (request.operation === "supersede" && state.kind !== "pending") {
				assertUnsuccessful(root, state);
				await linkReplacement(
					{ root, replacementId: request.replacementId, reason: request.reason, endpoint },
					writes,
				);
				return { endpoint, effect: { operation: request.operation, closedIds: [] } };
			}
			if (state.kind !== "pending") {
				throw new BusyBeeError("workflow_not_pending", `Workflow ${root.id} is already closed.`, {
					context: { runId: root.id },
				});
			}
			if (request.replacementId) {
				await validateReplacement({ root, replacementId: request.replacementId, endpoint }, writes);
			}
			const freshRoot = await readBead(endpoint, run.id, writes);
			const refreshed = await inspectInventory({ run, root: freshRoot, endpoint }, writes);
			if (
				JSON.stringify(refreshed.versions) !== JSON.stringify(inventory.versions) ||
				JSON.stringify(refreshed.requests.map(({ id, updated_at }) => ({ id, updated_at }))) !==
					JSON.stringify(inventory.requests.map(({ id, updated_at }) => ({ id, updated_at })))
			) {
				throw new BusyBeeError(
					"inventory_changed",
					`Workflow ${run.id} changed during execution clearance.`,
				);
			}
			let operation: WorkflowSettlementIntent["operation"] = "cancel";
			if (request.operation === "fail") {
				operation = "fail";
			}
			const intent: WorkflowSettlementIntent = {
				owner,
				runId: run.id,
				operation,
				reason: request.reason,
				// eslint-disable-next-line unicorn/no-null -- The persisted intent explicitly records no replacement.
				replacementId: request.replacementId ?? null,
				inventory: inventory.pending.map(({ record, scope }) => ({
					id: record.id,
					updatedAt: record.updated_at,
					scope,
				})),
			};
			return {
				endpoint,
				effect: await publishSettlement({ root, intent, inventory, endpoint }, writes),
			};
		},
	);
	return {
		...effect,
		operation: request.operation,
		...(await inspectLifecycleAt(request.id, selectedEndpoint, services)),
	};
}

// --- Private functions ---

/* eslint-disable-next-line max-statements --
 * Hydrate and compare the whole native containment tree before destructive work.
 */
async function inspectInventory(
	input: { run: Run; root: BeadRecord; endpoint: MutationEndpoint },
	services: Services,
): Promise<Inventory> {
	const { run, root, endpoint } = input;
	const inventory = inventorySchema.parse(run);
	const generated = new Map(inventory.created.map((entry) => [entry.bead, entry]));
	if (generated.size !== inventory.created.length || generated.has(run.id)) {
		throw new BusyBeeError(
			"unsupported_inventory",
			`Workflow ${run.id} has duplicate generated identities.`,
		);
	}
	const active = new Map(inventory.active.map((entry) => [entry.bead, entry]));
	if (active.size !== inventory.active.length) {
		throw new BusyBeeError(
			"unsupported_inventory",
			`Workflow ${run.id} repeats an active identity.`,
		);
	}
	const seen = new Set<string>();
	const requests = new Map<string, BeadRecord>();
	const pending: PendingTask[] = [];
	const versions: Inventory["versions"] = [];
	/* eslint-disable-next-line max-statements --
	 * A descendant is classified only after its complete native subtree is inspected.
	 */
	const visit = async (record: BeadRecord): Promise<void> => {
		if (seen.has(record.id)) {
			throw new BusyBeeError("unsupported_inventory", `Repeated native descendant ${record.id}.`);
		}
		seen.add(record.id);
		versions.push({ id: record.id, updatedAt: record.updated_at });
		const entry = generated.get(record.id);
		if (record.id !== root.id && entry) {
			const parents = record.dependencies.filter((edge) => edge.dependency_type === "parent-child");
			if (parents.length !== ONE || parents[FIRST]!.id !== entry.parent) {
				throw new BusyBeeError(
					"unsupported_inventory",
					`Generated parentage changed for ${record.id}.`,
				);
			}
			const fact = parseWorkflowClosure(record.close_reason);
			if (fact) {
				if (fact.scope === "run") {
					throw new BusyBeeError(
						"invalid_lifecycle",
						`Generated task ${record.id} carries a run closure.`,
					);
				}
				readLifecycle(record, { runId: run.id, scope: fact.scope });
			}
		}
		if (record.status !== "closed" && record.id !== root.id && !entry) {
			throw new BusyBeeError(
				"unfinished_manual_work",
				`Unfinished work ${record.id} is outside generated inventory.`,
				{
					context: { runId: run.id, bead: record.id },
				},
			);
		}
		for (const edge of record.dependents.filter(
			(item) => item.dependency_type === "parent-child",
		)) {
			// eslint-disable-next-line no-await-in-loop -- Inspect native descendants bottom-up without publishing effects.
			await visit(await readBead(endpoint, edge.id, services));
		}
		if (record.id === root.id || entry) {
			await inventoryRequests({ record, requests, endpoint }, services);
		}
		if (entry && record.status !== "closed") {
			const current = active.get(record.id);
			if (!current) {
				throw new BusyBeeError(
					"unsupported_inventory",
					`Unfinished generated task ${record.id} is absent from the frontier.`,
				);
			}
			assertReservation(record, endpoint.actor);
			let scope: PendingTask["scope"] = "group";
			if (current.meta.commands) {
				scope = "visit";
			}
			pending.push({ record, scope });
		}
	};
	await visit(root);
	if (
		[...generated.keys()].some((id) => !seen.has(id)) ||
		[...active.keys()].some((id) => !generated.has(id))
	) {
		throw new BusyBeeError(
			"unsupported_inventory",
			`Workflow ${run.id} inventory disagrees with native ancestry.`,
		);
	}
	for (const entry of inventory.created) {
		if (entry.request && !requests.has(entry.request)) {
			throw new BusyBeeError(
				"unsupported_inventory",
				`Generated request ${entry.request} has no native task association.`,
			);
		}
	}
	return {
		pending,
		requests: [...requests.values()].toSorted((left, right) => left.id.localeCompare(right.id)),
		versions: versions.toSorted((left, right) => left.id.localeCompare(right.id)),
	};
}

/* eslint-disable-next-line max-statements --
 * Preserve the native task/request association before accepting host clearance.
 */
async function inventoryRequests(
	input: { record: BeadRecord; requests: Map<string, BeadRecord>; endpoint: MutationEndpoint },
	services: Services,
): Promise<void> {
	const { record, requests, endpoint } = input;
	for (const edge of record.dependents.filter((item) => item.dependency_type === "related")) {
		// eslint-disable-next-line no-await-in-loop -- Native associations establish the complete request set.
		const candidate = await readBead(endpoint, edge.id, services);
		if (candidate.labels.includes("system") && candidate.labels.includes("bee")) {
			const request = readSpawnRequest(candidate);
			let anchor = request.assignment.runId;
			if (request.assignment.kind === "stage") {
				anchor = request.assignment.stageId;
			}
			if (anchor !== record.id) {
				throw new BusyBeeError(
					"unsupported_inventory",
					`Request ${candidate.id} disagrees with anchor ${record.id}.`,
				);
			}
			requests.set(candidate.id, candidate);
		}
	}
}

async function assertExecutionClearance(
	input: { run: Run; inventory: Inventory; endpoint: MutationEndpoint },
	services: Services,
): Promise<void> {
	const { run, inventory, endpoint } = input;
	const anchorIds = [run.id, ...run.created.map(({ bead }) => bead)].toSorted();
	const observed = await services.executionClearance({ runId: run.id, anchorIds }, endpoint);
	const expectedRequests = inventory.requests.map(({ id }) => id).toSorted();
	if (
		observed.result.kind !== "clear" ||
		observed.scope.runId !== run.id ||
		observed.repository.beadsDb !== endpoint.db ||
		JSON.stringify(observed.scope.anchorIds.toSorted()) !== JSON.stringify(anchorIds) ||
		JSON.stringify(observed.result.requests.map(({ id }) => id).toSorted()) !==
			JSON.stringify(expectedRequests) ||
		inventory.requests.some((record) => readSpawnRequest(record).host !== observed.host)
	) {
		throw new BusyBeeError(
			"execution_not_cleared",
			`Workflow ${run.id} lacks complete owning-host execution clearance.`,
			{
				context: { runId: run.id, observation: observed },
			},
		);
	}
}

/* eslint-disable-next-line max-statements --
 * Preserve ordered native effects and their exact partial-publication evidence together.
 */
async function publishSettlement(
	input: {
		root: BeadRecord;
		intent: WorkflowSettlementIntent;
		inventory: Inventory;
		endpoint: MutationEndpoint;
	},
	services: Services,
) {
	const { root, intent, inventory, endpoint } = input;
	let notes = `${WORKFLOW_SETTLEMENT_PREFIX}${JSON.stringify(intent)}`;
	if (root.notes) {
		notes = `${root.notes}\n${notes}`;
	}
	if (!(await conditionalUpdate({ endpoint, bead: root, input: { notes } }, services))) {
		throw new BusyBeeError(
			"run_changed",
			`Workflow ${root.id} changed before settlement publication.`,
		);
	}
	const closedIds: string[] = [];
	let attemptedId = root.id;
	let uncertainOperation = "close_generated_task";
	try {
		for (const { record, scope } of inventory.pending) {
			attemptedId = record.id;
			// eslint-disable-next-line no-await-in-loop -- Closure order follows inspected native containment.
			const current = await readBead(endpoint, record.id, services);
			if (current.updated_at !== record.updated_at) {
				throw new BusyBeeError(
					"task_changed",
					`Task ${record.id} changed after settlement inspection.`,
				);
			}
			// eslint-disable-next-line no-await-in-loop -- Close bottom-up and retain every confirmed native effect.
			await closeObservedTask({ endpoint, task: current, fact: closure(intent, scope) }, services);
			closedIds.push(record.id);
		}
		if (intent.replacementId) {
			uncertainOperation = "link_replacement";
			await linkReplacement(
				{ root, replacementId: intent.replacementId, reason: intent.reason, endpoint },
				services,
			);
		}
		attemptedId = root.id;
		uncertainOperation = "close_run";
		const finalRoot = await readBead(endpoint, root.id, services);
		assertReservation(finalRoot, endpoint.actor);
		if (finalRoot.notes !== notes || finalRoot.status === "closed") {
			throw new BusyBeeError(
				"run_changed",
				`Workflow ${root.id} changed during settlement publication.`,
			);
		}
		await closeObservedTask({ endpoint, task: finalRoot, fact: closure(intent, "run") }, services);
		closedIds.push(root.id);
		uncertainOperation = "clear_intent";
		const current = await readBead(endpoint, root.id, services);
		if (
			current.notes !== notes ||
			!(await conditionalUpdate(
				{ endpoint, bead: current, input: { notes: root.notes } },
				services,
			))
		) {
			throw new BusyBeeError(
				"run_changed",
				`Workflow ${root.id} settlement intent cleanup is uncertain.`,
			);
		}
		return { operation: intent.operation, closedIds };
	} catch (error) {
		let context: Record<string, unknown> = {};
		if (error instanceof BusyBeeError) {
			({ context } = error);
		}
		throw new BusyBeeError(
			"settlement_partial",
			`Settlement of ${root.id} has uncertain effects; inspect retained ownership and intent.`,
			{
				cause: error,
				context: {
					...context,
					runId: root.id,
					confirmedClosedIds: closedIds,
					attemptedId,
					uncertainOperation,
					replacementId: intent.replacementId,
				},
			},
		);
	}
}

function closure(
	intent: WorkflowSettlementIntent,
	scope: WorkflowClosure["scope"],
): WorkflowClosure {
	let outcome: WorkflowClosure["outcome"] = "cancelled";
	if (scope === "run" && intent.operation === "fail") {
		outcome = "failed";
	}
	return {
		kind: "busybee-lifecycle",
		formatVersion: 1,
		runId: intent.runId,
		scope,
		outcome,
		reason: intent.reason,
	};
}

async function acknowledge(
	input: {
		root: BeadRecord;
		state: NativeWorkflowState;
		reason: string;
		endpoint: MutationEndpoint;
	},
	services: Services,
): Promise<void> {
	const { root, state, reason, endpoint } = input;
	assertUnsuccessful(root, state);
	if (state.kind !== "terminal" || state.fact.outcome !== "failed") {
		throw new BusyBeeError(
			"workflow_not_failed",
			`Only a failed workflow can be acknowledged: ${root.id}.`,
		);
	}
	if (!workflowAcknowledgment(root)) {
		const acknowledgment = JSON.stringify({
			closedAt: root.closed_at,
			closeReason: root.close_reason,
			reason,
		});
		services.beforeWrite();
		await services.beads.comments.add(
			{ actor: endpoint.actor, cwd: endpoint.repo, db: endpoint.db },
			root.id,
			`${WORKFLOW_ACKNOWLEDGMENT_PREFIX}${acknowledgment}`,
		);
	}
}

async function validateReplacement(
	input: { root: BeadRecord; replacementId: string; endpoint: MutationEndpoint },
	services: Services,
): Promise<void> {
	const { root, replacementId, endpoint } = input;
	if (root.id === replacementId) {
		throw new BusyBeeError("invalid_replacement", "A workflow cannot replace itself.");
	}
	const replacement = await checkpointRecords(endpoint, replacementId, services);
	if (readCheckpoint(replacement.checkpoint).id !== replacementId) {
		throw new BusyBeeError(
			"invalid_replacement",
			`Checkpoint identity disagrees with ${replacementId}.`,
		);
	}
	if (nativeParent(root) !== nativeParent(replacement.run)) {
		throw new BusyBeeError(
			"invalid_replacement",
			`Replacement ${replacementId} must retain ${root.id}'s native parent.`,
		);
	}
	assertNoIntent(replacement.run);
	readLifecycle(replacement.run, { runId: replacementId, scope: "run" });
}

function nativeParent(record: BeadRecord): string {
	const parents = record.dependencies.filter((edge) => edge.dependency_type === "parent-child");
	if (parents.length !== ONE) {
		throw new BusyBeeError("invalid_replacement", `Workflow ${record.id} needs one native parent.`);
	}
	return parents[FIRST]!.id;
}

// eslint-disable-next-line max-statements -- Keep edge and explanatory-comment publication evidence together.
async function linkReplacement(
	input: { root: BeadRecord; replacementId: string; reason: string; endpoint: MutationEndpoint },
	services: Services,
): Promise<void> {
	await validateReplacement(input, services);
	const { endpoint, root, replacementId } = input;
	if (
		root.dependents.some(
			(edge) => edge.id === replacementId && edge.dependency_type === "supersedes",
		)
	) {
		return;
	}
	let edgePublished = false;
	let uncertainOperation = "replacement_edge";
	try {
		services.beforeWrite();
		await services.beads.dep.add(
			{ actor: endpoint.actor, cwd: endpoint.repo, db: endpoint.db },
			replacementId,
			root.id,
			"supersedes",
		);
		edgePublished = true;
		uncertainOperation = "replacement_comment";
		services.beforeWrite();
		await services.beads.comments.add(
			{ actor: endpoint.actor, cwd: endpoint.repo, db: endpoint.db },
			root.id,
			`Workflow superseded by ${replacementId}: ${input.reason}`,
		);
	} catch (error) {
		throw new BusyBeeError(
			"replacement_partial",
			`Replacement publication for ${root.id} is uncertain.`,
			{
				cause: error,
				context: { runId: root.id, replacementId, edgePublished, uncertainOperation },
			},
		);
	}
}

function assertReservation(record: BeadRecord, actor: string): void {
	if (
		record.labels.includes("system") ||
		(record.status !== "closed" &&
			(record.labels.includes("hitl") ||
				(record.assignee && record.assignee !== actor) ||
				(record.assignee && record.assignee === record.owner)))
	) {
		throw new BusyBeeError(
			"reserved_work",
			`Task ${record.id} is reserved; settlement preserves its identity.`,
			{
				context: { bead: record.id, assignee: record.assignee },
			},
		);
	}
}

function assertNoIntent(record: BeadRecord): void {
	if (parseWorkflowSettlement(record.notes)) {
		throw new BusyBeeError(
			"settlement_pending",
			`Workflow ${record.id} retains an unfinished settlement; inspect effects before explicit recovery.`,
		);
	}
}

function assertUnsuccessful(root: BeadRecord, state: NativeWorkflowState): void {
	if (state.kind !== "terminal" || state.fact.outcome === "succeeded") {
		throw new BusyBeeError(
			"workflow_not_unsuccessful",
			`Workflow ${root.id} has no recognized unsuccessful closure.`,
		);
	}
}

function readLifecycle(record: BeadRecord, expected: Pick<WorkflowClosure, "runId" | "scope">) {
	try {
		return nativeWorkflowState(record, expected);
	} catch (error) {
		throw new BusyBeeError("invalid_lifecycle", `Native lifecycle on ${record.id} is malformed.`, {
			cause: error,
		});
	}
}
