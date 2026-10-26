/* eslint-disable unicorn/no-null -- Clearance names unknown request/attempt identities explicitly. */
import type { AttemptInventory, Store } from "./store.ts";
import {
	COLONY_MANUAL_EXECUTION_PREFIX,
	SPAWN_REQUEST_LABELS,
	readSpawnRequest,
	readSpawnRequestSummary,
} from "@hive/shared";
import type { ExecutionClearance, ExecutionClearanceSelection } from "@hive/shared";
import type { BeadRecord } from "@hive/beads";
import type { LaunchReceipt } from "./launch.ts";
import type { TrackerContext } from "./tracker.ts";
import type { WithAdmission } from "./admission.ts";
import { assertRequestAuthority } from "./request.ts";
import { readWorkflowPublication } from "./workflow-anchor.ts";
import { trackerScope } from "./tracker.ts";

const EMPTY = 0;
const ONE = 1;
const FIRST = 0;
export interface ExecutionClearanceRuntime extends TrackerContext {
	/** Existing daemon history, never a workflow lifecycle mirror. */
	store: Pick<Store, "requests" | "request" | "retainedInventory">;
	/** The exact endpoint is registered in this running daemon. */
	registered: boolean;
	/** Same critical section used for claim/reservation/supervisor handoff. */
	withAdmission: WithAdmission;
	/** Fresh ownership/fingerprint check, including pending supervisors. */
	observe: (receipt: LaunchReceipt) => Promise<{ kind: "live" | "stopped" }>;
	/** This executing host, supplied at the native composition boundary. */
	host: string;
	/** Completion time for the bounded observation. */
	now: () => string;
}
type Blocker = Extract<ExecutionClearance["result"], { kind: "refused" }>["blockers"][number];
type ClearedRequest = Extract<ExecutionClearance["result"], { kind: "clear" }>["requests"][number];

/** Observe complete native and retained scope while admissions cannot pass unseen. */
export function executionClearance(
	scope: ExecutionClearanceSelection,
	runtime: ExecutionClearanceRuntime,
): Promise<ExecutionClearance> {
	return runtime.withAdmission(async () => {
		const result = await inspectClearance(scope, runtime);
		return {
			kind: "execution-clearance",
			repository: runtime.repository,
			host: runtime.host,
			observedAt: runtime.now(),
			scope,
			result,
		};
	});
}

// --- Private functions ---

/* eslint-disable-next-line max-statements --
 * Join complete native scope, retained authority and fresh process observations in one read.
 */
async function inspectClearance(
	scope: ExecutionClearanceSelection,
	runtime: ExecutionClearanceRuntime,
): Promise<ExecutionClearance["result"]> {
	if (!runtime.registered) {
		return refused("unregistered_endpoint");
	}
	const { repository, beads, store } = runtime;
	const selected = trackerScope(repository, "sys-colony");
	const ids = new Set(scope.anchorIds);
	if (!ids.has(scope.runId) || ids.size !== scope.anchorIds.length) {
		return refused("invalid_scope");
	}
	const root = await beads.show(selected, scope.runId);
	const publication = await readWorkflowPublication(runtime, root, "sys-colony");
	if (!publication.locked || publication.control.settlement?.state !== "pending") {
		return refused("admission_not_fenced");
	}
	const inventory = new Set([
		scope.runId,
		...publication.control.created.map((entry) => entry.bead),
	]);
	if (inventory.size !== ids.size || scope.anchorIds.some((id) => !inventory.has(id))) {
		return refused("invalid_system_inventory");
	}
	const anchors = await beads.showMany(selected, scope.anchorIds);
	const byId = new Map(anchors.map((record) => [record.id, record]));
	for (const anchor of anchors) {
		let current = anchor;
		const parents = new Set<string>();
		while (current.id !== scope.runId) {
			if (parents.has(current.id)) {
				return refused("invalid_scope_ancestry");
			}
			parents.add(current.id);
			const parentIds = current.dependencies.filter(
				(edge) => edge.dependency_type === "parent-child",
			);
			let parent: BeadRecord | undefined = undefined;
			if (parentIds.length === ONE) {
				parent = byId.get(parentIds[FIRST]!.id);
			}
			if (!parent) {
				return refused("invalid_scope_ancestry");
			}
			current = parent;
		}
	}
	const native = await nativeRequests(scope, anchors, runtime);
	const retained = store.retainedInventory(repository.root);
	const relevantRecords = store
		.requests(repository.root)
		.filter((record) => record.assignment.runId === scope.runId);
	const relevantAttempts = retained.filter(
		({ receipt }) => receipt.assignment.runId === scope.runId,
	);
	const blockers: Blocker[] = [];
	for (const record of relevantRecords) {
		if (!native.has(record.id)) {
			blockers.push({ reason: "unlinked_request_history", requestId: record.id, attemptId: null });
		}
	}
	for (const attempt of relevantAttempts) {
		if (!native.has(attempt.spawnId)) {
			blockers.push({
				reason: "unlinked_attempt_history",
				requestId: attempt.spawnId,
				attemptId: attempt.id,
			});
		}
	}
	const cleared: ClearedRequest[] = [];
	for (const record of native.values()) {
		/* eslint-disable-next-line no-await-in-loop --
		 * Every retained attempt is freshly verified in the admission critical section.
		 */
		const result = await inspectRequest(record, relevantAttempts, runtime);
		if ("reason" in result) {
			blockers.push(result);
		} else {
			cleared.push(result);
		}
	}
	const fresh = await beads.showMany(selected, [
		...scope.anchorIds,
		...native.keys(),
		publication.checkpoint.id,
	]);
	const versions = new Map(
		[...anchors, ...native.values(), publication.checkpoint].map((record) => [
			record.id,
			record.updated_at,
		]),
	);
	for (const record of fresh) {
		if (record.updated_at !== versions.get(record.id)) {
			let requestId: string | null = null;
			if (native.has(record.id)) {
				requestId = record.id;
			}
			blockers.push({
				reason: "native_scope_changed",
				requestId,
				attemptId: null,
			});
		}
	}
	if (blockers.length > EMPTY) {
		return { kind: "refused", blockers };
	}
	let proof: Extract<ExecutionClearance["result"], { kind: "clear" }>["proof"] = "requests-cleared";
	if (cleared.length === EMPTY) {
		proof = "no-managed-requests";
	}
	return {
		kind: "clear",
		proof,
		requests: cleared,
	};
}

/* eslint-disable-next-line max-statements --
 * Discover native associations and replacement lineages before consulting private execution history.
 */
async function nativeRequests(
	scope: ExecutionClearanceSelection,
	anchors: BeadRecord[],
	{ beads, repository }: TrackerContext,
): Promise<Map<string, BeadRecord>> {
	const selected = trackerScope(repository, "sys-colony");
	const ids = new Set(
		anchors.flatMap((record) =>
			record.dependents.filter((edge) => edge.dependency_type === "related").map((edge) => edge.id),
		),
	);
	const candidates = await beads.listProjected(
		selected,
		{
			all: true,
			labels: SPAWN_REQUEST_LABELS,
			descriptionContains: JSON.stringify(scope.runId),
			limit: 0,
		},
		["id", "description", "labels", "assignee"],
	);
	for (const candidate of candidates.issues) {
		if (readSpawnRequestSummary(candidate).assignment.runId === scope.runId) {
			ids.add(candidate.id);
		}
	}
	const result = new Map<string, BeadRecord>();
	for (const id of ids) {
		// eslint-disable-next-line no-await-in-loop -- Relationships and replacement lineages are inspected exhaustively.
		const record = await beads.show(selected, id);
		if (record.labels.includes("system") && record.labels.includes("bee")) {
			const request = readSpawnRequest(record);
			if (
				request.assignment.runId !== scope.runId ||
				request.taskIds.some((anchor) => !scope.anchorIds.includes(anchor))
			) {
				throw new Error(`Request ${id} disagrees with the selected run inventory`);
			}
			let anchor = request.assignment.runId;
			if (request.assignment.kind === "stage") {
				anchor = request.assignment.stageId;
			}
			if (
				!record.dependencies.some(
					(edge) => edge.id === anchor && edge.dependency_type === "related",
				)
			) {
				throw new Error(`Request ${id} has no native anchor association`);
			}
			result.set(id, record);
			for (const edge of [...record.dependencies, ...record.dependents].filter(
				(relation) => relation.dependency_type === "supersedes",
			)) {
				ids.add(edge.id);
			}
		}
	}
	return result;
}

// eslint-disable-next-line max-statements -- Missing, foreign or live evidence never becomes proof of quiescence.
async function inspectRequest(
	record: BeadRecord,
	attempts: AttemptInventory[],
	runtime: ExecutionClearanceRuntime,
): Promise<ClearedRequest | Blocker> {
	const request = readSpawnRequest(record);
	const refuse = (reason: string, attemptId: string | null = null): Blocker => ({
		reason,
		requestId: record.id,
		attemptId,
	});
	if (request.host !== runtime.host) {
		return refuse("foreign_or_unbound_host");
	}
	if (record.comments.some(({ text }) => text.startsWith(COLONY_MANUAL_EXECUTION_PREFIX))) {
		return refuse("unsupported_manual_execution");
	}
	const retained = runtime.store.request(runtime.repository.root, record.id);
	if (!retained) {
		return refuse("missing_request_history");
	}
	try {
		assertRequestAuthority(retained, request);
	} catch {
		return refuse("request_authority_mismatch");
	}
	if (retained.context.pendingClaim !== null || retained.state === "claiming") {
		return refuse("pending_claim");
	}
	const relevant = attempts.filter(({ spawnId }) => spawnId === record.id);
	if (
		relevant.length !== retained.context.attempts ||
		(retained.context.attemptId !== null &&
			!relevant.some(({ id }) => id === retained.context.attemptId))
	) {
		return refuse("incomplete_attempt_inventory");
	}
	for (const attempt of relevant) {
		try {
			assertRequestAuthority(retained, attempt.receipt);
			if (
				attempt.receipt.id !== attempt.id ||
				attempt.receipt.host !== runtime.host ||
				attempt.receipt.beadsDb !== runtime.repository.beadsDb
			) {
				return refuse("attempt_authority_mismatch", attempt.id);
			}
			// eslint-disable-next-line no-await-in-loop -- Cached attempt state and native closure do not prove process exit.
			const observation = await runtime.observe(attempt.receipt);
			if (observation.kind !== "stopped") {
				return refuse("live_execution", attempt.id);
			}
		} catch {
			return refuse("unverified_execution", attempt.id);
		}
	}
	if (relevant.length === EMPTY && retained.context.attemptId !== null) {
		return refuse("pending_launch");
	}
	let proof: ClearedRequest["proof"] = "stopped";
	if (relevant.length === EMPTY) {
		proof = "never-launched";
	}
	return {
		id: record.id,
		proof,
		attemptIds: relevant.map(({ id }) => id),
	};
}

function refused(reason: string): ExecutionClearance["result"] {
	return { kind: "refused", blockers: [{ reason, requestId: null, attemptId: null }] };
}
