/* eslint-disable unicorn/no-null -- Public JSON explicitly distinguishes absent closure and observation facts. */
import type { Bead, Recipe, RepositoryEndpoint, RequestResolution } from "@hive/shared";
import {
	COLONY_OBSERVATION_PREFIX,
	SPAWN_REQUEST_LABELS,
	beadSchema,
	beads,
	latestColonyObservation,
	readSpawnRequest,
	requestNeedsAttention,
	requestResolution,
	resolveRepository,
	showBead,
} from "@hive/shared";
import type { InspectionOptions, ListOptions, StopOptions } from "./bee-cli.ts";
import { z } from "zod";

const INSPECTION_ACTOR = "bee";
const NONEMPTY = 1;
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
	/** Captured recipe, independent of current daemon policy. */
	recipe: Recipe;
	/** Native request status, never inferred from observation text. */
	status: string;
	/** Native request closure time when recorded. */
	closedAt: string | null;
	/** Native request closure reason when recorded. */
	closeReason: string | null;
	/** Resolution remains separate from the original closure outcome. */
	resolution: RequestResolution;
	/** Whether a terminal unsuccessful request still requires intervention. */
	needsAttention: boolean;
	/** Requests this request replaces, distinct from its task links. */
	supersedes: string[];
	/** Current related task facts from the selected tracker. */
	tasks: TaskView[];
	/** Latest recorded Colony comment, which may be stale. */
	lastObservation: RecordedObservation | null;
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

/** Inspection needs only the selected tracker, never bees.toml or a daemon. */
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
export async function listRequests(options: ListOptions): Promise<RequestListResult> {
	const repository = await resolveRepository(options.repo, options.beadsDb);
	const listing = z
		.object({ issues: z.array(beadSchema) })
		.parse(
			await beads(repository, INSPECTION_ACTOR, [
				"list",
				"--status",
				"all",
				...SPAWN_REQUEST_LABELS.flatMap((label) => ["--label", label]),
				"--limit",
				"0",
			]),
		);
	const ready = await readyTasks(repository);
	const requests = await Promise.all(
		listing.issues.map(async ({ id }) =>
			requestView(repository, await showBead(repository, INSPECTION_ACTOR, id), ready),
		),
	);
	return {
		kind: "request_list",
		repository,
		requests: requests.filter(
			(request) => options.all || request.status !== "closed" || request.needsAttention,
		),
	};
}
/** Closing a request records intent; an awake Colony performs owned execution cleanup. */
export async function stopRequest(id: string, options: StopOptions): Promise<RequestResult> {
	const repository = await resolveRepository(options.repo, options.beadsDb);
	const actor = z.string().min(NONEMPTY).parse(options.actor);
	let request = await showBead(repository, actor, id);
	readSpawnRequest(request);
	if (request.status !== "closed") {
		await beads(repository, actor, ["close", id, "--reason", "Stopped by Bee"]);
		request = await showBead(repository, actor, id);
	}
	return {
		kind: "request_stopped",
		repository,
		request: await requestView(repository, request, await readyTasks(repository)),
	};
}

// --- Private functions ---
async function readyTasks(repository: RepositoryEndpoint): Promise<Set<string>> {
	const ready = z
		.array(beadSchema)
		.parse(await beads(repository, INSPECTION_ACTOR, ["ready", "--limit", "0"]));
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
	return {
		closeReason: bead.close_reason ?? null,
		closedAt: bead.closed_at ?? null,
		id: request.id,
		identity: request.identity,
		lastObservation,
		needsAttention: requestNeedsAttention(bead),
		recipe: request.recipe,
		resolution: requestResolution(bead),
		status: bead.status,
		supersedes: bead.dependencies
			.filter(({ dependency_type }) => dependency_type === "supersedes")
			.map(({ id }) => id),
		tasks,
	};
}
