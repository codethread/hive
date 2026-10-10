/* eslint-disable unicorn/no-null -- Public JSON explicitly distinguishes absent closure and observation facts. */
import type { AckOptions, InspectionOptions, ListOptions, StopOptions } from "./bee-cli.ts";
import {
	BEE_ACKNOWLEDGMENT_PREFIX,
	COLONY_OBSERVATION_PREFIX,
	CommandError,
	SPAWN_REQUEST_LABELS,
	acknowledgmentSchema,
	beadSchema,
	beads,
	latestColonyObservation,
	latestStdoutActivity,
	projectedRequestLabels,
	readSpawnRequest,
	requestAcknowledgment,
	requestDisposition,
	requestLabelsCurrent,
	requestNeedsAttention,
	requestOutcome,
	requestResolution,
	resolveRepository,
	showBead,
} from "@hive/shared";
import type {
	Bead,
	Recipe,
	RepositoryEndpoint,
	RequestAcknowledgment,
	RequestResolution,
	SpawnDisposition,
	StdoutActivity,
} from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Automatic publication belongs to the requesting machine.
import { hostname } from "node:os";
import { z } from "zod";

const INSPECTION_ACTOR = "bee";
const NONEMPTY = 1;

/** Native facts committed, but their query labels still need publication. */
export class RequestPublicationError extends Error {
	/** Stable CLI reason for an incomplete projection write. */
	readonly code = "request_labels_pending";
	/** Request whose query labels could not be published. */
	readonly requestId: string;
	/** Already-created replacements, which must not be submitted again. */
	readonly replacementIds: string[];
	constructor(context: { requestId: string; replacementIds: string[] }, cause: unknown) {
		const { requestId, replacementIds } = context;
		super(
			`Request ${requestId} label publication failed; native facts are retained. Replacement IDs: ${replacementIds.join(", ") || "none"}. Inspect bee status ${requestId}; repeat the initiating operation to repair publication (bee ack for acknowledgment, wake for runtime settlement). ${String(cause)}`,
			{ cause },
		);
		this.name = "RequestPublicationError";
		this.requestId = requestId;
		this.replacementIds = replacementIds;
	}
}
export interface TaskView {
	/** Native related task identifier. */
	id: string;
	/** Native task status, independent of request state. */
	status: string;
	/** Recorded task assignee, without inferring live execution. */
	assignee: string | null;
	/** Native ready-list membership, or satisfied closure. */
	readiness: "ready" | "blocked" | "closed";
}
export interface RecordedObservation {
	/** Native comment text, without a new observation payload schema. */
	text: string;
	/** Timestamp of this recorded evidence; not a freshness guarantee. */
	createdAt: string;
	/** Native comment attribution. */
	author: string;
}
export interface RequestView {
	/** Native spawn request identifier. */
	id: string;
	/** Friendly execution identity captured by the request. */
	identity: string;
	/** Captured requesting hostname, or null for unbound historical records. */
	host: string | null;
	/** Captured recipe, independent of current daemon policy. */
	recipe: Recipe;
	/** Native request status, never inferred from observation text. */
	status: string;
	/** Native request closure time when recorded. */
	closedAt: string | null;
	/** Native request closure reason when recorded. */
	closeReason: string | null;
	/** Finite outcome and resolution derived from native closure and provenance. */
	disposition: SpawnDisposition;
	/** Whether native query labels match those facts; pending publication is recoverable. */
	labelPublication: "current" | "pending";
	/** Resolution remains separate from the original closure outcome. */
	resolution: RequestResolution;
	/** Native acceptance evidence, retained even when a replacement takes precedence. */
	acknowledgment: RequestAcknowledgment | null;
	/** Whether a terminal unsuccessful request still requires intervention. */
	needsAttention: boolean;
	/** Requests this request replaces, distinct from its task links. */
	supersedes: string[];
	/** Current related task facts from the selected tracker. */
	tasks: TaskView[];
	/** Latest recorded Colony comment, which may be stale. */
	lastObservation: RecordedObservation | null;
	/** Latest attempt's stdout evidence; null means no attempt observation has been published. */
	stdoutActivity: StdoutActivity | null;
}
export interface RequestResult {
	/** Whether the caller inspected or closed this request. */
	kind: "request_status" | "request_stopped";
	/** Explicit canonical repository and tracker authority. */
	repository: RepositoryEndpoint;
	/** Native request facts and last recorded evidence. */
	request: RequestView;
}
export interface RequestListResult {
	/** Stable JSON result discriminator. */
	kind: "request_list";
	/** Explicit canonical repository and tracker authority. */
	repository: RepositoryEndpoint;
	/** Active requests and unresolved failures, or all historical requests when requested. */
	requests: RequestView[];
}

export interface AcknowledgmentResult {
	/** Acceptance or an already-resolved failure, with current query labels. */
	kind: "request_acknowledged";
	/** Explicit canonical repository and tracker authority. */
	repository: RepositoryEndpoint;
	/** Resolution facts without the captured recipe or unrelated task details. */
	request: Pick<
		RequestView,
		"id" | "disposition" | "resolution" | "acknowledgment" | "labelPublication" | "needsAttention"
	>;
}

/** Inspection needs only the selected tracker, never .hive/bees.toml or a daemon. */
export async function inspectRequest(
	id: string,
	options: InspectionOptions,
): Promise<RequestResult> {
	const repository = await resolveRepository(options.repo, options.beadsDb);
	const [request, ready] = await Promise.all([
		showBead(repository, INSPECTION_ACTOR, id),
		readyTasks(repository),
	]);
	return {
		kind: "request_status",
		repository,
		request: await requestView(repository, request, ready),
	};
}
// eslint-disable-next-line max-statements -- Keep candidate discovery, authoritative filtering and selected detail reads ordered together.
export async function listRequests(options: ListOptions): Promise<RequestListResult> {
	const repository = await resolveRepository(options.repo, options.beadsDb);
	const labels: string[] = [...SPAWN_REQUEST_LABELS];
	if (!options.all) {
		labels.push("bee-resolution:unresolved");
	}
	const listing = z
		.object({ issues: z.array(beadSchema) })
		.parse(
			await beads(repository, INSPECTION_ACTOR, [
				"list",
				"--status",
				"all",
				...labels.flatMap((label) => ["--label", label]),
				"--limit",
				"0",
			]),
		);
	const candidates = await Promise.all(
		listing.issues.map(({ id }) => showBead(repository, INSPECTION_ACTOR, id)),
	);
	// Acknowledgment or supersession can resolve a candidate before its labels are published.
	const requests = candidates.filter(
		(request) => options.all || request.status !== "closed" || requestNeedsAttention(request),
	);
	if (requests.length < NONEMPTY) {
		return { kind: "request_list", repository, requests: [] };
	}
	const ready = await readyTasks(repository);
	return {
		kind: "request_list",
		repository,
		requests: await Promise.all(requests.map((request) => requestView(repository, request, ready))),
	};
}
/** Closing a request records intent; an awake Colony performs owned execution cleanup. */
// eslint-disable-next-line max-statements -- Preserve committed closure and its publication context through offline repair.
export async function stopRequest(id: string, options: StopOptions): Promise<RequestResult> {
	const repository = await resolveRepository(options.repo, options.beadsDb);
	const actor = z.string().min(NONEMPTY).parse(options.actor);
	let request = await showBead(repository, actor, id);
	readSpawnRequest(request);
	if (request.status !== "closed") {
		await beads(repository, actor, ["close", id, "--reason", "Stopped by Bee"]);
	}
	try {
		request = await publishRequestLabels(repository, actor, id);
	} catch (error) {
		if (error instanceof RequestPublicationError) {
			throw error;
		}
		throw publicationFailure(request, error);
	}
	return {
		kind: "request_stopped",
		repository,
		request: await requestView(repository, request, await readyTasks(repository)),
	};
}

/** Accept failure offline; native attribution survives partial publication and repeated calls. */
// eslint-disable-next-line max-statements -- Keep native acceptance, publication and partial-write context in one ordered operation.
export async function acknowledgeRequest(
	id: string,
	options: AckOptions,
): Promise<AcknowledgmentResult> {
	const actor = z.string().trim().min(NONEMPTY).parse(options.actor);
	const reason = z.string().trim().min(NONEMPTY).parse(options.reason);
	const repository = await resolveRepository(options.repo, options.beadsDb);
	let request = await showBead(repository, actor, id);
	readSpawnRequest(request);
	if (requestOutcome(request) !== "failed") {
		throw new Error(`Request ${id} is not a closed failed request`);
	}
	if (requestResolution(request).kind === "unresolved") {
		const record = acknowledgmentSchema.parse({ closedAt: request.closed_at, reason });
		await beads(repository, actor, [
			"comments",
			"add",
			id,
			"--message",
			`${BEE_ACKNOWLEDGMENT_PREFIX} ${JSON.stringify(record)}`,
		]);
	}
	try {
		request = await publishRequestLabels(repository, actor, id);
	} catch (error) {
		if (error instanceof RequestPublicationError) {
			throw error;
		}
		throw publicationFailure(request, error);
	}
	return {
		kind: "request_acknowledged",
		repository,
		request: {
			acknowledgment: requestAcknowledgment(request) ?? null,
			disposition: requestDisposition(request),
			id: request.id,
			labelPublication: "current",
			needsAttention: requestNeedsAttention(request),
			resolution: requestResolution(request),
		},
	};
}

/** Publish predecessors before the replacement, so an interrupted creation remains recoverable. */
// eslint-disable-next-line max-params -- Automatic publishers supply host authority; explicit Bee actions omit it.
export async function publishRequestLabels(
	repository: RepositoryEndpoint,
	actor: string,
	id: string,
	host?: string,
): Promise<Bead> {
	const spawn = await showBead(repository, actor, id);
	assertPublicationHost(spawn, host);
	for (const predecessor of spawn.dependencies.filter(
		({ dependency_type }) => dependency_type === "supersedes",
	)) {
		// eslint-disable-next-line no-await-in-loop -- Finish each predecessor's projection before admitting its replacement.
		const old = await showBead(repository, actor, predecessor.id);
		if (host === undefined || readSpawnRequest(old).host === host) {
			// eslint-disable-next-line no-await-in-loop -- Native provenance already exists; repair only predecessors belonging to this publisher.
			await publishLabels(repository, { actor, host }, old);
		}
	}
	return publishLabels(repository, { actor, host }, spawn);
}

/** Recover offline closure before registration, including a stopped replacement's provenance. */
export async function reconcileClosedRequestLabels(repository: RepositoryEndpoint): Promise<void> {
	const { issues } = z
		.object({ issues: z.array(beadSchema) })
		.parse(
			await beads(repository, "colony", [
				"list",
				"--status",
				"closed",
				...SPAWN_REQUEST_LABELS.flatMap((label) => ["--label", label]),
				"--label",
				"bee-outcome:pending",
				"--limit",
				"0",
			]),
		);
	for (const issue of issues.filter(
		(candidate) => readSpawnRequest(candidate).host === hostname(),
	)) {
		// eslint-disable-next-line no-await-in-loop -- Bounded native publications complete before the next closed request is repaired.
		await publishRequestLabels(repository, "colony", issue.id, hostname());
	}
}

// --- Private functions ---
// eslint-disable-next-line max-statements -- Keep the bounded conflict recovery and its latest failure context together.
async function publishLabels(
	repository: RepositoryEndpoint,
	{ actor, host }: { actor: string; host: string | undefined },
	bead: Bead,
): Promise<Bead> {
	if (requestLabelsCurrent(bead)) {
		return bead;
	}
	let current = bead;
	let canRepublish = true;
	try {
		/* eslint-disable no-await-in-loop -- One rebased write is allowed; a second conflict only gets a convergence read. */
		while (!requestLabelsCurrent(current)) {
			try {
				await beads(repository, actor, [
					"update",
					current.id,
					"--if-unchanged",
					current.updated_at,
					"--set-labels",
					projectedRequestLabels(current).join(","),
				]);
				break;
			} catch (error) {
				if (
					!(error instanceof CommandError) ||
					error.nativeError?.code !== "UPDATE_PRECONDITION_FAILED"
				) {
					throw error;
				}
				current = await showBead(repository, actor, current.id);
				assertPublicationHost(current, host);
				if (requestLabelsCurrent(current)) {
					return current;
				}
				if (!canRepublish) {
					throw error;
				}
				canRepublish = false;
			}
		}
		/* eslint-enable no-await-in-loop */
		current = await showBead(repository, actor, current.id);
		assertPublicationHost(current, host);
		if (!requestLabelsCurrent(current)) {
			throw new Error("Native facts changed during publication");
		}
		return current;
	} catch (error) {
		throw publicationFailure(current, error);
	}
}

function publicationFailure(bead: Bead, cause: unknown): RequestPublicationError {
	const replacementIds = bead.dependents
		.filter(({ dependency_type }) => dependency_type === "supersedes")
		.map(({ id }) => id);
	return new RequestPublicationError({ replacementIds, requestId: bead.id }, cause);
}

function assertPublicationHost(bead: Bead, host: string | undefined): void {
	const request = readSpawnRequest(bead);
	if (host !== undefined && request.host !== host) {
		throw new Error(`Request ${request.id} is not bound to publishing host ${host}`);
	}
}

async function readyTasks(repository: RepositoryEndpoint): Promise<Set<string>> {
	const ready = z
		.array(beadSchema.pick({ id: true }))
		.parse(await beads(repository, INSPECTION_ACTOR, ["ready", "--brief", "--limit", "0"]));
	return new Set(ready.map(({ id }) => id));
}
async function requestView(
	repository: RepositoryEndpoint,
	bead: Bead,
	ready: Set<string>,
): Promise<RequestView> {
	const request = readSpawnRequest(bead);
	const tasks = await Promise.all(
		request.taskIds.map(async (id): Promise<TaskView> => {
			const task = await showBead(repository, INSPECTION_ACTOR, id);
			let readiness: TaskView["readiness"] = "blocked";
			if (task.status === "closed") {
				readiness = "closed";
			} else if (ready.has(task.id)) {
				readiness = "ready";
			}
			return { assignee: task.assignee ?? null, id: task.id, readiness, status: task.status };
		}),
	);
	const observation = latestColonyObservation(bead);
	let lastObservation: RecordedObservation | null = null;
	if (observation) {
		lastObservation = {
			author: observation.author,
			createdAt: observation.created_at,
			text: observation.text.slice(COLONY_OBSERVATION_PREFIX.length).trim(),
		};
	}
	let labelPublication: RequestView["labelPublication"] = "pending";
	if (requestLabelsCurrent(bead)) {
		labelPublication = "current";
	}
	return {
		acknowledgment: requestAcknowledgment(bead) ?? null,
		closeReason: bead.close_reason ?? null,
		closedAt: bead.closed_at ?? null,
		disposition: requestDisposition(bead),
		id: request.id,
		identity: request.identity,
		host: request.host,
		labelPublication,
		lastObservation,
		needsAttention: requestNeedsAttention(bead),
		recipe: request.recipe,
		resolution: requestResolution(bead),
		status: bead.status,
		stdoutActivity: latestStdoutActivity(bead) ?? null,
		supersedes: bead.dependencies
			.filter(({ dependency_type }) => dependency_type === "supersedes")
			.map(({ id }) => id),
		tasks,
	};
}
