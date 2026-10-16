import { assign, setup } from "xstate";
import { z } from "zod";

const text = z.string().trim().nonempty();
const callerCompletion =
	"Post-done tail owner: the standalone Land caller or Land driver carrying the " +
	"same explicit user authorization. After Busy Bee reports status done, " +
	"inspect the retained run evidence and close only proven completedTasks " +
	"bottom-up, after their child work and workflows finish. Leave broader " +
	"parents open when unrelated children or acceptance remain; structural " +
	"containment grants no closure permission. Then publish once with " +
	"bun run beads:sync from the retained canonical checkout and BEADS_DB. " +
	"Verify the accepted tracker/state snapshot includes task and workflow " +
	"completion, then report closure/publication evidence and bee finish success " +
	"where applicable. Bee-dispatched stage workers do not perform this tail. " +
	"Generic driver success requires only its run anchor done. If post-done " +
	"closure or publication fails, inspect actual effects, record the exact " +
	"unfinished external task/operation, blocker and next action on the run and " +
	"unfinished scope beads, then report the blocked handoff (bee finish blocked " +
	"--reason where applicable). The completed run stays done; neither reopen " +
	"or replace it nor rely on bee retry of its closed anchor. On tracker conflict " +
	"stop tracker work and follow documented recovery without forcing claims or publication.";
const evidenceSchema = z.object({
	evidence: text.describe(
		"Observed result, supporting commands/links and the next task's " +
			"brief. Also record this on the worker bead before closing it.",
	),
});
const reviewedSchema = evidenceSchema.extend({
	review: z.object({
		bead: text.describe("Bead holding an approved local review and resolved findings."),
		base: text.describe("Reviewed base commit."),
		revision: text.describe(
			"Reviewed cumulative diff fingerprint, including relevant uncommitted files; compare it with the current change.",
		),
	}),
});

const targetSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("worktree"), branch: text }),
	z.object({ kind: z.literal("pr"), url: z.url() }),
]);

export const inputSchema = z.object({
	beadsDb: text.describe("Selected permanent BEADS_DB endpoint retained through cleanup."),
	canonicalRoot: text.describe("Surviving canonical checkout root."),
	completedTasks: z
		.array(text)
		.describe(
			"Only task IDs authorized for caller closure after the run is done; containment grants no closure permission.",
		),
	expectedCommits: z
		.array(text)
		.describe("Known commits, or [] for unfinished work. Record final commits before integration."),
	request: text.describe(
		"Actual explicit user request to finish and land the agreed scope, with its conversation reference.",
	),
	target: targetSchema.describe(
		"Worktree branch or existing GitHub PR to inspect, not a claim of readiness.",
	),
});

export const commandSchemas = {
	next: evidenceSchema,
	implement: evidenceSchema,
	check: evidenceSchema,
	review: evidenceSchema,
	reviewed: reviewedSchema,
	commit: reviewedSchema,
	integrated: evidenceSchema,
	passed: evidenceSchema,
	changes: evidenceSchema,
	approved: reviewedSchema,
	changed: evidenceSchema,
	ready: evidenceSchema,
	feedback: evidenceSchema,
	rebutted: evidenceSchema,
	addressed: evidenceSchema,
	retriage: evidenceSchema,
};

type LandingInput = z.infer<typeof inputSchema>;
interface LandingContext extends LandingInput {
	/** Latest worker result carried into the next visit's frozen brief. */
	evidence: string;
	/** Local approval receipt; external freshness is checked by the worker. */
	review: z.infer<typeof reviewedSchema>["review"] | undefined;
}
interface LandingEvent {
	/** Literal chart outcome selected by the worker. */
	type:
		| "NEXT"
		| "IMPLEMENT"
		| "CHECK"
		| "REVIEW"
		| "REVIEWED"
		| "COMMIT"
		| "INTEGRATED"
		| "PASSED"
		| "CHANGES"
		| "APPROVED"
		| "CHANGED"
		| "READY"
		| "FEEDBACK"
		| "REBUTTED"
		| "ADDRESSED"
		| "RETRIAGE";
	/** Busy Bee validates payloads at submission; actions consume that result. */
	data: unknown;
}

export function runBrief(input: LandingInput): { description: string; title: string } {
	return {
		description:
			"Finish and land the agreed scope only after verifying this explicit " +
			`user request: ${input.request}. Target: ` +
			`${JSON.stringify(input.target)}. Retain canonical checkout ` +
			`${input.canonicalRoot} and selected tracker ` +
			`${input.beadsDb}. Authorized completedTasks: ` +
			`${input.completedTasks.join(", ") || "No task closures requested"}. ` +
			"Record final integration, acceptance, checks, local update and cleanup evidence in this " +
			"run's comments before its final visit closes; retain the source commits " +
			"and review receipt there too. Starting this workflow is not authorization " +
			`to land.\n\n${callerCompletion}`,
		title: `Land ${targetTitle(input)}`,
	};
}

// Task instructions stay inline for Stately; the helper only formats shared runtime context.
export const machine = setup({
	actions: {
		recordEvidence: assign(({ event }) => ({
			evidence: evidenceSchema.parse(event.data).evidence,
		})),
		recordReview: assign(({ event }) => reviewedSchema.parse(event.data)),
		clearReview: assign({ review: undefined }),
	},
	guards: { isPr: ({ context }) => context.target.kind === "pr" },
	types: {
		context: {} as LandingContext,
		events: {} as LandingEvent,
		input: {} as LandingInput,
	},
}).createMachine({
	context: ({ input }) => ({ ...input, evidence: "No triage performed yet.", review: undefined }),
	id: "land",
	initial: "triage",
	states: {
		triage: {
			entry: "clearReview",
			meta: {
				title: "Triage the authorized landing",
				commands: {
					implement: "IMPLEMENT",
					check: "CHECK",
					review: "REVIEW",
					reviewed: "REVIEWED",
					commit: "COMMIT",
					integrated: "INTEGRATED",
				},
				task: ({ context }: { context: LandingContext }) => ({
					title: `Triage the authorized landing: ${targetTitle(context)}`,
					instructions:
						"Verify input.request is an explicit user instruction to land this scope. An early request " +
						"includes unfinished agreed implementation; workflow creation or a PR URL alone grants no " +
						"authority. Inspect acceptance, Git status/diff, base/head and any PR. Verify the target " +
						"repository, surviving canonicalRoot and permanent beadsDb. Preserve claims and unrelated edits. " +
						"Choose implement for unfinished acceptance or findings; check when full checks are " +
						"missing/stale; review when checks pass but local approval is absent/stale; commit for checked, " +
						"approved uncommitted content; reviewed for clean committed content with a current local review " +
						"receipt; integrated only with proof this exact change reached main. Verify review receipts " +
						"against the base and cumulative diff, including relevant uncommitted files, and resolved " +
						"findings. A closed review or GitHub approval alone is insufficient. Record the assessment and " +
						"pointers in comments. External blockers keep this task open; changed scope returns to triage. " +
						`\n\n${retainedContext(context)}`,
				}),
			},
			on: {
				IMPLEMENT: { actions: "recordEvidence", target: "implement" },
				CHECK: { actions: "recordEvidence", target: "check" },
				REVIEW: { actions: "recordEvidence", target: "review" },
				REVIEWED: { actions: "recordReview", target: "route" },
				COMMIT: { actions: "recordReview", target: "commit" },
				INTEGRATED: { actions: "recordEvidence", target: "verify" },
			},
		},
		implement: {
			entry: "clearReview",
			meta: {
				title: "Complete implementation or repair findings",
				commands: { next: "NEXT", retriage: "RETRIAGE" },
				task: ({ context }: { context: LandingContext }) => ({
					title: `Complete implementation or repair findings: ${targetTitle(context)}`,
					instructions:
						"Complete the agreed acceptance or verified findings, including CI/conflict repairs. Follow " +
						"repository implementation and consultation rules. Preserve unrelated work; scope changes need a " +
						"user decision. For PR feedback retain thread URLs and map fixes to findings. Record changes, " +
						"constraints and focused verification. Choose next when ready for full checks, retriage if " +
						"target/scope changed, or leave the task open with an external blocker and next action. " +
						`\n\n${retainedContext(context)}`,
				}),
			},
			on: {
				NEXT: { actions: "recordEvidence", target: "check" },
				RETRIAGE: { actions: "recordEvidence", target: "triage" },
			},
		},
		check: {
			entry: "clearReview",
			meta: {
				title: "Tidy and check the complete change",
				commands: { passed: "PASSED", changes: "CHANGES" },
				task: ({ context }: { context: LandingContext }) => ({
					title: `Tidy and check the complete change: ${targetTitle(context)}`,
					instructions:
						"Remove only this work's scratch/debug/generated leftovers and dead " +
						"code; inspect git status and the cumulative diff for secrets, local " +
						"configuration and unintended files. Keep the diff scoped and " +
						"documentation truthful. Have bookworm write/review changed prose, including embedded prompts " +
						"and help, using docs/agents/specialists.md for the context handoff. Retain its coverage and " +
						"edits in the review evidence; reuse a completed pass only while its scope and content remain " +
						"current. Run `bun run check` for the complete change; " +
						"its full suite prints the complete timing report and fails on " +
						"unapproved DANGER. Return timing failures through changes with a " +
						"concrete brief to refactor meaningful tests, setup or dependency " +
						"seams using relevant skills while preserving coverage. If the " +
						"measured cost is necessary, keep this task open and propose the " +
						"exact lib/tooling/slow-tests.json allowance and justification for " +
						"explicit user sign-off before editing it; landing remains blocked " +
						"until checks pass. Record the exact base/revision, commands and " +
						"results concisely in bead comments. Choose passed only when `bun run check` exits " +
						"successfully for that revision; choose changes with a concrete " +
						"repair brief for code failures. A known infrastructure failure keeps " +
						"the task open with a next action rather than inventing a code fix. " +
						`Any modifications invalidate prior review evidence.\n\n${retainedContext(context)}`,
				}),
			},
			on: {
				PASSED: { actions: "recordEvidence", target: "review" },
				CHANGES: { actions: "recordEvidence", target: "implement" },
			},
		},
		review: {
			entry: "clearReview",
			meta: {
				title: "Review the current change locally",
				commands: { approved: "APPROVED", changes: "CHANGES" },
				task: ({ context }: { context: LandingContext }) => ({
					title: `Review the current change locally: ${targetTitle(context)}`,
					instructions:
						"Run a local code review of the complete change against its task " +
						"acceptance and repository standards, using the required reviewer " +
						"consultation only after `bun run check` passes for this revision. " +
						"The landing worker owns check execution and its evidence; the " +
						"reviewer assesses code and test quality without rerunning checks or " +
						"auditing test-run evidence. Include staged, unstaged and relevant " +
						"untracked files, not just committed changes. Inspect previous " +
						"findings and their fixes. Record base, cumulative diff fingerprint, " +
						"reviewer identity and concise dispositions with response-ID pointers in this worker bead's " +
						"comments (and link that evidence from the scope beads). A completed " +
						"review may request changes: close this review with changes and a " +
						"concrete repair brief so implementation can proceed. Choose approved " +
						"only with no unresolved findings, supplying this bead and the exact " +
						"reviewed base/revision as the receipt. Reviewers do not edit during " +
						`the review. Do not treat task closure as approval.\n\n${retainedContext(context)}`,
				}),
			},
			on: {
				APPROVED: { actions: "recordReview", target: "commit" },
				CHANGES: { actions: "recordEvidence", target: "implement" },
			},
		},
		commit: {
			meta: {
				title: "Commit the reviewed change",
				commands: { next: "NEXT", changed: "CHANGED" },
				task: ({ context }: { context: LandingContext }) => ({
					title: `Commit the reviewed change: ${targetTitle(context)}`,
					instructions:
						"Commit the scoped approved content using conventional commits and normal hooks. Record final " +
						"source commits alongside expectedCommits and their relation to the review receipt. Choose " +
						"changed if hooks, conflict repair or other edits alter reviewed content; choose next only for a " +
						"clean tree matching the approved receipt. Failed hooks or unrelated dirty work block completion. " +
						`\n\n${retainedContext(context)}`,
				}),
			},
			on: {
				NEXT: { actions: "recordEvidence", target: "route" },
				CHANGED: { actions: "recordEvidence", target: "check" },
			},
		},
		pr: {
			meta: {
				title: "Check PR readiness",
				commands: {
					ready: "READY",
					feedback: "FEEDBACK",
					changes: "CHANGES",
					check: "CHECK",
					review: "REVIEW",
					integrated: "INTEGRATED",
					retriage: "RETRIAGE",
				},
				task: ({ context }: { context: LandingContext }) => ({
					title: `Check PR readiness: ${targetTitle(context)}`,
					instructions:
						"Inspect the PR base/head, state, CI, approvals, unresolved threads and conversation comments " +
						"with gh. Publish authorized reviewed commits if needed without rewriting others' work. Match the " +
						"remote head and base to the local review receipt. Route stale checks to check, stale/missing " +
						"approval to review after checks, feedback to feedback, diagnosed failures/conflicts to changes, " +
						"and a proven merge to integrated. A closed-unmerged PR or changed target needs retriage and a " +
						"user decision. Choose ready only for the intended open non-draft PR with current local approval, " +
						"configured required checks/approvals and no blocking threads. Pending external conditions keep " +
						"this task open; reread on resume. Link fixes and verification to original threads. A rebuttal " +
						"does not resolve another reviewer's requested change. " +
						`\n\n${retainedContext(context)}`,
				}),
			},
			on: {
				READY: { actions: "recordEvidence", target: "finish" },
				FEEDBACK: { actions: "recordEvidence", target: "comments" },
				CHANGES: { actions: "recordEvidence", target: "implement" },
				CHECK: { actions: "recordEvidence", target: "check" },
				REVIEW: { actions: "recordEvidence", target: "review" },
				INTEGRATED: { actions: "recordEvidence", target: "verify" },
				RETRIAGE: { actions: "recordEvidence", target: "triage" },
			},
		},
		comments: {
			meta: {
				title: "Verify and act on PR feedback",
				commands: {
					changes: "CHANGES",
					rebutted: "REBUTTED",
					addressed: "ADDRESSED",
					retriage: "RETRIAGE",
				},
				task: ({ context }: { context: LandingContext }) => ({
					title: `Verify and act on PR feedback: ${targetTitle(context)}`,
					instructions:
						"Read outstanding PR comments and current code; verify claims and record thread URLs, evidence " +
						"and dispositions. Choose changes for any remaining actionable defect with a repair brief. " +
						"Otherwise reply with an evidenced rebuttal/clarification and choose rebutted, or explain an " +
						"already-fixed/outdated/informational disposition and choose addressed. Batch related comments. " +
						"Both non-code outcomes return to fresh readiness. Disagreement does not authorize resolving " +
						"another reviewer's thread; contested product decisions remain open. Use retriage when " +
						"target/scope changes. " +
						`\n\n${retainedContext(context)}`,
				}),
			},
			on: {
				CHANGES: { actions: "recordEvidence", target: "implement" },
				REBUTTED: { actions: "recordEvidence", target: "pr" },
				ADDRESSED: { actions: "recordEvidence", target: "pr" },
				RETRIAGE: { actions: "recordEvidence", target: "triage" },
			},
		},
		finish: {
			meta: {
				title: "Integrate the approved work",
				commands: { next: "NEXT", feedback: "FEEDBACK", changes: "CHANGES", retriage: "RETRIAGE" },
				task: ({ context }: { context: LandingContext }) => ({
					title: `Integrate the approved work: ${targetTitle(context)}`,
					instructions:
						"Reconfirm user authorization, reviewed content, current base/head, checks and landing " +
						"coordination. Retain canonicalRoot, beadsDb, source commits, review receipt and evidence outside " +
						"the feature checkout. Never integrate tracker/state. Changed content/base needs retriage, " +
						"defects/conflicts need changes, and new PR feedback needs feedback. For worktrees, read " +
						"honeycomb finish --help and follow its policy without bypassing refusals. For PRs, merge through " +
						"gh with the configured strategy/queue and expected-head check; no admin bypass. Wait for the " +
						"actual merge commit: enqueuing is not completion. If already integrated, verify instead of " +
						"repeating it. Record integration and source correspondence, including squash/rebase proof, " +
						"before next. Before removing the checkout, verify the same Land definition remains available in " +
						"canonicalRoot; deliver subsequent results there using the retained BEADS_DB. External blockers " +
						"remain open with diagnostics. " +
						`\n\n${retainedContext(context)}`,
				}),
			},
			on: {
				NEXT: { actions: "recordEvidence", target: "verify" },
				FEEDBACK: { guard: "isPr", actions: "recordEvidence", target: "comments" },
				CHANGES: { actions: "recordEvidence", target: "implement" },
				RETRIAGE: { actions: "recordEvidence", target: "triage" },
			},
		},
		verify: {
			meta: {
				title: "Verify integration and clean up the worktree",
				commands: { next: "NEXT" },
				task: ({ context }: { context: LandingContext }) => ({
					title: `Verify integration and clean up the worktree: ${targetTitle(context)}`,
					instructions:
						"From the retained canonical checkout/tracker, fetch and verify clean synchronized main contains " +
						"the change. Use recorded commits and content/PR correspondence for squash/rebase integration. " +
						"Run bun run check on the integrated result. A defect requires an agreed forward fix or revert; " +
						"leave this task open. Verify feature-worktree cleanup, using honeycomb remove --help with " +
						"integration proof if needed, including --integrated-into origin/main for squash merges. Preserve " +
						"the permanent tracker, unrelated worktrees and dirty files. Record integration/check/cleanup " +
						"proof before next; incomplete verification or cleanup blocks closure. " +
						`\n\n${retainedContext(context)}`,
				}),
			},
			on: {
				NEXT: { actions: "recordEvidence", target: "local-update" },
			},
		},
		"local-update": {
			meta: {
				title: "Build and update local tools",
				commands: { next: "NEXT" },
				task: ({ context }: { context: LandingContext }) => ({
					title: `Build and update local tools: ${targetTitle(context)}`,
					instructions:
						"From the retained canonicalRoot on clean synchronized main, record " +
						"the integrated HEAD being installed. Refresh dependencies with " +
						"`bun install --frozen-lockfile`, then run `bun run --filter '*' build` " +
						"for every workspace, not just changed packages. Only after the full " +
						"build succeeds, run `bun run --filter '*' install:bin` to replace " +
						"the installed executables in ~/.local/bin. Use the existing artifact " +
						"installer described in lib/tooling/README.md; it copies standalone " +
						"artifacts rather than linking commands to a disposable worktree. " +
						"Keep all Colony companion executables together. Do not run tracker " +
						"bootstrap or publish tracker state in this step.\n\nVerify every " +
						"installed artifact matches its fresh package dist/ build, is " +
						"executable, and resolves to that installation on the user's PATH " +
						"rather than an older shadowing command. Smoke-test the public CLIs " +
						"with their documented help/read-only commands, including Busy Bee " +
						"loading the land definition from the canonical checkout. Installation " +
						"updates future invocations, not running processes: inspect running " +
						"Hive services and coordinate deliberate refreshes with active work. " +
						"When Colony needs a refresh, read `colony daemon restart --help`, " +
						"then run `colony daemon restart --json` for the selected state/socket. " +
						"Retain its verified restarted result, or record a deliberate deferral " +
						"with its reason and owner without claiming the running service was " +
						"refreshed.\n\nA failed dependency install, build, installation, restart " +
						"or smoke check keeps this task open with diagnostics, confirmed effects " +
						"and the next action; do not continue after a failed command. Inspect " +
						"partial installation before retrying. A post-merge code defect needs " +
						"an agreed forward fix or revert, not edits to main. Choose next only " +
						"after all artifacts are built, installed and verified and canonical " +
						"main remains clean and synchronized. Record revision, commands, " +
						"installation paths, artifact comparisons, smoke results and service " +
						`restart disposition before closure.\n\n${retainedContext(context)}`,
				}),
			},
			on: {
				NEXT: { actions: "recordEvidence", target: "publish" },
			},
		},
		publish: {
			meta: {
				title: "Record landing completion evidence",
				commands: { next: "NEXT" },
				task: ({ context }: { context: LandingContext }) => ({
					title: `Record landing completion evidence: ${targetTitle(context)}`,
					instructions:
						"Record integration commits, review receipt, checks, local build/install, cleanup and per-task " +
						"acceptance in comments on this stage, the run and the authorized completedTasks. Verify the " +
						"saved evidence through retained beadsDb and clean synchronized canonical main. Identify proven " +
						"closures and work that must remain open; containment does not expand authorization. Keep " +
						"external tasks open until Busy Bee reports this run done. Follow the run brief for the caller's " +
						"later closure/publication. A refused evidence update keeps this task open. " +
						`\n\n${retainedContext(context)}`,
				}),
			},
			on: {
				NEXT: { actions: "recordEvidence", target: "report" },
			},
		},
		report: {
			meta: {
				title: "Deliver the landing report to the caller",
				commands: { next: "NEXT" },
				task: ({ context }: { context: LandingContext }) => ({
					title: `Deliver the landing report to the caller: ${targetTitle(context)}`,
					instructions:
						"Deliver a concise landing report citing the retained evidence: what landed, source/integration " +
						"commits, review, checks, local installation, cleanup and unresolved work. Distinguish simulation " +
						"from actual integration. The caller reads the retained run brief and comments to perform " +
						"the post-done tail and final report. " +
						`\n\n${retainedContext(context)}`,
				}),
			},
			on: {
				NEXT: { actions: "recordEvidence", target: "done" },
			},
		},
		route: { always: [{ guard: "isPr", target: "pr" }, { target: "finish" }] },
		done: { type: "final" },
	},
});

function retainedContext(context: LandingContext): string {
	return `Retained landing context:
User request: ${context.request}
Target: ${JSON.stringify(context.target)}
Canonical checkout: ${context.canonicalRoot}
Selected BEADS_DB: ${context.beadsDb}
Known starting commits: ${context.expectedCommits.join(", ") || "None yet; record final commits before integration"}
Authorized task scope: ${context.completedTasks.join(", ") || "No task closures requested"}
Local review receipt: ${JSON.stringify(context.review ?? "No current approval")}
Previous assessment (full evidence remains on preceding task beads): ${context.evidence}`;
}

function targetTitle(input: LandingInput): string {
	if (input.target.kind === "worktree") {
		return `worktree ${input.target.branch}`;
	}
	return `PR ${input.target.url}`;
}
