/* eslint-disable import/no-nodejs-modules -- Workflow-local CLI composes filesystem and process boundaries. */
import { ReviewError, resolveScope, scopeRequestSchema } from "./scope.ts";
import { evidenceSchema, purposeSchema, selectDomains } from "./review.ts";
import { join, resolve } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import type { ReviewGit } from "./scope.ts";
import type { ReviewInput } from "./review.ts";
import type { RunView } from "../../lib/busybee/src/runtime.ts";
import { execute } from "@hive/shared";
import { liveReviewGit } from "./git.ts";
import { parseArgs } from "node:util";
import { startNamed } from "../../lib/busybee/src/runtime.ts";
import { tmpdir } from "node:os";
import { z } from "zod";

const ZERO = 0;
const ONE = 1;
const ARGUMENT_OFFSET = 2;
const requestSchema = z.object({
	scope: scopeRequestSchema,
	evidence: evidenceSchema,
	purpose: purposeSchema,
});
export type ReviewRequest = z.infer<typeof requestSchema>;
export interface SubmissionOptions {
	/** Workflow catalogue directory, relative to the caller. */
	repo?: string;
	/** Reviewed checkout or a directory inside it. */
	target?: string;
	/** Existing source task; required for publication. */
	parent?: string;
	/** Accountable human; required for publication. */
	owner?: string;
	/** Explicit mutation identity, otherwise the supplied environment identity. */
	actor?: string;
	/** Explicit tracker, otherwise preserve environment/discovery. */
	db?: string;
	/** Resolve the plan without publishing work. */
	"dry-run"?: boolean;
}
interface StartOptions {
	/** Workflow catalogue checkout, independent of reviewed files. */
	repo: string;
	/** Existing work containing the review. */
	parent: string;
	/** Accountable human. */
	owner: string;
	/** Native mutation identity. */
	actor: string;
	/** Optional explicit tracker; otherwise preserve BEADS_DB/discovery. */
	db?: string;
}
export interface SubmissionServices {
	/** Caller path base. */
	cwd: string;
	/** Process-local identity default. */
	actor: string | undefined;
	/** Read external request JSON. */
	readText: (path: string) => Promise<string>;
	/** Named Git operations bound to the target checkout. */
	git: (target: string) => ReviewGit;
	/** Start review without waiting for worker completion. */
	start: (input: ReviewInput, options: StartOptions) => Promise<RunView>;
	/** JSON response or requested help. */
	stdout: (text: string) => void;
}

// eslint-disable-next-line max-statements -- Keep CLI parsing, identity and publication in one boundary.
export async function runSubmission(argv: string[], services: SubmissionServices): Promise<number> {
	try {
		const { values } = parseArgs({
			args: argv,
			options: {
				"input-file": { type: "string" },
				repo: { type: "string" },
				target: { type: "string" },
				parent: { type: "string" },
				owner: { type: "string" },
				actor: { type: "string" },
				db: { type: "string" },
				"dry-run": { type: "boolean" },
				help: { type: "boolean" },
				json: { type: "boolean" },
			},
		});
		if (values.help) {
			services.stdout(
				"Usage: bun .workflows/review/submit.ts --input-file REQUEST.json " +
					"[--repo CATALOGUE] [--target CHECKOUT] --parent TASK --owner HUMAN [--actor ID] [--db PATH] [--dry-run]\n" +
					"Request JSON contains scope (files/worktree/commit/range), evidence and purpose (advisory/final-gate).\n" +
					"--repo selects the workflow catalogue; --target resolves to its containing Git checkout root.\n" +
					"Final worktree gates require an explicit base; all final gates require Spec and " +
					"prior Bookworm/Librarian provenance.\n" +
					"Dry-run resolves coverage without publication. Results/errors are JSON. Collect the " +
					"returned run to drive reviews.\n",
			);
			return ZERO;
		}
		if (!values["input-file"]) {
			throw new ReviewError("missing_input", "Supply --input-file REQUEST.json.");
		}
		const requestText = await services.readText(resolve(services.cwd, values["input-file"]));
		const request = requestSchema.parse(JSON.parse(requestText));
		write(services, await submitReview(request, values, services));
		return ZERO;
	} catch (error) {
		let reason: unknown = "submission_failed";
		let context: unknown = undefined;
		let message = String(error);
		if (error instanceof Error) {
			({ message } = error);
			if ("reason" in error) {
				({ reason } = error);
			}
			if ("context" in error) {
				({ context } = error);
			}
		}
		write(services, {
			ok: false,
			kind: "review_error",
			reason,
			message,
			context,
		});
		return ONE;
	}
}

/** Resolve a trusted typed request; runSubmission owns external CLI/JSON parsing. */
// eslint-disable-next-line max-statements -- Keep target resolution and publication policy together.
export async function submitReview(
	request: ReviewRequest,
	options: SubmissionOptions,
	services: SubmissionServices,
) {
	if (
		request.purpose.kind === "final-gate" &&
		request.scope.kind === "worktree" &&
		request.scope.base === undefined
	) {
		throw new ReviewError("missing_base", "Final worktree gates require an explicit base.");
	}
	const selectedDirectory = resolve(services.cwd, options.target ?? ".");
	const target = await services.git(selectedDirectory).root();
	const input: ReviewInput = {
		target,
		scope: await resolveScope(request.scope, services.git(target)),
		evidence: request.evidence,
		purpose: request.purpose,
	};
	if (options["dry-run"]) {
		return {
			ok: true as const,
			kind: "review_plan" as const,
			input,
			coverage: selectDomains(input.scope, input.purpose.spec !== undefined),
		};
	}
	const actor = options.actor ?? services.actor;
	if (!actor || !options.owner || !options.parent) {
		throw new ReviewError(
			"missing_identity",
			"Submission requires --parent, --owner and --actor or BD_ACTOR.",
		);
	}
	const startOptions: StartOptions = {
		repo: resolve(services.cwd, options.repo ?? "."),
		parent: options.parent,
		owner: options.owner,
		actor,
	};
	if (options.db !== undefined) {
		startOptions.db = resolve(services.cwd, options.db);
	}
	const run = await services.start(input, startOptions);
	return {
		ok: true as const,
		kind: "review_started" as const,
		id: run.id,
		status: run.status,
		active: run.active.map(({ bead, commands, path, request: requestId, title }) => ({
			bead,
			commands,
			path,
			request: requestId,
			title,
		})),
	};
}

// --- Private functions ---

function write(services: SubmissionServices, value: unknown): void {
	services.stdout(`${JSON.stringify(value)}\n`);
}

async function startReview(input: ReviewInput, options: StartOptions): Promise<RunView> {
	const directory = await mkdtemp(join(tmpdir(), "hive-domain-review-"));
	try {
		const inputFile = join(directory, "input.json");
		await Bun.write(inputFile, JSON.stringify(input));
		return await startNamed("review", { ...options, inputFile });
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

if (import.meta.main) {
	process.exitCode = await runSubmission(process.argv.slice(ARGUMENT_OFFSET), {
		cwd: process.cwd(),
		actor: process.env["BD_ACTOR"],
		readText: (path) => Bun.file(path).text(),
		git: (target) =>
			liveReviewGit(target, { execute: (argv, cwd) => execute(argv, cwd, process.env) }),
		start: startReview,
		stdout: (value) => {
			process.stdout.write(value);
		},
	});
}
