/* eslint-disable unicorn/no-null -- Format-2 wire control and absent dispatch requests use explicit null. */
/* eslint-disable import/max-dependencies --
 * Workflow projection composes native persistence, author definitions and original-result comparison.
 */
import type { ActiveEntry, Locator, Ownership, Run } from "./checkpoint.ts";
import {
	BusyBeeError,
	conditionalUpdate,
	createServices,
	createTask,
	readBead,
	resolveEndpoint,
	resolveMutation,
} from "./native.ts";
import type { CreateTask, Endpoint, MutationEndpoint, Options, Services } from "./native.ts";
import type { Definition, Metadata, WorkflowActor, WorkflowNode } from "./definition.ts";
import {
	acquire,
	checkpointBead,
	patchOwned,
	readCheckpoint,
	withCheckpointOwner,
} from "./checkpoint.ts";
import {
	actorContext,
	briefSchema,
	childActors,
	currentStatus,
	initialActor,
	load,
	metadataSchema,
	readInput,
	renderTask,
	restoredActor,
	snapshotFor,
	targetActor,
} from "./definition.ts";
import {
	assertReservation,
	completionStatus,
	generatedInventory,
	projectCompletions,
	saveOriginal,
	successfulCompletion,
} from "./completion.ts";
import {
	nativeWorkflowState,
	readSpawnRequest,
	renderResponseInstructions,
	requestOutcome,
	requestResolution,
} from "@hive/shared";
import type { BeadRecord } from "@hive/beads";
import type { Snapshot } from "xstate";
import type { Source } from "./catalogue.ts";
import { compatibleWorkflowVersion } from "./compatibility.ts";
import { namedDefinition } from "./catalogue.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve author-selected files at the application boundary.
import { resolve } from "node:path";
import { z } from "zod";

export { checkpointBead } from "./checkpoint.ts";

const FIRST = 0;
const ONE = 1;
const text = z.string().min(ONE);
const contextSchema = z.compile(z.record(z.string(), z.unknown()));
const visitSchema = z.compile(
	z.object({
		bead: text,
		scope: z.enum(["visit", "group"]),
		node: text,
		parent: text,
		path: z.array(text),
		request: text.nullable(),
		visit: z.number().int().positive(),
	}),
);
const beeResponseSchema = z.compile(
	z.object({ ok: z.literal(true), request: z.object({ id: text }) }),
);
const viewEntrySchema = z.object({
	bead: text,
	commands: z.array(text),
	context: contextSchema,
	instructions: z.string(),
	path: z.array(text),
	request: text.nullable(),
	title: text,
});
export const runViewSchema = z.compile(
	z.object({
		active: z.array(viewEntrySchema),
		created: z.array(visitSchema),
		id: text,
		status: text,
		chartStatus: text,
		completion: z.enum(["pending", "projection_pending", "succeeded", "failed", "cancelled"]),
		nativeStatus: text,
	}),
);
export type RunView = z.infer<typeof runViewSchema>;
interface Entry {
	/** Stable actor-path and node identity during one active visit. */
	key: string;
	/** Node identifier in its XState machine. */
	node: string;
	/** Nearest bead-bearing ancestor key, if nested. */
	parent?: string;
	/** Child actor route from the root. */
	path: string[];
	/** Serializable task-facing context; actor refs are excluded. */
	context: Record<string, unknown>;
	/** Authoring metadata before its visit renderer runs. */
	meta: Metadata;
}
interface LockedRun extends Ownership {
	/** Persisted application state. */
	state: Run;
}
interface RunTarget {
	/** Existing workflow run ID. */
	id: string;
}
interface InspectRun extends RunTarget {
	/** Read the current run without submission. */
	operation: "show";
}
interface CollectRun extends RunTarget {
	/** Collect durable results from confirmed successful worker visits. */
	operation: "collect";
}
export type Navigation = InspectRun | CollectRun;
type WorkRequest = CollectRun;
interface InitializeRun extends RunTarget {
	/** Publish the initial frontier using the definition loaded for creation. */
	operation: "initialize";
	/** Newly created checkpoint; no relation discovery is needed. */
	checkpoint: string;
	/** Validated creation definition, retained only for this invocation. */
	definition: Definition;
	/** Ordinary parent validated before any publication. */
	parentId: string;
}
type Mutation = WorkRequest | InitializeRun;
/** Attempted initialization and identities confirmed by prior native responses. */
type InitializationAttempt = { parentId: string } & (
	| { uncertainOperation: "create_run" }
	| { uncertainOperation: "create_checkpoint"; runId: string }
	| { uncertainOperation: "link_checkpoint"; runId: string; checkpoint: string }
);
interface Submission {
	/** Active native visit being completed. */
	entry: ActiveEntry;
	/** Validated author command name. */
	choice: string;
	/** Author-validated payload. */
	data: unknown;
}
export interface DriverHandoff {
	/** Existing run used as the driver's completion anchor. */
	runId: string;
	/** Done only when saved chart and native completion agree. */
	status: string;
	/** System record validated under ownership. */
	checkpoint: string;
	/** Saved chart progress, independent of native projection. */
	chartStatus: string;
	/** Current system/native completion join. */
	completion: RunView["completion"];
	/** Current native run status. */
	nativeStatus: string;
}
export interface CompleteVisit extends RunTarget {
	/** Worker visit whose original result is retained on retries. */
	bead: string;
	/** Author-defined outcome. */
	choice: string;
	/** Original external JSON, preserved before schema transforms. */
	data: unknown;
}

export async function startNamed(
	name: string,
	options: Options = {},
	services: Services = createServices(),
): Promise<RunView> {
	const selected = await namedDefinition(name, options.repo, services);
	return initialize(
		{ kind: "named", name, version: selected.metadata.version },
		{ directory: selected.directory, kind: "folder", source: selected.source },
		{ options, services },
	);
}

export function start(
	source: string,
	options: Options = {},
	services: Services = createServices(),
): Promise<RunView> {
	source = resolve(services.cwd, source);
	return initialize({ kind: "source", source }, { kind: "file", source }, { options, services });
}

export async function navigate(
	request: Navigation,
	options: Options = {},
	services: Services = createServices(),
): Promise<RunView> {
	if (request.operation === "show") {
		const endpoint = await resolveEndpoint(options, services);
		const run = await readRun(endpoint, request.id, services);
		const { actor } = await restore(run, endpoint, services);
		try {
			return await view(run, endpoint, services);
		} finally {
			actor.stop();
		}
	}
	if (request.operation !== "collect") {
		throw new BusyBeeError(
			"invalid_operation",
			"Use complete followed by collect; direct outcome submission is not supported.",
		);
	}
	return mutate(request, await resolveMutation(options, services), services);
}

export async function prepareDriver(
	id: string,
	options: Options = {},
	services: Services = createServices(),
): Promise<DriverHandoff> {
	const endpoint = await resolveMutation(options, services);
	const lock = await acquire(endpoint, await checkpointBead(endpoint, id, services), services);
	return withCheckpointOwner({ endpoint, lock, runId: id }, services, async () => {
		const run = readCheckpoint(await readBead(endpoint, lock.checkpoint, services));
		assertOrdinaryPublication(run);
		const { actor } = await restore(run, endpoint, services);
		try {
			if (currentStatus(actor) !== "done") {
				await handoffActiveRun({ endpoint, run, locked: lock }, services);
			}
			return {
				checkpoint: lock.checkpoint,
				runId: id,
				...completionStatus(run, await readBead(endpoint, run.id, services)),
			};
		} finally {
			actor.stop();
		}
	});
}

/** A definition-free ownership window for completion projection and explicit settlement. */
export async function withRunPublication<Result>(
	input: { id: string; options: Options; services: Services },
	operation: (
		publication: { run: Run; endpoint: MutationEndpoint; owner: string; locked: Ownership },
		writes: Services,
	) => Promise<Result>,
): Promise<Result> {
	const { id, options, services } = input;
	const endpoint = await resolveMutation(options, services);
	const lock = await acquire(endpoint, await checkpointBead(endpoint, id, services), services);
	return withCheckpointOwner({ endpoint, lock, runId: id }, services, async () => {
		const run = readCheckpoint(await readBead(endpoint, lock.checkpoint, services));
		return operation({ run, endpoint, owner: lock.owner, locked: lock }, services);
	});
}

/** One successful completion path: save original and intent, then project native closure. */
export function complete(
	request: CompleteVisit,
	options: Options = {},
	services: Services = createServices(),
) {
	return withRunPublication(
		{ id: request.id, options, services },
		// eslint-disable-next-line max-statements -- Keep original result and closure failure evidence together.
		async (publication) => {
			const { run, endpoint, locked } = publication;
			assertOrdinaryPublication(run);
			await generatedInventory(publication, services);
			await validateOriginalCommand({ run, endpoint, request }, services);
			try {
				await saveOriginal({ run, endpoint, locked, ...request }, services);
				await projectCompletions(publication, services);
			} catch (error) {
				const fresh = readCheckpoint(await readBead(endpoint, locked.checkpoint, services));
				let reason = "completion_pending";
				let context: Record<string, unknown> = {};
				if (error instanceof BusyBeeError) {
					({ reason, context } = error);
				}
				throw new BusyBeeError(
					reason,
					`Completion for task ${request.bead} is not fully projected. Inspect its native gates ` +
						`and retry complete with the same original choice and data, or reconcile ${run.id}.`,
					{
						cause: error,
						context: {
							...context,
							runId: run.id,
							stageId: request.bead,
							checkpoint: locked.checkpoint,
							resultSaved: Boolean(fresh.results[request.bead]),
							completion: fresh.completions[request.bead]?.state,
						},
					},
				);
			}
			return { runId: request.id, stageId: request.bead, choice: request.choice };
		},
	);
}

/** Explicit native completion repair without loading a workflow definition. */
export function reconcile(
	id: string,
	options: Options = {},
	services: Services = createServices(),
) {
	return withRunPublication({ id, options, services }, async (publication) => ({
		runId: id,
		...(await projectCompletions(publication, services)),
	}));
}

export async function discover(
	id: string,
	options: Options = {},
	services: Services = createServices(),
) {
	const endpoint = await resolveEndpoint(options, services);
	const run = await readRun(endpoint, id, services);
	const { actor, definition } = await restore(run, endpoint, services);
	actor.stop();
	return {
		active: run.active.map((entry) => discoveryEntry(entry, definition)),
		constraints:
			"Use complete to save the original outcome and close the task; " +
			"the driver then collects saved results. Read busybee complete --help. " +
			"Discovery is a snapshot, not a reservation.",
		id,
	};
}

function discoveryEntry(entry: ActiveEntry, definition: Definition) {
	return {
		...definition.describe?.(entry),
		bead: entry.bead,
		choices: Object.keys(entry.meta.commands ?? {}).map((choice) => ({
			choice,
			schema: z.toJSONSchema(commandSchema(definition, entry, choice), { io: "input" }),
		})),
		title: entry.meta.title,
	};
}

/** Read the current actor task frontier without starting or advancing it. */
export function frontier(
	actor: WorkflowActor,
	path: string[] = [],
	inheritedParent?: string,
): Entry[] {
	const snapshot = actor.getSnapshot();
	if (snapshot.status !== "active") {
		return [];
	}
	const context = Object.fromEntries(
		Object.entries(actorContext(actor)).filter(([key]) => key !== "workers"),
	);
	// XState v5 exposes the active hierarchy here; this is the sole version-specific projection.
	// eslint-disable-next-line no-underscore-dangle
	const entries = workNodes(snapshot._nodes).map((node) =>
		nodeEntry(node, { context, inheritedParent, path }),
	);
	for (const child of childActors(actor)) {
		const group = text.parse(actorContext(child)["group"]);
		entries.push(...frontier(child, [...path, child.id], `${path.join("/")}:${group}`));
	}
	return entries;
}

// --- Private functions ---

// eslint-disable-next-line max-statements -- Validate active and consumed retries without replaying author transitions.
async function validateOriginalCommand(
	input: { run: Run; endpoint: MutationEndpoint; request: CompleteVisit },
	services: Services,
): Promise<void> {
	const { run, endpoint, request } = input;
	const entry = run.active.find((item) => item.bead === request.bead);
	const consumed = run.history.some((item) => item.bead === request.bead);
	if (
		(!entry?.meta.commands && !consumed) ||
		run.created.find((item) => item.bead === request.bead)?.scope !== "visit"
	) {
		throw new BusyBeeError(
			"inactive_task",
			`Task ${request.bead} is not a worker visit of run ${run.id}.`,
			{ context: { runId: run.id, bead: request.bead } },
		);
	}
	if (
		consumed &&
		(!run.results[request.bead] || run.completions[request.bead]?.outcome !== "succeeded")
	) {
		throw new BusyBeeError(
			"invalid_stage_result",
			`Consumed visit ${request.bead} has no retained original and successful completion.`,
			{ context: { runId: run.id, bead: request.bead } },
		);
	}
	assertReservation(await readBead(endpoint, request.bead, services), endpoint, services);
	if (consumed) {
		return;
	}
	const { actor, definition } = await restore(run, endpoint, services);
	try {
		const data = validatePayload({
			definition,
			entry: entry!,
			payload: request,
			collecting: false,
		});
		submissionTarget(actor, { choice: request.choice, data, entry: entry! });
	} finally {
		actor.stop();
	}
}

async function initialize(
	locator: Locator,
	source: Source,
	environment: { options: Options; services: Services },
): Promise<RunView> {
	const { options, services } = environment;
	const endpoint = await resolveMutation(options, services);
	if (!options.owner) {
		throw new BusyBeeError(
			"missing_owner",
			"Starting a run requires --owner identifying the accountable human.",
		);
	}
	const parentId = await readCreationParent(options.parent, endpoint, services);
	const { definition, hash } = await load(source, services);
	const { actor, brief } = await initialDefinition(definition, options.inputFile, services);
	try {
		return await createRun(
			{
				brief,
				definition,
				locator,
				endpoint,
				hash,
				identity: { assignee: options.assignee ?? endpoint.actor, owner: options.owner },
				parentId,
				snapshot: snapshotFor(actor),
			},
			services,
		);
	} finally {
		actor.stop();
	}
}

async function initialDefinition(
	definition: Definition,
	inputFile: string | undefined,
	services: Services,
) {
	const input = await readInput(definition, inputFile, services);
	const brief = briefSchema.parse(definition.runBrief(input));
	return { actor: initialActor(definition, input), brief };
}

async function readCreationParent(
	id: string | undefined,
	endpoint: MutationEndpoint,
	services: Services,
): Promise<string> {
	if (!id) {
		throw new BusyBeeError(
			"missing_parent",
			"Starting a run requires --parent identifying existing ordinary work in the selected tracker.",
		);
	}
	const parent = await readBead(endpoint, id, services);
	if (parent.status === "closed" || parent.labels.includes("system")) {
		throw new BusyBeeError(
			"invalid_parent",
			`Workflow parent ${parent.id} must be nonclosed ordinary work without the system label.`,
			{ context: { parentId: parent.id } },
		);
	}
	return parent.id;
}

// Keep confirmed identities and the failed write in one initialization error boundary.
// eslint-disable-next-line max-statements
async function createRun(
	input: {
		brief: z.infer<typeof briefSchema>;
		definition: Definition;
		locator: Locator;
		endpoint: MutationEndpoint;
		hash: string;
		identity: { owner: string; assignee: string };
		parentId: string;
		snapshot: Snapshot<unknown>;
	},
	services: Services,
): Promise<RunView> {
	const { brief, definition, locator, endpoint, hash, identity, parentId, snapshot } = input;
	let attempt: InitializationAttempt = { parentId, uncertainOperation: "create_run" };
	try {
		const id = await createTask(
			endpoint,
			{
				...brief,
				assignee: identity.assignee,
				labels: ["busybee-workflow"],
				owner: identity.owner,
				parent: parentId,
				status: "in_progress",
			},
			services,
		);
		attempt = { parentId, runId: id, uncertainOperation: "create_checkpoint" };
		const state: Run = {
			managedExecution: "unmanaged",
			formatVersion: 2,
			lock: null,
			results: {},
			completions: {},
			settlement: null,
			active: [],
			created: [],
			definition: locator,
			hash,
			history: [],
			id,
			snapshot,
			visits: {},
		};
		const checkpoint = await createTask(
			endpoint,
			{
				description: JSON.stringify(state),
				labels: ["system", "busybee-checkpoint"],
				owner: identity.owner,
				status: "open",
				title: `Workflow checkpoint: ${id}`,
			},
			services,
		);
		attempt = { parentId, runId: id, checkpoint, uncertainOperation: "link_checkpoint" };
		services.beforeWrite();
		await services.beads.dep.add(
			{ actor: endpoint.actor, cwd: endpoint.repo, db: endpoint.db },
			id,
			checkpoint,
			"related",
		);
	} catch (error) {
		const known = Object.entries(attempt)
			.filter(([key]) => key !== "uncertainOperation")
			.map(([key, value]) => `${key} ${value}`)
			.join(", ");
		throw new BusyBeeError(
			"partial_effects",
			"Workflow initialization failed during " +
				`${attempt.uncertainOperation}` +
				"; native effects may be retained. Confirmed identities: " +
				`${known}` +
				". Inspect the tracker for completed and uncertain effects before resubmitting.",
			{ cause: error, context: attempt },
		);
	}
	const { runId: id, checkpoint } = attempt;
	return mutate(
		{ checkpoint, definition, id, parentId, operation: "initialize" },
		endpoint,
		services,
	);
}

async function readRun(
	endpoint: { repo: string; db: string },
	id: string,
	services: Services,
): Promise<Run> {
	const record = await checkpointBead(endpoint, id, services);
	return readCheckpoint(record);
}

async function restore(
	run: Run,
	endpoint: Endpoint,
	services: Services,
): Promise<{ actor: WorkflowActor; definition: Definition }> {
	const { definition } = await restoreDefinition(run, endpoint, services);
	const actor = restoredActor(definition, run.snapshot);
	return { actor, definition };
}

export async function restoreDefinition(run: Run, endpoint: Endpoint, services: Services) {
	try {
		return await loadRetainedDefinition(run, endpoint, services);
	} catch (error) {
		if (
			!(error instanceof BusyBeeError) ||
			(error.reason !== "definition_changed" && error.reason !== "workflow_missing")
		) {
			throw error;
		}
		const context = {
			...error.context,
			...endpoint,
			runId: run.id,
			stageIds: run.created.map((visit) => visit.bead),
			stageRequestIds: run.created.flatMap((visit) => {
				if (visit.request) {
					return [visit.request];
				}
				return [];
			}),
			acceptedResults: run.history.map(({ bead, command, request }) => ({
				bead,
				command,
				request,
			})),
			nextAction: `br show ${run.id} --json`,
		};
		if (run.definition.kind === "source") {
			throw new BusyBeeError(
				error.reason,
				`${error.message} Inspect ${context.nextAction} and retained visits first; ` +
					"preserve their evidence and native parent when handing off remaining work. " +
					"Leave unfinished old work open; replacement completion does not complete it.",
				{ cause: error, context },
			);
		}
		const { name } = run.definition;
		const recovery = {
			definition_changed: {
				state: "changed",
				guidance:
					`Inspect br show ${run.id} --json and its visits before deciding disposition. ` +
					`You may create a fresh run of ${name}` +
					" for the same already-authorized scope without asking the user " +
					`again. Inspect busybee input-schema ${name}, then use busybee run ` +
					`${name} --parent ORIGINAL_PARENT with the current input schema. Reuse the ` +
					"old run's native parent. Preserve the original request and " +
					"authorization, source/target, scope, owner/assignment, selected " +
					"tracker and old run/task/evidence references. Inspect completed and " +
					"uncertain effects and use the current workflow's triage to continue " +
					"remaining work without blindly replaying completed effects. Retain " +
					"the old run as history; do not migrate its snapshot or bypass " +
					"current checks and reviews. Leave unfinished old visits and their run open " +
					"with a documented blocker and next operator action; replacement completion " +
					"does not complete them or permit their parent to close.",
			},
			workflow_missing: {
				state: "is missing",
				guidance: `Stop and ask the user which workflow to use; do not infer a replacement for ${name}.`,
			},
		}[error.reason];
		throw new BusyBeeError(
			error.reason,
			`Cannot restore run ${run.id}: named workflow ${name} ${recovery.state}. ${recovery.guidance}`,
			{
				cause: error,
				context: { ...context, name },
			},
		);
	}
}

async function loadRetainedDefinition(run: Run, endpoint: Endpoint, services: Services) {
	if (run.definition.kind === "source") {
		return load({ kind: "file", source: run.definition.source, expectedHash: run.hash }, services);
	}
	const selected = await namedDefinition(run.definition.name, endpoint.repo, services);
	if (!compatibleWorkflowVersion(run.definition.version, selected.metadata.version)) {
		throw new BusyBeeError(
			"definition_changed",
			`Workflow ${run.definition.name} version ` +
				`${selected.metadata.version} cannot resume version ` +
				`${run.definition.version}.`,
			{
				context: {
					savedVersion: run.definition.version,
					proposedVersion: selected.metadata.version,
				},
			},
		);
	}
	const loaded = await load(selected, services);
	run.definition.version = selected.metadata.version;
	run.hash = loaded.hash;
	return loaded;
}

async function mutate(
	request: Mutation,
	endpoint: MutationEndpoint,
	services: Services,
): Promise<RunView> {
	const checkpoint = await mutationCheckpoint(request, endpoint, services);
	const lock = await acquire(endpoint, checkpoint, services);
	return mutateOwned({ endpoint, lock, request }, services);
}

function mutationCheckpoint(
	request: Mutation,
	endpoint: MutationEndpoint,
	services: Services,
): string | Promise<BeadRecord> {
	if (request.operation === "initialize") {
		return request.checkpoint;
	}
	return checkpointBead(endpoint, request.id, services);
}

function mutateOwned(
	input: { lock: Ownership; request: Mutation; endpoint: MutationEndpoint },
	services: Services,
): Promise<RunView> {
	const { lock, request, endpoint } = input;
	const identity: { runId: string; parentId?: string } = { runId: request.id };
	if (request.operation === "initialize") {
		identity.parentId = request.parentId;
	}
	return withCheckpointOwner({ endpoint, lock, ...identity }, services, async () => {
		const prepared = await prepareMutation({ endpoint, lock, request }, services);
		try {
			await publish({ actor: prepared.actor, endpoint, locked: prepared.locked }, services);
			return await view(prepared.locked.state, endpoint, services);
		} finally {
			prepared.actor.stop();
		}
	});
}

// eslint-disable-next-line max-statements -- Keep reservation checks and uncertain handoff quarantine ordered.
async function handoffActiveRun(
	input: { endpoint: MutationEndpoint; run: Run; locked: Ownership },
	services: Services,
): Promise<void> {
	const { endpoint, run, locked } = input;
	const identity = await readBead(endpoint, run.id, services);
	assertUnassignedRun(identity);
	for (const entry of run.active.filter((item) => item.meta.commands && !item.request)) {
		// eslint-disable-next-line no-await-in-loop -- Validate driver-handled reservations before any handoff effect.
		assertAgentReservation(await readBead(endpoint, entry.bead, services));
	}
	await markManagedExecution({ endpoint, run, locked }, services);
	locked.uncertainOperation = "prepare_driver";
	const updated = await conditionalUpdate(
		{ bead: identity, endpoint, input: { assignee: "", status: "open" } },
		services,
	);
	delete locked.uncertainOperation;
	if (!updated) {
		throw new BusyBeeError("run_changed", `Run ${run.id} changed during driver preparation.`, {
			context: { runId: run.id },
		});
	}
}

function assertUnassignedRun(identity: BeadRecord): void {
	assertAgentReservation(identity);
	if (identity.assignee) {
		throw new BusyBeeError(
			"run_assigned",
			"Run " +
				`${identity.id}` +
				" is assigned to " +
				`${identity.assignee}` +
				"; driver preparation must preserve existing claims.",
			{ context: { runId: identity.id, assignee: identity.assignee } },
		);
	}
	if (identity.status === "closed" || identity.status === "blocked") {
		throw new BusyBeeError(
			"run_not_ready",
			`Run ${identity.id} is ${identity.status}; resolve its native state before attachment.`,
			{ context: { runId: identity.id } },
		);
	}
}

function assertAgentReservation(bead: BeadRecord): void {
	if (
		bead.status !== "closed" &&
		((bead.assignee && bead.assignee === bead.owner) || bead.labels.includes("hitl"))
	) {
		throw new BusyBeeError("human_reserved", `Task ${bead.id} is reserved for human action.`, {
			context: { bead: bead.id },
		});
	}
}

/* eslint-disable-next-line max-statements -- Validate retirement before restoring the authored transition. */
async function prepareMutation(
	input: { lock: Ownership; request: Mutation; endpoint: MutationEndpoint },
	services: Services,
) {
	const { lock, request, endpoint } = input;
	const locked = Object.assign(lock, {
		state: readCheckpoint(await readBead(endpoint, lock.checkpoint, services)),
	});
	if (request.operation === "initialize") {
		return { actor: restoredActor(request.definition, locked.state.snapshot), locked };
	}
	assertOrdinaryPublication(locked.state);
	await projectCompletions({ endpoint, run: locked.state, locked: lock }, services);
	const { actor, definition } = await restore(locked.state, endpoint, services);
	try {
		await prepare({ actor, definition, endpoint, request, run: locked.state }, services);
		return { actor, locked };
	} catch (error) {
		actor.stop();
		throw error;
	}
}

interface Preparation {
	/** Current native command and payload. */
	request: WorkRequest;
	/** Fresh state under the checkpoint owner. */
	run: Run;
	/** Restored statechart. */
	actor: WorkflowActor;
	/** Author's schemas and renderers. */
	definition: Definition;
	/** Selected native tracker and caller. */
	endpoint: MutationEndpoint;
}

async function prepare(input: Preparation, services: Services): Promise<void> {
	const { run, actor } = input;
	const submissions = await collectSubmissions(input, services);
	for (const submission of submissions) {
		advance(actor, submission);
		run.history.push({
			bead: submission.entry.bead,
			command: submission.choice,
			data: submission.data,
			request: submission.entry.request,
		});
	}
	const completed = new Set(submissions.map((submission) => submission.entry.bead));
	await assertOpenParents({ actor, completed, endpoint: input.endpoint, run }, services);
	run.active = run.active.filter((entry) => !completed.has(entry.bead));
}

// Validate the complete closed result batch before diagnosing terminal requests.
// eslint-disable-next-line max-statements
async function collectSubmissions(input: Preparation, services: Services): Promise<Submission[]> {
	const selected = input.run.active.filter((entry) => Boolean(entry.meta.commands));
	const submissions: Submission[] = [];
	for (const entry of selected) {
		// eslint-disable-next-line no-await-in-loop -- Validate the stable frontier batch before sending any event.
		const task = await readBead(input.endpoint, entry.bead, services);
		if (task.status === "closed") {
			submissions.push(validateSubmission(entry, task, input));
		}
	}
	if (submissions.length === FIRST) {
		await assertBeeRequests({ entries: selected, runId: input.run.id }, input.endpoint, services);
	}
	return submissions;
}

async function assertBeeRequests(
	input: { entries: ActiveEntry[]; runId: string },
	endpoint: Endpoint,
	services: Services,
): Promise<void> {
	for (const entry of input.entries.filter((item) => item.request)) {
		// eslint-disable-next-line no-await-in-loop -- Diagnose unsuccessful Bee requests in frontier order.
		const request = await currentStageRequest(
			{ id: entry.request!, stageId: entry.bead, runId: input.runId },
			endpoint,
			services,
		);
		if (requestOutcome(request) !== "pending") {
			throw new BusyBeeError(
				"bee_execution_unsuccessful",
				"Bee-dispatched task " +
					`${entry.bead}` +
					" has no closed result; request " +
					`${request.id}` +
					" ended as " +
					`${request.close_reason ?? "cancelled"}` +
					". Inspect bee status " +
					`${request.id}` +
					". Read bee retry --help for failed-request recovery or deliberate " +
					"cancellation resumption with --resume-cancelled.",
				{
					context: {
						bead: entry.bead,
						runId: input.runId,
						request: request.id,
						outcome: requestOutcome(request),
					},
				},
			);
		}
	}
}

async function currentStageRequest(
	input: { id: string; stageId: string; runId: string },
	endpoint: Endpoint,
	services: Services,
): Promise<BeadRecord> {
	const { id } = input;
	const request = await readBead(endpoint, id, services);
	assertStageRequest(request, input);
	const resolution = requestResolution(request);
	if (resolution.kind === "superseded") {
		if (resolution.replacementIds.length !== ONE) {
			throw new BusyBeeError(
				"ambiguous_replacement",
				`Request ${id} has multiple replacements; inspect its native supersedes links.`,
				{ context: { request: id } },
			);
		}
		return currentStageRequest(
			{ ...input, id: resolution.replacementIds[FIRST]! },
			endpoint,
			services,
		);
	}
	return request;
}

function assertStageRequest(
	request: BeadRecord,
	input: { id: string; stageId: string; runId: string },
): void {
	const { id, stageId, runId } = input;
	const { assignment } = readSpawnRequest(request);
	if (assignment.kind !== "stage" || assignment.stageId !== stageId || assignment.runId !== runId) {
		throw new BusyBeeError(
			"invalid_stage_request",
			`Request ${id} does not describe stage ${stageId} in run ${runId}.`,
			{ context: { request: id, bead: stageId, runId } },
		);
	}
}

function validateSubmission(entry: ActiveEntry, task: BeadRecord, input: Preparation): Submission {
	const payload = input.run.results[entry.bead];
	if (!payload) {
		throw new BusyBeeError(
			"invalid_stage_result",
			`Task ${entry.bead} has no original result in the workflow system record.`,
			{ context: { bead: entry.bead, runId: input.run.id } },
		);
	}
	const state = nativeWorkflowState(task, { runId: input.run.id, scope: "visit" }, input.run);
	if (state.kind !== "terminal" || state.fact.outcome !== "succeeded") {
		throw new BusyBeeError(
			"retired_visit",
			`Task ${task.id} has no confirmed successful native projection.`,
			{ context: { bead: task.id, runId: input.run.id } },
		);
	}
	const data = validatePayload({ entry, definition: input.definition, payload, collecting: true });
	return { choice: payload.choice, data, entry };
}

function assertOrdinaryPublication(run: Run): void {
	if (run.settlement) {
		throw new BusyBeeError(
			"settlement_pending",
			`Workflow ${run.id} is fenced by ${run.settlement.operation} settlement; resume that operation.`,
			{ context: { runId: run.id } },
		);
	}
	if (run.completions[run.id] && run.completions[run.id]!.outcome !== "succeeded") {
		throw new BusyBeeError("workflow_retired", `Workflow ${run.id} has been retired.`, {
			context: { runId: run.id },
		});
	}
}

function validatePayload(input: {
	entry: ActiveEntry;
	definition: Definition;
	payload: { choice: string; data: unknown };
	collecting: boolean;
}): unknown {
	const { entry, definition, payload, collecting } = input;
	try {
		const data = commandSchema(definition, entry, payload.choice).parse(payload.data);
		definition.validateCommand?.(entry, payload.choice, data);
		return data;
	} catch (error) {
		if (!collecting) {
			throw error;
		}
		throw new BusyBeeError(
			"invalid_stage_result",
			`Result for task ${entry.bead} fails its ${payload.choice} payload contract.`,
			{ cause: error, context: { bead: entry.bead, choice: payload.choice } },
		);
	}
}

function commandSchema(definition: Definition, entry: ActiveEntry, choice: string): z.ZodType {
	const schema = definition.commandSchemas[choice];
	if (!schema) {
		throw new BusyBeeError(
			"missing_command_schema",
			`Task ${entry.bead} declares choice ${JSON.stringify(choice)} without a command schema.`,
			{ context: { bead: entry.bead, choice } },
		);
	}
	return schema;
}

async function assertOpenParents(
	input: { run: Run; actor: WorkflowActor; endpoint: MutationEndpoint; completed: Set<string> },
	services: Services,
): Promise<void> {
	const { run, actor, endpoint, completed } = input;
	const previous = new Map(run.active.map((entry) => [entry.key, entry]));
	for (const entry of frontier(actor)) {
		const existing = previous.get(entry.key);
		const parent = destinationParent(entry, previous, run.id);
		if ((!existing || completed.has(existing.bead)) && parent) {
			// Reject the first closed structural parent before creating any native work.
			// eslint-disable-next-line no-await-in-loop
			const record = await readBead(endpoint, parent, services);
			if (record.status === "closed") {
				throw new BusyBeeError(
					"closed_parent",
					`Cannot create new work beneath closed parent ${parent}` +
						". Use an open grouping state without worker commands for nested " +
						"work.",
				);
			}
		}
	}
}

function destinationParent(
	entry: Entry,
	previous: Map<string, ActiveEntry>,
	run: string,
): string | undefined {
	if (!entry.parent) {
		return run;
	}
	// A new container is created in this publication; an existing parent must still be open.
	return previous.get(entry.parent)?.bead;
}

function workNodes(nodes: WorkflowNode[]): WorkflowNode[] {
	const completedParents = new Set(
		nodes.filter((node) => node.type === "final").map((node) => node.parent),
	);
	return nodes.filter(
		(node) => node.type !== "final" && node.meta?.["title"] && !completedParents.has(node),
	);
}

function nodeEntry(
	node: WorkflowNode,
	input: { path: string[]; context: Record<string, unknown>; inheritedParent: string | undefined },
): Entry {
	const { path, context, inheritedParent } = input;
	const ancestor = titledAncestor(node);
	const entry: Entry = {
		context,
		key: `${path.join("/")}:${node.id}`,
		meta: metadataSchema.parse(node.meta),
		node: node.id,
		path,
	};
	let parent = inheritedParent;
	if (ancestor) {
		parent = `${path.join("/")}:${ancestor.id}`;
	}
	if (parent) {
		entry.parent = parent;
	}
	return entry;
}

function titledAncestor(node: WorkflowNode) {
	let ancestor = node.parent;
	while (ancestor && !ancestor.meta?.["title"]) {
		ancestor = ancestor.parent;
	}
	return ancestor;
}

function advance(root: WorkflowActor, submission: Submission): void {
	const { actor, type } = submissionTarget(root, submission);
	actor.send({ data: submission.data, type });
	const snapshot = root.getSnapshot();
	if (snapshot.status === "error") {
		throw snapshot.error;
	}
}

function submissionTarget(root: WorkflowActor, submission: Submission) {
	const { entry, choice, data } = submission;
	const actor = targetActor(root, entry.path);
	const type = entry.meta.commands?.[choice];
	if (!type || !actor.getSnapshot().can({ data, type })) {
		throw new BusyBeeError(
			"unavailable_command",
			`Command ${choice} unavailable for ${entry.bead}`,
			{ context: { bead: entry.bead, choice } },
		);
	}
	return { actor, type };
}

// eslint-disable-next-line max-statements -- Commit advancement before closing or creating native work.
async function publish(
	input: { locked: LockedRun; actor: WorkflowActor; endpoint: MutationEndpoint },
	services: Services,
): Promise<void> {
	const { locked, actor, endpoint } = input;
	const run = locked.state;
	const current = frontier(actor);
	const keys = new Set(current.map((entry) => entry.key));
	const departed = run.active.filter((entry) => !keys.has(entry.key) && !entry.meta.commands);
	run.active = run.active.filter((entry) => keys.has(entry.key));
	run.snapshot = snapshotFor(actor);
	// Accepted history, snapshot, retired frontier and container intents commit before native closure.
	await savePublication({ endpoint, locked, run }, services, (fresh) => {
		for (const entry of departed) {
			fresh.completions[entry.bead] ??= successfulCompletion("group");
		}
		if (currentStatus(actor) === "done") {
			fresh.completions[run.id] ??= successfulCompletion("run");
		}
	});
	await projectCompletions({ endpoint, run, locked }, services);
	const identity = await readBead(endpoint, run.id, services);
	run.active = await publishEntries({ current, endpoint, identity, run, locked }, services);
	await savePublication({ endpoint, locked, run }, services);
}

async function savePublication(
	input: { endpoint: MutationEndpoint; locked: Ownership; run: Run },
	services: Services,
	controlPatch?: (run: Run) => void,
): Promise<void> {
	const { run, endpoint, locked } = input;
	const fresh = await patchOwned(
		{
			endpoint,
			locked,
			patch: (saved) => {
				Object.assign(saved, {
					active: run.active,
					created: run.created,
					definition: run.definition,
					hash: run.hash,
					history: run.history,
					snapshot: run.snapshot,
					visits: run.visits,
				});
				if (run.managedExecution === "managed") {
					saved.managedExecution = "managed";
				}
				controlPatch?.(saved);
			},
		},
		services,
	);
	Object.assign(run, fresh);
}

async function publishEntries(
	input: {
		current: Entry[];
		endpoint: MutationEndpoint;
		identity: BeadRecord;
		run: Run;
		locked: Ownership;
	},
	services: Services,
): Promise<ActiveEntry[]> {
	const { current, endpoint, identity, run, locked } = input;
	const previous = new Map(run.active.map((entry) => [entry.key, entry]));
	const active: ActiveEntry[] = [];
	for (const entry of current) {
		const existing = previous.get(entry.key);
		if (existing) {
			active.push({
				...entry,
				bead: existing.bead,
				context: existing.context,
				meta: existing.meta,
				request: existing.request,
			});
		} else {
			// eslint-disable-next-line no-await-in-loop -- Each child needs the parent's newly created native ID.
			const created = await enter({ active, endpoint, entry, identity, run, locked }, services);
			active.push(created);
		}
	}
	return active;
}

interface EntryInput {
	/** Existing checkpoint ownership, retained through managed exposure stamping. */
	locked: Ownership;
	/** Author state entering this published frontier. */
	entry: Entry;
	/** Earlier entries, including structural parents. */
	active: ActiveEntry[];
	/** Checkpoint being advanced. */
	run: Run;
	/** Native root ownership and assignment. */
	identity: BeadRecord;
	/** Current tracker and audit caller. */
	endpoint: MutationEndpoint;
}

// eslint-disable-next-line max-statements -- Save membership before dispatch and retain unknown-effect quarantine.
async function enter(input: EntryInput, services: Services): Promise<ActiveEntry> {
	const { entry, run, endpoint, locked } = input;
	const prepared = entryCreation(input);
	if (prepared.meta.bee) {
		await markManagedExecution({ endpoint, run, locked }, services);
	}
	locked.uncertainOperation = "create_generated_task";
	delete locked.knownBead;
	delete locked.knownRequest;
	const bead = await createTask(endpoint, prepared.creation, services);
	locked.knownBead = bead;
	const published: ActiveEntry = { ...entry, bead, meta: prepared.meta, request: null };
	let scope: "visit" | "group" = "group";
	if (prepared.meta.commands) {
		scope = "visit";
	}
	const visit = {
		bead,
		scope,
		node: entry.node,
		parent: prepared.creation.parent,
		path: entry.path,
		request: null as string | null,
		visit: prepared.visit,
	};
	run.created.push(visit);
	run.active = [...input.active, published];
	await savePublication({ endpoint, locked, run }, services);
	delete locked.uncertainOperation;
	if (prepared.meta.bee) {
		locked.uncertainOperation = "dispatch_stage";
		published.request = await spawnBee(
			{
				bead,
				description: taskDescription(prepared.meta, { run, endpoint, bead }),
				endpoint,
				meta: prepared.meta,
				run: run.id,
			},
			services,
		);
		locked.knownRequest = published.request;
		run.created.find((item) => item.bead === bead)!.request = published.request;
		run.active.find((item) => item.bead === bead)!.request = published.request;
		await savePublication({ endpoint, locked, run }, services);
		delete locked.uncertainOperation;
	}
	return published;
}

function entryCreation(input: EntryInput) {
	const { entry, active, run, identity, endpoint } = input;
	const meta = renderTask(entry.meta, entry.context);
	let parent = run.id;
	if (entry.parent) {
		parent = active.find((item) => item.key === entry.parent)!.bead;
	}
	const visit = (run.visits[entry.key] ?? FIRST) + ONE;
	run.visits[entry.key] = visit;
	const creation = nativeTaskOptions(meta, identity, {
		description: taskDescription(meta, { run, endpoint }),
		parent,
		title: `${meta.title} [${String(entry.context["role"] ?? entry.node)}; visit ${visit}]`,
	});
	return { creation, meta, visit };
}

function nativeTaskOptions(
	meta: ActiveEntry["meta"],
	identity: BeadRecord,
	brief: { description: string; parent: string; title: string },
): CreateTask & { parent: string } {
	const creation: CreateTask & { parent: string } = {
		...brief,
		acceptanceCriteria: meta.acceptanceCriteria,
		labels: ["busybee-workflow"],
		owner: text.parse(identity.owner),
		status: "in_progress",
	};
	if (meta.bee) {
		creation.status = "open";
	}
	if (meta.commands && !meta.bee && identity.assignee) {
		creation.assignee = identity.assignee;
	}
	return creation;
}

function taskDescription(
	meta: ActiveEntry["meta"],
	{ run, endpoint, bead = "TASK_ID" }: { run: Run; endpoint: MutationEndpoint; bead?: string },
): string {
	let completion = "Busy Bee closes this grouping bead after its workers finish; leave it open.";
	if (meta.commands) {
		let taskId = run.id;
		let delivery = "The driver files the run's final answer or synthesis.";
		if (meta.bee) {
			taskId = bead;
			delivery = "File this stage's answer before completing it.";
		}
		completion =
			`${delivery} ${renderResponseInstructions({ taskId })}\n\n` +
			"Verify acceptance, tick all native acceptance checklist items, and finish child work before using " +
			`busybee --db ${JSON.stringify(endpoint.db)} complete ${run.id} ` +
			"TASK_ID CHOICE to save the original outcome and close this stage. " +
			"Read busybee complete --help for payload options and retries. " +
			"The driver collects saved results; Busy Bee closes groups and the run.";
	}
	return (
		`${meta.instructions}\n\n${completion}\n\n` +
		`Discover choices and payload schemas: busybee --db ${JSON.stringify(endpoint.db)} ` +
		`discover ${run.id} --json. Use the checkout (or --repo) containing the definition. ` +
		"TASK_ID is this stage's bead ID."
	);
}

async function spawnBee(
	input: {
		bead: string;
		description: string;
		endpoint: MutationEndpoint;
		meta: ActiveEntry["meta"];
		run: string;
	},
	services: Services,
): Promise<string> {
	const { bead, description, endpoint, meta, run } = input;
	const prompt =
		`Workflow task ${bead}.\n\n${description}\n\n` +
		`Read br show ${bead} --json and follow its completion instructions. ` +
		"Leave workflow navigation to the driver.";
	services.beforeWrite();
	const output = await services.execute(
		[
			"bee",
			"system",
			"dispatch-stage",
			meta.bee!.kind,
			bead,
			"--run",
			run,
			"--repo",
			endpoint.repo,
			"--beads-db",
			endpoint.db,
			"--actor",
			endpoint.actor,
			"--cwd",
			endpoint.repo,
			"--prompt",
			prompt,
			"--json",
		],
		endpoint.repo,
	);
	return beeResponseSchema.parse(JSON.parse(output) as unknown).request.id;
}

async function view(run: Run, endpoint: Endpoint, services: Services): Promise<RunView> {
	const native = await readBead(endpoint, run.id, services);
	return {
		active: run.active.map((entry) => ({
			bead: entry.bead,
			commands: Object.keys(entry.meta.commands ?? {}),
			context: entry.context,
			instructions: entry.meta.instructions,
			path: entry.path,
			request: entry.request,
			title: entry.meta.title,
		})),
		created: run.created,
		id: run.id,
		...completionStatus(run, native),
	};
}

/** Stamp the coherent prior checkpoint before any managed handoff, then carry it into publication. */
async function markManagedExecution(
	input: { endpoint: MutationEndpoint; run: Run; locked: Ownership },
	services: Services,
): Promise<void> {
	const { endpoint, run, locked } = input;
	if (run.managedExecution === "managed") {
		return;
	}
	await patchOwned(
		{
			endpoint,
			locked,
			patch: (saved) => {
				saved.managedExecution = "managed";
			},
		},
		services,
	);
	run.managedExecution = "managed";
}
