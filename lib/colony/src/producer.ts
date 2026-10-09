import type { BeesConfig, Recipe, RepositoryEndpoint } from "@hive/shared";
import { RequestPublicationError, publishRequestLabels } from "./requests.ts";
import type { RetryOptions, SpawnOptions } from "./bee-cli.ts";
import {
	SPAWN_REQUEST_LABELS,
	beadSchema,
	beads,
	canonicalRoot,
	parseBeesConfig,
	readSpawnRequest,
	recipeSchema,
	requestNeedsAttention,
	resolveRepository,
	showBead,
	spawnRequestLabels,
} from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Canonical config and submission cwd paths.
import { join, resolve } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Exclusive configuration creation and execution directory validation.
import { mkdir, open, realpath, stat } from "node:fs/promises";
import type { InitOptions } from "./cli.ts";
import { createIdentity } from "./identity.ts";
import { loadBeesConfig } from "./config.ts";
import { z } from "zod";

const NONE = 0;

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
export async function spawnRequest(
	kind: string,
	requestedIds: string[],
	options: SpawnOptions,
): Promise<SpawnResult> {
	const endpoint = await resolveRepository(options.repo, options.beadsDb);
	return createRequest(endpoint, { kind, requestedIds }, options);
}

/** Replace a terminal failure using current defaults and unfinished work only. */
// eslint-disable-next-line max-statements -- Keep admission, replacement creation and predecessor publication ordered at the command boundary.
export async function retryRequest(id: string, options: RetryOptions): Promise<SpawnResult> {
	const endpoint = await resolveRepository(options.repo, options.beadsDb);
	const bead = await showBead(endpoint, options.actor, id);
	const old = readSpawnRequest(bead);
	if (!requestNeedsAttention(bead)) {
		await publishRequestLabels(endpoint, options.actor, old.id);
		throw new Error(`Request ${old.id} is not an unresolved unsuccessful request`);
	}
	const tasks = await Promise.all(
		old.taskIds.map((taskId) => showBead(endpoint, options.actor, taskId)),
	);
	const ids = tasks.filter((task) => task.status !== "closed").map((task) => task.id);
	if (ids.length === NONE) {
		throw new Error(`Request ${old.id} has no unfinished tasks`);
	}
	const replacement = await createRequest(
		endpoint,
		{ kind: options.kind ?? old.recipe.kind, requestedIds: ids, supersedes: old.id },
		options,
	);
	try {
		await publishRequestLabels(endpoint, options.actor, old.id);
	} catch (error) {
		throw new RequestPublicationError(
			{ replacementIds: [replacement.request.id], requestId: old.id },
			error,
		);
	}
	return replacement;
}

// --- Private functions ---
// eslint-disable-next-line max-statements -- Admission, recipe capture and provenance form one native submission boundary.
async function createRequest(
	endpoint: RepositoryEndpoint,
	input: { kind: string; requestedIds: string[]; supersedes?: string },
	options: SpawnOptions,
): Promise<SpawnResult> {
	const { kind, requestedIds, supersedes } = input;
	const { config } = await loadBeesConfig(endpoint.root);
	const ids = await admitTasks(endpoint, { actor: options.actor, ids: requestedIds }, config);
	const recipe = await captureRecipe({ kind, options }, config);
	const identity = createIdentity();
	const dependencies = ids.map((id) => `related:${id}`);
	if (supersedes !== undefined) {
		dependencies.push(`supersedes:${supersedes}`);
	}
	const created = await beads(endpoint, options.actor, [
		"create",
		"--title",
		`Bee ${kind}: ${ids.join(", ")}`,
		"--owner",
		config.owner,
		"--assignee",
		identity,
		"--labels",
		spawnRequestLabels(kind).join(","),
		"--description",
		JSON.stringify(recipe),
		"--deps",
		dependencies.join(","),
	]);
	return {
		kind: "spawn_created",
		request: z.looseObject({ assignee: z.string(), id: z.string() }).parse(created),
	};
}

function initialConfig(options: InitOptions): string {
	return `owner = ${JSON.stringify(options.owner)}
humans = [${JSON.stringify(options.owner)}]
ranking = "bv-pagerank"
max_retries = 3
retry_delay_ms = 250

[limits]
colony = 4
kind = 2
worktree = 2

[kinds.worker]
description = "Implement the linked task beads and verify their outcomes."
harness = "codex"
model = ${JSON.stringify(options.model)}
effort = "low"
system_prompt = '''
Work on the related task beads.

- Read their full instructions.
- Claim only your work.
- Verify outcomes and close completed tasks.
'''

[formulas.codex]
executable = "codex"
headless = ["exec", "--json", "--sandbox", "workspace-write"]
argv = ["-m", "{{model}}", "-c", 'model_reasoning_effort="{{effort}}"', "-c", 'shell_environment_policy.inherit="all"', "{{#if system_prompt}}-c{{/if}}", '{{#if system_prompt}}developer_instructions={{json system_prompt}}{{/if}}', "--", "{{prompt}}"]
`;
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
	let cwd: string | null = null; // eslint-disable-line unicorn/no-null -- Null explicitly captures canonical-default execution.
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
// eslint-disable-next-line max-statements -- Validate human reservations and task-scoped duplicate candidates before submission.
async function admitTasks(
	endpoint: RepositoryEndpoint,
	{ ids, actor }: { ids: string[]; actor: string },
	config: BeesConfig,
): Promise<string[]> {
	const tasks = await Promise.all(ids.map((id) => showBead(endpoint, actor, id)));
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
		const listing = z
			.object({ issues: z.array(beadSchema) })
			.parse(
				await beads(endpoint, actor, [
					"list",
					"--status",
					"open",
					...SPAWN_REQUEST_LABELS.flatMap((label) => ["--label", label]),
					...[...requestIds].flatMap((id) => ["--id", id]),
					"--limit",
					"0",
				]),
			);
		const duplicate = listing.issues.at(NONE);
		if (duplicate) {
			throw new Error(`Open spawn ${duplicate.id} already requests one of these tasks`);
		}
	}
	return tasks.map((task) => task.id);
}
