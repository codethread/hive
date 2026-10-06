import { setup } from "xstate";
import { z } from "zod";

export const inputSchema = z.object({
	beadsDb: z
		.string()
		.nonempty()
		.describe("Selected permanent BEADS_DB endpoint retained through cleanup."),
	canonicalRoot: z.string().nonempty().describe("Surviving canonical checkout root."),
	completedTasks: z
		.array(z.string().nonempty())
		.describe("Only the task IDs this landing is intended to complete."),
	expectedCommits: z
		.array(z.string().nonempty())
		.nonempty()
		.describe("Committed work to verify on canonical main."),
	request: z
		.string()
		.nonempty()
		.describe("Actual explicit user request to land, with its conversation reference."),
});

export const commandSchemas = { next: z.object({}) };

type LandingContext = z.infer<typeof inputSchema>;

export function runBrief(input: LandingContext): { description: string; title: string } {
	return {
		description: `Land the work only after verifying this explicit user request: ${input.request}. Retain canonical checkout ${input.canonicalRoot} and selected tracker ${input.beadsDb}. Starting this workflow is not authorization to land.`,
		title: "Land completed work",
	};
}

export const machine = setup({
	types: {
		context: {} as LandingContext,
		events: {} as { type: "NEXT" },
		input: {} as LandingContext,
	},
}).createMachine({
	context: ({ input }) => input,
	id: "land",
	initial: "prerequisites",
	states: {
		commit: {
			meta: landingTask(
				"Commit remaining changes",
				"Commit remaining scoped changes as coherent conventional commits. Never bypass hooks. Record the final commit list in task evidence for canonical-main verification; retain the originally expected commits too. Do not close this task if hooks fail or required work remains uncommitted.",
			),
			on: { NEXT: "finish" },
		},
		done: { type: "final" },
		finish: {
			meta: landingTask(
				"Land through Honeycomb",
				"Reconfirm the explicit authorization and coordinate code landing with other agents. Retain canonicalRoot, the selected beadsDb, run ID and task ID outside the feature checkout; preserve any older private database with unpublished state. Run honeycomb -h and follow its worktree landing guidance. Never fall back to raw merging when tooling refuses, conflicts, lacks a remote or sees a dirty tree. Never finish the permanent tracker/state checkout or merge its branch into main. Close this task only when Honeycomb landing and feature cleanup succeed. If the feature checkout disappears, use the surviving canonical checkout and the retained BEADS_DB to close and advance this task. Run the installed busybee or bun run --silent busybee from that surviving checkout; the same named land definition must be present unchanged. Changed-definition resumption is unsupported.",
			),
			on: { NEXT: "verify" },
		},
		prerequisites: {
			meta: landingTask(
				"Verify explicit landing authorization and prerequisites",
				"Verify the recorded request is an actual explicit user instruction to land this work. Workflow creation, conversion, a test traversal or an agent-authored request is not authorization. If authorization is absent, leave this task open and ask the user. Verify the plan's work is complete and committed, required librarian/reviewer consultations are done, and code landing is coordinated with other agents. Resolve outstanding tracker conflicts before proceeding. Verify canonicalRoot identifies the surviving canonical checkout, beadsDb is the currently selected permanent tracker endpoint, expectedCommits identifies the work, and completedTasks is the precise authorized task scope. Record evidence in native task notes. Leave this task open if any prerequisite fails; do not submit next.",
			),
			on: { NEXT: "tidy" },
		},
		prove: {
			meta: landingTask(
				"Prove the complete change",
				"Run required repository checks and appropriate tests under the repository's current instructions, fix every failure, and record commands and outcomes. Read the complete diff as an external reviewer; obtain a reviewer standards pass when warranted. Review the commit list for noise, unfinished messages and fixups. Failed checks or unresolved review findings leave this task open and block landing.",
			),
			on: { NEXT: "commit" },
		},
		publish: {
			meta: landingTask(
				"Publish completed task state",
				"From a surviving configured code checkout, preserve the selected beadsDb via BEADS_DB or native --db. Record landing evidence and close only the completedTasks whose acceptance is proven; leave unfinished or unrelated tasks open. Do not close this workflow run or grouping beads: Busy Bee owns them. Native br export is local, so run bun run beads:sync to publish the post-commit task updates. Publication is tracker-only, never main or feature code. Any refused flush, commit, reconciliation or push leaves this task open and landing incomplete. On record/claim conflict stop tracker work, retain local/remote evidence and resolve through the repository's documented human recovery; never force sync/push or overwrite a published claim. Verify the accepted tracker/state snapshot includes completed task evidence, and canonical main is clean and synchronized. Record publication evidence before closure.",
			),
			on: { NEXT: "report" },
		},
		report: {
			meta: landingTask(
				"Report landing and publish final bookkeeping",
				"Tell the user what landed, what was cleaned up, verification results, tracker publication evidence and anything unresolved. Done means canonical main contains the expected work with passing checks on a clean synchronized checkout, accepted tracker/state includes completed tasks, and no temporary, stray, generated or untracked leftovers remain. Distinguish simulated workflow traversal from actual landing. Close this task and submit next only after the report. The runner then closes its run; publish those final workflow bookkeeping updates with bun run beads:sync from the surviving checkout and retained endpoint. A refused final publication still requires resolution and must be reported as incomplete.",
			),
			on: { NEXT: "done" },
		},
		tidy: {
			meta: landingTask(
				"Tidy the completed work",
				"Remove scratch/temp files, throwaway fixtures/scripts, debug logs, commented experiments and *.tmp; revert edits made solely for testing or demonstration. Inspect git status and the complete diff for editor/OS junk, secrets, local configuration, build outputs, generated artifacts, large binaries and absolute local paths. Confirm .gitignore covers generated files. Remove dead code and unused imports, preserve others' work, keep the diff scoped, and make AGENTS.md, package guidance, docs and skills truthful. Record cleanup evidence; unresolved leftovers block closure.",
			),
			on: { NEXT: "prove" },
		},
		verify: {
			meta: landingTask(
				"Verify canonical main and cleanup",
				"Work from retained canonicalRoot with retained beadsDb, without depending on the removed feature checkout. Verify canonical main contains expectedCommits and the final commits recorded by the commit task, checks are green on a clean checkout, and Honeycomb feature cleanup succeeded. Verify the permanent tracker checkout and branch remain intact. Record actual commands, commit evidence and outcomes. Missing commits, failed checks, dirty state or incomplete cleanup block closure and tracker completion.",
			),
			on: { NEXT: "publish" },
		},
	},
});

// --- Private helpers ---

function landingTask(title: string, instructions: string) {
	return {
		commands: { next: "NEXT" },
		instructions,
		task: ({ context }: { context: LandingContext }) => ({
			instructions: `${instructions}

Retained landing context:
User request: ${context.request}
Canonical checkout: ${context.canonicalRoot}
Selected BEADS_DB: ${context.beadsDb}
Expected commits: ${context.expectedCommits.join(", ")}
Completed task scope: ${context.completedTasks.join(", ") || "No task closures requested"}`,
		}),
		title,
	};
}
