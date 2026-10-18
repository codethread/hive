/* eslint-disable import/max-dependencies --
 * Submission composes tracker admission, configuration and native recipe capture.
 */
import type { BeesConfig, Recipe, WorkflowAssignment } from "@hive/shared";
import { RequestPublicationError, publishRequestLabels } from "./requests.ts";
import type { RetryOptions, SpawnOptions } from "./bee-cli.ts";
import {
	SPAWN_REQUEST_LABELS,
	canonicalRoot,
	parseBeesConfig,
	readSpawnRequest,
	recipeSchema,
	requestNeedsAttention,
	requestOutcome,
	requestResolution,
	spawnRequestLabels,
} from "@hive/shared";
import type { TrackerCommands, TrackerContext } from "./tracker.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Canonical config and submission cwd paths.
import { join, resolve } from "node:path";
/* eslint-disable-next-line import/no-nodejs-modules --
 * Exclusive configuration creation and execution directory validation.
 */
import { mkdir, open, realpath, stat } from "node:fs/promises";
import type { InitOptions } from "./initial-config.ts";
import { createIdentity } from "./identity.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Submission binds execution to the requesting machine.
import { hostname } from "node:os";
import { initialConfig } from "./initial-config.ts";
import type { loadBeesConfig } from "./config.ts";
import { trackerScope } from "./tracker.ts";

const NONE = 0;

export interface ProducerCommands extends TrackerCommands {
	/** Load the canonical submission policy and kinds at the command boundary. */
	loadBeesConfig: typeof loadBeesConfig;
}
interface ProducerContext extends TrackerContext {
	/** Current configuration captured before the request is created. */
	loadBeesConfig: typeof loadBeesConfig;
}

export interface InitializedResult {
	/** Canonical configuration created. */
	kind: "initialized";
	/** Configuration location. */
	path: string;
}
export interface SpawnResult {
	/** Native request creation completed. */
	kind: "spawn_created";
	/** Captured native request. */
	request: { id: string; assignee: string; [key: string]: unknown };
}
export async function initRepository(options: InitOptions): Promise<InitializedResult> {
	const directory = join(await canonicalRoot(options.repo), ".hive");
	const path = join(directory, "bees.toml");
	const content = initialConfig(options);
	parseBeesConfig(content);
	await mkdir(directory, { recursive: true });
	const file = await open(path, "wx");
	try {
		await file.writeFile(content);
	} finally {
		await file.close();
	}
	return { kind: "initialized", path };
}
/** Submit one existing run or Bee-dispatched visit without selecting or starting a workflow. */
export async function spawnWorkflowRequest(
	{
		kind,
		assignment,
		options,
	}: { kind: string; assignment: WorkflowAssignment; options: SpawnOptions },
	{ beads, resolveRepository, loadBeesConfig }: ProducerCommands,
): Promise<SpawnResult> {
	const endpoint = await resolveRepository(options.repo, options.beadsDb);
	let anchor = assignment.runId;
	if (assignment.kind === "stage") {
		anchor = assignment.stageId;
	}
	return createRequest(
		{ beads, repository: endpoint, loadBeesConfig },
		{ assignment, kind, requestedIds: [anchor] },
		options,
	);
}

/** Read-only admission precheck before a caller mutates an existing workflow handoff. */
export async function validateRequestedTasks(
	{ requestedIds, options }: { requestedIds: string[]; options: SpawnOptions },
	{ beads, resolveRepository, loadBeesConfig }: ProducerCommands,
): Promise<void> {
	const repository = await resolveRepository(options.repo, options.beadsDb);
	const { config } = await loadBeesConfig(repository.root);
	await admitTasks({ beads, repository }, { actor: options.actor, ids: requestedIds }, config);
}

/** Replace an unresolved failure or explicitly resume cancellation with current defaults. */
/* eslint-disable-next-line max-statements --
 * Keep admission, replacement creation and predecessor publication ordered at the
 * command boundary.
 */
export async function retryRequest(
	id: string,
	options: RetryOptions,
	{ beads, resolveRepository, loadBeesConfig }: ProducerCommands,
): Promise<SpawnResult> {
	const endpoint = await resolveRepository(options.repo, options.beadsDb);
	const bead = await beads.show(trackerScope(endpoint, options.actor), id);
	const old = readSpawnRequest(bead);
	const resumeCancelled =
		options.resumeCancelled === true &&
		requestOutcome(bead) === "cancelled" &&
		requestResolution(bead).kind === "resolved";
	if (!requestNeedsAttention(bead) && !resumeCancelled) {
		await publishRequestLabels({ beads, repository: endpoint }, options.actor, old.id);
		throw new Error(
			`Request ${old.id} is ineligible for replacement; read bee retry --help for failure and cancellation eligibility`,
		);
	}
	const tasks = await Promise.all(
		old.taskIds.map((taskId) => beads.show(trackerScope(endpoint, options.actor), taskId)),
	);
	const ids = tasks.filter((task) => task.status !== "closed").map((task) => task.id);
	if (ids.length === NONE) {
		throw new Error(`Request ${old.id} has no unfinished tasks`);
	}
	const replacement = await createRequest(
		{ beads, repository: endpoint, loadBeesConfig },
		{
			assignment: old.assignment,
			kind: options.kind ?? old.recipe.kind,
			requestedIds: ids,
			supersedes: old.id,
		},
		options,
	);
	try {
		await publishRequestLabels({ beads, repository: endpoint }, options.actor, old.id);
	} catch (error) {
		throw new RequestPublicationError(
			{ replacementIds: [replacement.request.id], requestId: old.id },
			error,
		);
	}
	return replacement;
}

// --- Private functions ---
/* eslint-disable-next-line max-statements --
 * Admission, recipe capture and provenance form one native submission boundary.
 */
async function createRequest(
	{ beads, repository: endpoint, loadBeesConfig }: ProducerContext,
	input: {
		assignment: WorkflowAssignment;
		kind: string;
		requestedIds: string[];
		supersedes?: string;
	},
	options: SpawnOptions,
): Promise<SpawnResult> {
	const { assignment, kind, requestedIds, supersedes } = input;
	const { config } = await loadBeesConfig(endpoint.root);
	const ids = await admitTasks(
		{ beads, repository: endpoint },
		{ actor: options.actor, ids: requestedIds },
		config,
	);
	const recipe = await captureRecipe({ kind, options }, config);
	const identity = createIdentity();
	const dependencies = ids.map((id) => ({ id, type: "related" }));
	if (supersedes !== undefined) {
		dependencies.push({ id: supersedes, type: "supersedes" });
	}
	const created = await beads.create(trackerScope(endpoint, options.actor), {
		title: `Bee ${kind}: ${ids.join(", ")}`,
		owner: config.owner,
		assignee: identity,
		labels: spawnRequestLabels(kind),
		description: JSON.stringify({ ...recipe, assignment, host: hostname() }),
		deps: dependencies,
	});
	return {
		kind: "spawn_created",
		request: { ...created, assignee: identity },
	};
}

// eslint-disable-next-line max-statements -- Snapshot the recipe and execution directory together at submission.
async function captureRecipe(
	input: { kind: string; options: SpawnOptions },
	config: BeesConfig,
): Promise<Recipe> {
	const { kind, options } = input;
	const defaults = config.kinds[kind];
	if (!defaults) {
		throw new Error(`Unknown bee kind ${kind}`);
	}
	let cwd: string | null = null; // eslint-disable-line unicorn/no-null -- Null captures canonical-default execution.
	if (options.cwd !== undefined) {
		cwd = await realpath(resolve(options.cwd));
		const info = await stat(cwd);
		if (!info.isDirectory()) {
			throw new Error(`Execution cwd is not a directory: ${cwd}`);
		}
	}
	return recipeSchema.parse({
		cwd,
		effort: options.effort ?? defaults.effort,
		harness: options.harness ?? defaults.harness,
		kind,
		model: options.model ?? defaults.model,
		prompt: options.prompt ?? defaults.prompt,
		system_prompt: options.systemPrompt ?? defaults.system_prompt,
	});
}
/* eslint-disable-next-line max-statements --
 * Validate human reservations and task-scoped duplicate candidates before submission.
 */
async function admitTasks(
	{ beads, repository: endpoint }: TrackerContext,
	{ ids, actor }: { ids: string[]; actor: string },
	config: BeesConfig,
): Promise<string[]> {
	const tasks = await Promise.all(ids.map((id) => beads.show(trackerScope(endpoint, actor), id)));
	const reserved = tasks.find(
		(task) =>
			task.status !== "closed" &&
			(task.labels.includes("hitl") ||
				task.assignee === config.owner ||
				(task.assignee !== undefined && config.humans.includes(task.assignee))),
	);
	if (reserved) {
		throw new Error(`Task ${reserved.id} is reserved for a human`);
	}
	// Incoming related edges identify possible requesters without hydrating unrelated requests.
	const requestIds = new Set(
		tasks.flatMap(({ dependents }) =>
			dependents.filter(({ dependency_type }) => dependency_type === "related").map(({ id }) => id),
		),
	);
	if (requestIds.size > NONE) {
		const listing = await beads.list(trackerScope(endpoint, actor), {
			status: ["open"],
			labels: SPAWN_REQUEST_LABELS,
			ids: [...requestIds],
			limit: 0,
		});
		const duplicate = listing.issues.at(NONE);
		if (duplicate) {
			throw new Error(`Open spawn ${duplicate.id} already requests one of these tasks`);
		}
	}
	return tasks.map((task) => task.id);
}
