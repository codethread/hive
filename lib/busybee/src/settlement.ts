import { BusyBeeError, createServices, readBead } from "./native.ts";
import type { MutationEndpoint, Options, Services } from "./native.ts";
import type { Ownership, Run } from "./checkpoint.ts";
import {
	SPAWN_REQUEST_LABELS,
	nativeWorkflowState,
	readSpawnRequest,
	readSpawnRequestSummary,
} from "@hive/shared";
import type { WorkflowCompletion, WorkflowSettlementIntent } from "@hive/shared";
import { assertReservation, projectCompletions } from "./completion.ts";
import type { BeadRecord } from "@hive/beads";
import { patchOwned } from "./checkpoint.ts";
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
interface PendingTask {
	/** Inspected native revision, checked again before closure. */
	record: BeadRecord;
	/** Published worker or container scope from the recognized inventory. */
	scope: "visit" | "group";
}
interface Inventory {
	/** Retirement targets in bottom-up order; requested and confirmed successes are excluded. */
	pending: PendingTask[];
	/** Related requests, including predecessors and explicit replacements. */
	requests: BeadRecord[];
	/** Revisions of the entire inspected descendant tree, including preserved manual work. */
	versions: { id: string; updatedAt: string }[];
}

/** Retire eligible generated scope while preserving all saved successful directives. */
export function settle(
	request: SettlementRequest,
	options: Options = {},
	services: Services = createServices(),
) {
	return withRunPublication(
		{ id: request.id, options, services },
		// eslint-disable-next-line max-statements -- Fence before clearance; refresh inventory before retirement.
		async (publication) => {
			const { endpoint, run, locked } = publication;
			const root = await readBead(endpoint, request.id, services);
			assertReservation(root, endpoint, services);
			if (run.completions[run.id]?.outcome === "succeeded") {
				throw new BusyBeeError(
					"workflow_not_pending",
					`Workflow ${run.id} already has successful completion intent; collect or reconcile it instead.`,
				);
			}
			if (
				run.settlement &&
				(run.settlement.operation !== request.operation || run.settlement.reason !== request.reason)
			) {
				throw new BusyBeeError(
					"settlement_conflict",
					`Workflow ${run.id} has a different durable settlement; resume its original operation and reason.`,
					{ context: { runId: run.id } },
				);
			}
			const inventory = await inspectInventory({ run, root, endpoint }, services);
			if (!run.settlement) {
				const intent: WorkflowSettlementIntent = {
					operation: request.operation,
					reason: request.reason,
					state: "pending",
					inventory: [
						...inventory.pending.map(({ record, scope }) => ({ id: record.id, scope })),
						{ id: run.id, scope: "run" },
					],
				};
				Object.assign(
					run,
					await patchOwned(
						{
							endpoint,
							locked,
							patch: (fresh) => {
								fresh.settlement = intent;
							},
						},
						services,
					),
				);
			}
			if (run.settlement!.state === "complete") {
				Object.assign(
					run,
					await patchOwned(
						{
							endpoint,
							locked,
							patch: (fresh) => {
								fresh.settlement!.state = "pending";
							},
						},
						services,
					),
				);
			}
			// A retained intent is a fence, never permission to reuse an earlier process observation.
			await assertExecutionClearance({ run, inventory, endpoint }, services);
			const freshRoot = await readBead(endpoint, run.id, services);
			const refreshed = await inspectInventory({ run, root: freshRoot, endpoint }, services);
			if (
				JSON.stringify(refreshed.versions) !== JSON.stringify(inventory.versions) ||
				JSON.stringify(refreshed.requests.map(({ id, updated_at }) => ({ id, updated_at }))) !==
					JSON.stringify(inventory.requests.map(({ id, updated_at }) => ({ id, updated_at })))
			) {
				throw new BusyBeeError(
					"inventory_changed",
					`Workflow ${run.id} changed during execution clearance.`,
					{ context: { runId: run.id } },
				);
			}
			return publishSettlement({ run, endpoint, locked }, services);
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
	const inventory = run;
	const generated = new Map(inventory.created.map((entry) => [entry.bead, entry]));
	if (generated.size !== inventory.created.length || generated.has(run.id)) {
		throw new BusyBeeError(
			"unsupported_inventory",
			`Workflow ${run.id} has duplicate generated identities.`,
		);
	}
	if (run.settlement) {
		const items = run.settlement.inventory;
		const ids = new Set(items.map(({ id }) => id));
		if (
			ids.size !== items.length ||
			items.at(-ONE)?.id !== run.id ||
			items.at(-ONE)?.scope !== "run" ||
			items.some((item) => item.id !== run.id && generated.get(item.id)?.scope !== item.scope)
		) {
			throw new BusyBeeError(
				"unsupported_inventory",
				`Workflow ${run.id} has invalid saved settlement membership.`,
			);
		}
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
			nativeWorkflowState(record, { runId: run.id, scope: entry.scope }, run);
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
		if (entry && run.completions[record.id]?.outcome !== "succeeded") {
			assertReservation(record, endpoint, services);
			pending.push({ record, scope: entry.scope });
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
		requests: [...requests.values()].toSorted(compareIdentity),
		versions: versions.toSorted(compareIdentity),
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

// eslint-disable-next-line max-statements -- Save retirement intent before gated projection and confirmation.
async function publishSettlement(
	input: { run: Run; endpoint: MutationEndpoint; locked: Ownership },
	services: Services,
) {
	const { run, endpoint, locked } = input;
	const intent = run.settlement!;
	const pendingIds = new Set(intent.inventory.map(({ id }) => id));
	const unknown = run.created.find(
		(entry) => run.completions[entry.bead]?.outcome !== "succeeded" && !pendingIds.has(entry.bead),
	);
	if (unknown) {
		throw new BusyBeeError(
			"inventory_changed",
			`Generated task ${unknown.bead} is outside the saved settlement inventory.`,
		);
	}
	Object.assign(
		run,
		await patchOwned(
			{
				endpoint,
				locked,
				patch: (fresh) => {
					for (const { id, scope } of intent.inventory) {
						const existing = fresh.completions[id];
						if (existing?.outcome === "succeeded") {
							throw new BusyBeeError(
								"settlement_conflict",
								`Settlement must not replace successful completion ${id}.`,
							);
						}
						fresh.completions[id] ??= settlementCompletion(intent, scope);
					}
				},
			},
			services,
		),
	);
	try {
		await projectCompletions({ run, endpoint, locked, settlementCleared: true }, services);
		Object.assign(
			run,
			await patchOwned(
				{
					endpoint,
					locked,
					patch: (fresh) => {
						fresh.settlement!.state = "complete";
					},
				},
				services,
			),
		);
		return {
			runId: run.id,
			operation: intent.operation,
			closedIds: intent.inventory.map(({ id }) => id),
		};
	} catch (error) {
		throw new BusyBeeError(
			"settlement_partial",
			`Settlement of ${run.id} remains fenced. Resolve native gates, then resume the same ` +
				`operation and reason for fresh execution clearance.`,
			{
				cause: error,
				context: {
					runId: run.id,
					checkpoint: locked.checkpoint,
					confirmedClosedIds: intent.inventory
						.filter(({ id }) => run.completions[id]?.state === "confirmed")
						.map(({ id }) => id),
					nextAction: `busybee settle ${run.id} ${intent.operation} --reason ${JSON.stringify(intent.reason)}`,
				},
			},
		);
	}
}

function compareIdentity(left: { id: string }, right: { id: string }): number {
	if (left.id === right.id) {
		return FIRST;
	}
	if (left.id < right.id) {
		return -ONE;
	}
	return ONE;
}

function settlementCompletion(
	intent: WorkflowSettlementIntent,
	scope: WorkflowCompletion["scope"],
): WorkflowCompletion {
	let outcome: "failed" | "cancelled" = "cancelled";
	if (intent.operation === "fail") {
		outcome = "failed";
	}
	return {
		state: "requested",
		scope,
		outcome,
		reason: `Workflow ${scope} ${outcome}: ${intent.reason}`,
	};
}
