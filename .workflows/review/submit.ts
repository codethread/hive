/* eslint-disable import/no-nodejs-modules -- Workflow-local submission owns filesystem and process I/O. */
import { Command, CommanderError } from "commander";
import type { GitServices, ScopeRequest } from "./scope.ts";
import { ReviewError, resolveScope } from "./scope.ts";
import { join, resolve } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import type { ReviewInput } from "./workflow.ts";
import type { RunView } from "@hive/busybee";
import { execute } from "@hive/shared";
import { inputSchema } from "./workflow.ts";
import { selectReviews } from "./concerns.ts";
import { startNamed } from "@hive/busybee";
import { tmpdir } from "node:os";

const ZERO = 0;
const ONE = 1;
const JSON_INDENT = 2;
const USAGE_ERROR = 2;
interface StartOptions {
	/** Caller-selected checkout, also the reviewers' execution directory. */
	repo: string;
	/** Accountable human. */
	owner: string;
	/** Mutation attribution, supplied by flag or environment. */
	actor: string;
	/** Optional tracker override; native discovery otherwise applies. */
	db?: string;
}
export interface SubmissionServices extends GitServices {
	/** Invocation directory for relative options. */
	cwd: string;
	/** Process-local BD_ACTOR default. */
	actor: string | undefined;
	/** Catalogue and optional specification file I/O. */
	readText: (path: string) => Promise<string>;
	/** Start the named workflow with already-prepared input. */
	start: (input: ReviewInput, options: StartOptions) => Promise<RunView>;
	/** JSON results and help use stdout. */
	stdout: (text: string) => void;
}
interface Flags {
	/** Explicit scope selectors, exactly one required. */
	worktree?: boolean;
	commit?: string;
	range?: string;
	files?: string[];
	/** Optional file filters for a Git scope. */
	paths?: string[];
	/** Execution checkout; Git resolves its worktree root. */
	repo?: string;
	/** Mutation actor, otherwise BD_ACTOR. */
	actor?: string;
	/** Human accountable for the workflow run. */
	owner?: string;
	/** Independent native Beads endpoint override. */
	db?: string;
	/** Optional specification text file. */
	spec?: string;
	/** Resolve and show input without tracker writes or spawning. */
	dryRun?: boolean;
}

export async function runSubmission(argv: string[], services: SubmissionServices): Promise<number> {
	try {
		await program(services).parseAsync(argv, { from: "user" });
		return ZERO;
	} catch (error) {
		return reportFailure(error, services);
	}
}

// --- Private functions ---

function program(services: SubmissionServices): Command {
	return new Command()
		.name("review")
		.description(
			"Submit a deterministic, read-only Busy Bee review; the caller owns overlapping edits.",
		)
		.option("--worktree", "Review staged, unstaged and nonignored untracked changes against HEAD")
		.option(
			"--commit <ref>",
			"Review only the change introduced by HEAD or a commit; merges require --range",
		)
		.option(
			"--range <base..head>",
			"Compare endpoints; BASE...HEAD explicitly uses their merge base",
		)
		.option(
			"--files <glob...>",
			"Review full current contents of matching tracked/nonignored files",
		)
		.option("--paths <glob...>", "Filter a Git scope with repository-relative Bun globs")
		.option("--spec <file>", "Add a separate Spec review from this text file")
		.option("--repo <path>", "Execution checkout; defaults to current directory")
		.option("--db <path>", "Tracker override; otherwise native BEADS_DB/discovery")
		.option("--actor <identity>", "Mutation audit actor; otherwise BD_ACTOR")
		.option("--owner <human>", "Accountable human; required except for --dry-run")
		.option("--dry-run", "Print resolved scope and selected briefs; create no beads or requests")
		.option("--json", "Results and errors are always one stdout JSON document")
		.addHelpText(
			"after",
			"\nChoose exactly one scope. Quote globs to prevent shell expansion.\nAfter submission use busybee collect RUN to accept results and advance; show RUN is read-only.\nNo waiting, repairs, snapshots or concurrent-edit protection are performed.",
		)
		.configureOutput({ writeErr: () => {}, writeOut: services.stdout })
		.exitOverride()
		.action(async (flags: Flags) => {
			const { input, repo } = await prepareInput(flags, services);
			if (flags.dryRun) {
				write(services, { ok: true, kind: "review_plan", input });
				return;
			}
			const options = startOptions(flags, repo, services);
			write(services, {
				ok: true,
				kind: "review_started",
				...(await services.start(input, options)),
			});
		});
}

async function prepareInput(flags: Flags, services: SubmissionServices) {
	const request = requestedScope(flags);
	const directory = resolve(services.cwd, flags.repo ?? ".");
	const root = await services.execute(["git", "rev-parse", "--show-toplevel"], directory);
	const repo = root.trim();
	const scope = await resolveScope(request, repo, services);
	const catalogue = await services.readText(join(repo, ".agents/skills/code-review/concerns.toml"));
	// eslint-disable-next-line unicorn/no-useless-undefined -- init-declarations requires an explicit initial value.
	let spec: string | undefined = undefined;
	if (flags.spec !== undefined) {
		spec = await services.readText(resolve(services.cwd, flags.spec));
	}
	return { repo, input: inputSchema.parse({ scope, jobs: selectReviews(scope, catalogue, spec) }) };
}

// eslint-disable-next-line max-statements -- Keep exclusive raw CLI selectors together at their parsing boundary.
function requestedScope(flags: Flags): ScopeRequest {
	const selectors = [flags.worktree, flags.commit, flags.range, flags.files].filter(
		(value) => value !== undefined,
	);
	if (selectors.length !== ONE) {
		throw new ReviewError(
			"invalid_scope",
			"Choose exactly one of --worktree, --commit, --range or --files.",
		);
	}
	const patterns = flags.paths ?? [];
	if (flags.files) {
		if (patterns.length > ZERO) {
			throw new ReviewError("invalid_scope", "Use --files globs without --paths.");
		}
		return { kind: "files", patterns: flags.files };
	}
	if (flags.commit !== undefined) {
		return { kind: "commit", ref: flags.commit, patterns };
	}
	if (flags.range !== undefined) {
		return { kind: "range", range: flags.range, patterns };
	}
	return { kind: "worktree", patterns };
}

function startOptions(flags: Flags, repo: string, services: SubmissionServices): StartOptions {
	const actor = flags.actor ?? services.actor;
	if (!actor?.trim() || !flags.owner?.trim()) {
		throw new ReviewError(
			"missing_identity",
			"Submission requires --owner and --actor or BD_ACTOR; --dry-run needs neither.",
		);
	}
	const options: StartOptions = { actor, owner: flags.owner, repo };
	if (flags.db !== undefined) {
		options.db = resolve(services.cwd, flags.db);
	}
	return options;
}

// eslint-disable-next-line max-statements -- One CLI boundary preserves both usage errors and native Busy Bee failure context.
function reportFailure(error: unknown, services: SubmissionServices): number {
	if (error instanceof CommanderError && error.exitCode === ZERO) {
		return ZERO;
	}
	let reason = "execution_failed";
	let context: unknown = undefined;
	let code = ONE;
	let message = String(error);
	if (error instanceof Error) {
		({ message } = error);
	}
	if (error instanceof CommanderError) {
		reason = "usage";
		code = USAGE_ERROR;
	} else if (error instanceof Error && "reason" in error && typeof error.reason === "string") {
		({ reason } = error);
		if ("context" in error) {
			({ context } = error);
		}
	}
	write(services, { ok: false, kind: "review_error", reason, message, context });
	return code;
}

function write(services: SubmissionServices, value: unknown): void {
	services.stdout(`${JSON.stringify(value, undefined, JSON_INDENT)}\n`);
}

async function startReview(input: ReviewInput, options: StartOptions): Promise<RunView> {
	const directory = await mkdtemp(join(tmpdir(), "hive-review-"));
	try {
		const inputFile = join(directory, "input.json");
		await Bun.write(inputFile, JSON.stringify(input));
		return await startNamed("review", { ...options, inputFile });
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

if (import.meta.main) {
	process.exitCode = await runSubmission(process.argv.slice(USAGE_ERROR), {
		actor: process.env["BD_ACTOR"],
		cwd: process.cwd(),
		execute: (argv, cwd) => execute(argv, cwd, process.env),
		readText: (path) => Bun.file(path).text(),
		start: startReview,
		stdout: (value) => {
			process.stdout.write(value);
		},
	});
}
