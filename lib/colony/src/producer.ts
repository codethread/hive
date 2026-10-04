import type { BeesConfig, Recipe, RepositoryEndpoint } from "@hive/shared";
import {
	SPAWN_REQUEST_LABELS,
	beadSchema,
	beads,
	canonicalRoot,
	parseBeesConfig,
	recipeSchema,
	resolveRepository,
	showBead,
	spawnRequestLabels,
} from "@hive/shared";
import { adjectives, animals, colors, uniqueNamesGenerator } from "unique-names-generator";
// eslint-disable-next-line import/no-nodejs-modules -- Canonical config and submission cwd paths.
import { join, resolve } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Exclusive configuration creation and execution directory validation.
import { open, realpath, stat } from "node:fs/promises";
import type { InitOptions } from "./cli.ts";
import type { SpawnOptions } from "./bee-cli.ts";
import { z } from "zod";

const NAME_WORDS = 3;
const NONEMPTY = 1;

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
	const path = join(await canonicalRoot(options.repo), "bees.toml");
	const content = initialConfig(options);
	parseBeesConfig(content);
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
	const config = parseBeesConfig(await Bun.file(join(endpoint.root, "bees.toml")).text());
	const ids = await admitTasks(endpoint, { actor: options.actor, ids: requestedIds }, config);
	const recipe = await captureRecipe({ ids, kind, options }, config);
	const identity =
		options.identity ??
		uniqueNamesGenerator({
			dictionaries: [colors, adjectives, animals],
			length: NAME_WORDS,
			separator: "-",
		});
	z.string().min(NONEMPTY).parse(identity);
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
		ids.map((id) => `related:${id}`).join(","),
	]);
	return {
		kind: "spawn_created",
		request: z.looseObject({ assignee: z.string(), id: z.string() }).parse(created),
	};
}

// --- Private functions ---
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
harness = "codex"
model = ${JSON.stringify(options.model)}
effort = "low"
prompt = "Work on the related task beads. Read their full instructions, claim only your work, verify outcomes, and close completed tasks."

[formulas.codex]
executable = "codex"
argv = ["exec", "-m", "{{model}}", "-c", 'model_reasoning_effort="{{effort}}"', "-c", 'shell_environment_policy.inherit="all"', "--sandbox", "workspace-write", "--json", "{{prompt}}"]
`;
}
// eslint-disable-next-line max-statements -- Snapshot the recipe and execution directory together at submission.
async function captureRecipe(
	input: { kind: string; ids: string[]; options: SpawnOptions },
	config: BeesConfig,
): Promise<Recipe> {
	const { kind, ids, options } = input;
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
		prompt: `${options.prompt ?? defaults.prompt}\n\nRelated tasks: ${ids.join(", ")}`,
	});
}
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
	const listing = z
		.object({ issues: z.array(beadSchema) })
		.parse(
			await beads(endpoint, actor, [
				"list",
				"--status",
				"open",
				...SPAWN_REQUEST_LABELS.flatMap((label) => ["--label", label]),
				"--limit",
				"0",
			]),
		);
	const existing = await Promise.all(
		listing.issues.map((candidate) => showBead(endpoint, actor, candidate.id)),
	);
	const duplicate = existing.find((request) =>
		request.dependencies.some(
			(dep) => dep.dependency_type === "related" && tasks.some((task) => task.id === dep.id),
		),
	);
	if (duplicate) {
		throw new Error(`Open spawn ${duplicate.id} already requests one of these tasks`);
	}
	return tasks.map((task) => task.id);
}
