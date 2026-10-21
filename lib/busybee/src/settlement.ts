import {
	BusyBeeError,
	closeObservedTask,
	conditionalUpdate,
	createServices,
	readBead,
} from "./native.ts";
import type { MutationEndpoint, Options, Services } from "./native.ts";
import {
	SPAWN_REQUEST_LABELS,
	WORKFLOW_SETTLEMENT_PREFIX,
	nativeWorkflowState,
	parseWorkflowClosure,
	parseWorkflowSettlement,
	readSpawnRequest,
	readSpawnRequestSummary,
	workflowOutcomeLabelsCurrent,
} from "@hive/shared";
import type { WorkflowClosure, WorkflowSettlementIntent } from "@hive/shared";
import type { BeadRecord } from "@hive/beads";
import type { Run } from "./checkpoint.ts";
import { withRunPublication } from "./runtime.ts";
import { z } from "zod";

const ONE = 1;
const FIRST = 0;
const text = z.string().trim().min(ONE);
export const settlementRequestSchema = z.strictObject({
	id: text,
	operation: z.enum(["cancel", "fail"]),
	reason: text,
});
export type SettlementRequest = z.infer<typeof settlementRequestSchema>;
export const settlementResultSchema = z.object({
	runId: text,
	operation: z.enum(["cancel", "fail"]),
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

/** Retire pending generated scope; authored completion alone publishes success. */
export function settle(
	request: SettlementRequest,
	options: Options = {},
	services: Services = createServices(),
) {
	return withRunPublication(
		{ id: request.id, options, services },
		// eslint-disable-next-line max-statements -- Keep disposition preflight and publication under one owner.
		async (publication, writes) => {
			const { endpoint, run, owner } = publication;
			const root = await readBead(endpoint, request.id, writes);
			assertNoIntent(root);
			assertReservation(root, endpoint.actor);
			const state = readLifecycle(root, { runId: run.id, scope: "run" });
			if (state.kind !== "pending") {
				throw new BusyBeeError("workflow_not_pending", `Workflow ${root.id} is already closed.`, {
					context: { runId: root.id },
				});
			}
			const inventory = await inspectInventory({ run, root, endpoint }, writes);
			await assertExecutionClearance({ run, inventory, endpoint }, writes);
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
			const intent: WorkflowSettlementIntent = {
				owner,
				runId: run.id,
				operation: request.operation,
				reason: request.reason,
				inventory: inventory.pending.map(({ record, scope }) => ({
					id: record.id,
					updatedAt: record.updated_at,
					scope,
				})),
			};
			return {
				runId: run.id,
				...(await publishSettlement({ root, intent, inventory, endpoint }, writes)),
			};
		},
	);
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
				let expected: "visit" | "group" = "group";
				if (
					active.get(record.id)?.meta.commands ||
					run.history.some(({ bead }) => bead === record.id)
				) {
					expected = "visit";
				}
				const state = readLifecycle(record, { runId: run.id, scope: expected });
				if (!workflowOutcomeLabelsCurrent(record.labels, state)) {
					throw new BusyBeeError(
						"workflow_labels_pending",
						`Generated task ${record.id} has stale outcome labels.`,
					);
				}
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
	const candidates = await services.beads.listProjected(
		{ cwd: endpoint.repo, db: endpoint.db },
		{
			all: true,
			labels: SPAWN_REQUEST_LABELS,
			descriptionContains: JSON.stringify(run.id),
			limit: 0,
		},
		["id", "description", "labels", "assignee"],
	);
	for (const candidate of candidates.issues) {
		if (
			readSpawnRequestSummary(candidate).assignment.runId === run.id &&
			!requests.has(candidate.id)
		) {
			throw new BusyBeeError(
				"unsupported_inventory",
				`Request ${candidate.id} is missing its native generated anchor association.`,
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
	if (run.managedExecution === "unmanaged") {
		if (inventory.requests.length !== FIRST) {
			throw new BusyBeeError(
				"invalid_managed_provenance",
				`Workflow ${run.id} has request evidence contradicting unmanaged provenance.`,
			);
		}
		return;
	}
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
			if (context["nativeClosed"] === true && !closedIds.includes(attemptedId)) {
				closedIds.push(attemptedId);
			}
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
	if (intent.operation === "fail") {
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

function readLifecycle(record: BeadRecord, expected: Pick<WorkflowClosure, "runId" | "scope">) {
	try {
		return nativeWorkflowState(record, expected);
	} catch (error) {
		throw new BusyBeeError("invalid_lifecycle", `Native lifecycle on ${record.id} is malformed.`, {
			cause: error,
		});
	}
}
