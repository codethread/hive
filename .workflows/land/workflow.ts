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
						"Verify the recorded request is an actual user instruction to finish " +
						'and land this scope. An early "land it" authorizes remaining agreed ' +
						"implementation, not skipping gates or widening scope. Workflow " +
						"creation, conversion, a PR URL and test traversal are not " +
						"authorization; if absent, leave this task open and ask. Inspect task " +
						"acceptance/notes, git status and the complete diff, branch/base and " +
						"any PR via gh. Verify the target belongs to this repository, " +
						"canonicalRoot survives cleanup and beadsDb is the selected permanent " +
						"tracker endpoint. Respect claims and other agents' edits; resolve " +
						"tracker conflicts before proceeding.\n\nChoose implement for " +
						"unfinished acceptance, known defects or unresolved review findings; " +
						"check for completed work without a current passing `bun run check`; " +
						"review only when that gate passes but local review evidence is " +
						"missing or stale. Choose commit for current checked and approved " +
						"content that still needs committing, supplying its review receipt. " +
						"Choose reviewed only for clean committed work with current checks " +
						"and an approved local-review receipt read from br show on the " +
						"relevant bead. A closed review bead, an old approval or a GitHub " +
						"approval alone is not that evidence: match base and cumulative diff, " +
						"including staged/unstaged/relevant untracked files, and verify " +
						"finding dispositions. With no adequate evidence, use check or review " +
						"rather than guessing. Choose integrated only after proving this " +
						"exact work already reached the intended main; verification and " +
						"cleanup still remain. Record a concise assessment and deliverable pointers in this bead's comments " +
						"before closure. Later uncertainty or changed scope can return here; " +
						"external blockers leave the current task open, not a polling loop.\n\n" +
						`${retainedContext(context)}`,
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
						"Implement the remaining agreed acceptance or the verified findings " +
						"in the preceding evidence. Read the relevant task beads, surrounding " +
						"code and repository instructions; use required librarian " +
						"consultations. Make the smallest coherent change, add meaningful " +
						"regression coverage, update truthful docs and preserve unrelated " +
						"work. For PR feedback retain thread URLs and explain which fix " +
						"addresses each finding. Do not silently expand scope; ask for a " +
						"decision if the requested fix changes the plan. This step also " +
						"handles CI failures and merge-conflict repairs. Record changes, " +
						"outstanding constraints and focused verification on this bead. " +
						"Choose next when implementation is ready for full checks, or " +
						"retriage if the target/scope assumption changed. An unresolved " +
						`external blocker keeps this task open.\n\n${retainedContext(context)}`,
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
						"documentation truthful. Run `bun run check` for the complete change; " +
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
						"Commit scoped changes as coherent conventional commits without " +
						"bypassing hooks; if already committed, verify there is nothing to " +
						"commit. Record final source commits and their relation to the " +
						"reviewed diff in bead comments for integration verification, retaining " +
						"originally expected commits. A commit alone does not change the " +
						"reviewed content; hook edits, conflict resolution or other content " +
						"changes do. Choose changed for those changes so checks and local " +
						"review run again. Choose next only when the tree is clean and the " +
						"committed content matches the approved review receipt. Failed hooks " +
						"or unrelated dirty work block completion; preserve other agents' " +
						`work.\n\n${retainedContext(context)}`,
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
						"Use gh to inspect this PR's actual base/head, draft/open/merged " +
						"state, CI, review decisions and unresolved review threads as well as " +
						"conversation comments. Publish only the authorized reviewed branch " +
						"commits if the PR needs updating; never force-push or rewrite " +
						"others' work. Confirm the remote head matches the local reviewed " +
						"content and current base; stale checks go to check, missing/stale " +
						"local approval goes to review after passing checks. Check the " +
						"referenced Beads review receipt, not just the PR review status. Read " +
						"newly arrived feedback before deciding readiness. Choose feedback " +
						"for comments needing verification/disposition; changes for a " +
						"diagnosed CI failure or conflict needing implementation; integrated " +
						"if this exact PR has already merged. A closed-unmerged PR or changed " +
						"target needs retriage and a user decision, not automatic " +
						"reopening.\n\nChoose ready only for the intended non-draft open PR " +
						"with current local approval, passing required checks, required " +
						"GitHub approvals and no blocking unresolved threads. No configured " +
						"reviews/checks means no invented requirement. Pending CI, approval, " +
						"queue progress or an unresolved disagreement keeps this task open " +
						"with the blocker and next action. Re-fetch when resumed; do not poll " +
						"by repeatedly closing/recreating tasks. After fixes, link commits " +
						"and verification on the original threads. A rebuttal is a response, " +
						"not permission to dismiss a requested change or mark somebody else's " +
						`thread resolved.\n\n${retainedContext(context)}`,
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
						"Read the actual PR comments and linked code; verify each claim " +
						"against the current revision, reproduce it when useful and record " +
						"thread URLs, evidence and disposition. Batch the small set of " +
						"outstanding comments rather than making a workflow task per comment. " +
						"For a valid actionable defect choose changes with a precise repair " +
						"brief; implementation, checks and local review must run again before " +
						"readiness. For an unsupported claim, post a concise evidence-backed " +
						"rebuttal or clarification on that PR and choose rebutted. Choose " +
						"addressed for already-fixed/outdated/informational comments only " +
						"after explaining the disposition on the PR where useful. Mixed " +
						"feedback may include replies now but any remaining valid defect " +
						"takes changes. Never declare a thread resolved merely because you " +
						"disagree. An ambiguous product decision or contested blocker stays " +
						"open for the user/reviewer; retriage only when scope/target needs " +
						"reassessment. Record concise reply links and unresolved items in native bead " +
						"comments. Both non-code outcomes return to fresh PR readiness, not " +
						`directly to merge.\n\n${retainedContext(context)}`,
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
						"Reconfirm explicit authorization, unchanged reviewed content and " +
						"landing coordination immediately before integration. Retain " +
						"canonicalRoot, beadsDb, run/task IDs, source commits, review receipt " +
						"and integration evidence outside the feature checkout. Preserve " +
						"unpublished tracker data. Recheck base/head, checks and review " +
						"freshness; new content or a moved base requires retriage, diagnosed " +
						"defects/conflicts require changes, and new PR feedback requires " +
						"feedback. Never integrate tracker/state.\n\nFor a worktree target, run " +
						"honeycomb -h and follow its configured finish policy; do not bypass " +
						"a refusal with raw merging. For a PR target, re-fetch readiness and " +
						"merge via gh using the repository's configured strategy/queue and an " +
						"expected-head check. Never use admin bypass. An enqueued/auto-merge " +
						"request is not completed integration: keep this task open until " +
						"GitHub confirms the actual merge commit. If the work already " +
						"integrated, verify that result instead of merging twice. Record the " +
						"actual integration commit and source-to-integrated correspondence, " +
						"including concise squash/rebase evidence, in bead comments. Close with next " +
						"only once integration is proven. Refusals and external blockers stay " +
						"open with diagnostics.\n\nIf the feature checkout disappears, deliver " +
						"the saved stage result from the surviving canonical checkout with retained " +
						"BEADS_DB using the installed busybee or bun run --silent busybee. " +
						"The same named land definition must exist unchanged there; " +
						"changed-definition resumption is unsupported. Verify that " +
						"availability before an operation that removes the source checkout.\n\n" +
						`${retainedContext(context)}`,
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
						"From the surviving canonical checkout and retained tracker endpoint, " +
						"fetch and verify clean synchronized main contains the intended " +
						"change. Use recorded source commits, final commit evidence and the " +
						"actual integration commit; squash/rebase landing requires content/PR " +
						"correspondence, not ancestry of source SHAs. Run `bun run check` on " +
						"the integrated result. A defect after integration is not permission " +
						"to rewrite main: keep this task open, record it and agree a forward " +
						"fix or revert.\n\nVerify Honeycomb feature cleanup; if it remains " +
						"after PR merge or a finish policy retains it, use honeycomb remove " +
						"with integration proof (including --integrated-into origin/main for " +
						"squash merges) rather than finishing again or force-deleting. If " +
						"already removed, verify that fact. Preserve the permanent tracker " +
						"checkout/branch, unrelated worktrees and others' dirty files. " +
						"Missing work, failed checks, dirty canonical state or incomplete " +
						"intended cleanup blocks closure. Record commands, integration and " +
						`cleanup evidence before next.\n\n${retainedContext(context)}`,
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
						"Hive services and follow their documented deliberate restart " +
						"procedure when needed. Coordinate restarts that affect active work; " +
						"record any deferred restart and its owner without claiming the " +
						"running service was refreshed.\n\nA failed dependency install, build, " +
						"installation or smoke check keeps this task open with diagnostics " +
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
						"From a surviving configured code checkout retain beadsDb via " +
						"BEADS_DB or native --db. Record integration commits, review receipt, " +
						"passing checks, local build/install verification, cleanup and per-task " +
						"acceptance evidence in comments " +
						"on this stage, the run and the authorized completedTasks. Identify " +
						"which task closures are proven and any tasks that must remain open. " +
						"The structural parent does not expand completedTasks; broader parents " +
						"with unrelated children or unfinished acceptance remain open. " +
						"Keep external tasks open until Busy Bee reports this run done. " +
						"Updates and stage handoffs stay local; final publication belongs to " +
						"the caller afterward. Verify this evidence in the selected tracker " +
						"and canonical main is clean and synchronized. A refused evidence " +
						`update keeps this task open.\n\n${retainedContext(context)}`,
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
						"Record what landed, integration/source commits, review receipt, " +
						"verification, local update, cleanup and unresolved work in comments on this stage " +
						"and the run. State which authorized tasks are proven complete; task " +
						"closure and final publication remain the caller's post-done work. " +
						"Distinguish simulated traversal from actual integration. Validate " +
						"and save the next outcome with busybee record-result before closing " +
						"this stage. A Bee-dispatched stage worker reports its own completion " +
						"and leaves collection to the driver; it neither navigates nor closes " +
						"the run. The standalone caller or Land driver collects the saved result; " +
						"Busy Bee then closes its run. The caller reads the retained run " +
						"brief and comments to perform the post-done tail and final report.\n\n" +
						`${retainedContext(context)}`,
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
Stage delivery: comment with evidence, record-result, then close only the assigned visit.
The caller/driver collects; Bee-dispatched stage workers leave navigation and run closure to the driver and Busy Bee.
Local review receipt: ${JSON.stringify(context.review ?? "No current approval")}
Previous assessment (full evidence remains on preceding task beads): ${context.evidence}`;
}

function targetTitle(input: LandingInput): string {
	if (input.target.kind === "worktree") {
		return `worktree ${input.target.branch}`;
	}
	return `PR ${input.target.url}`;
}
