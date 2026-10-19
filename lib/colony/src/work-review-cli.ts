import {
	workReviewBranchSchema,
	workReviewInputSchema,
	workReviewPreflightSchema,
	workReviewRecordSchema,
	workReviewRecordedSchema,
	workReviewRecoverSchema,
	workReviewRecoveredSchema,
} from "@hive/shared";
import type { Command } from "commander";
import type { RepositoryOptions } from "./cli.ts";
import type { WorkReviewBranch } from "@hive/shared";
import { workReviewControlSchema } from "./work-review-runtime.ts";
import { z } from "zod";

export type WorkReviewOptions = RepositoryOptions & { actor: string } & (
		| { operation: "preflight"; branch: WorkReviewBranch }
		| { operation: "inspect" }
		| { operation: "record" | "recover"; inputFile: string }
	);

const operationHelp = {
	preflight: {
		description: "Read current branch candidates without launching a review",
		text: `
Read-only inspection; automatic reviews may be disabled. blocked selects native
blocked work; in_progress selects stranded managed work through its current
source and exact unsuccessful request links. Human/HITL/manual reservations and
the review control subtree are excluded. Agent assignment alone does not suppress
diagnosis; it still prevents recovery.
Pending, ambiguous or ineligible request mappings leave blocked work diagnosable
without supplying a recovery target. Cancelled requests remain diagnosable without
continuation authority; recover has separate admission checks.

Returns up to 20 candidates, omitted due candidates, excluded cases and nextCursor.
The scheduler retains that cursor to rotate later hourly batches. Fresh stable
receipts skip blocked review; unknown or incomplete evidence is not a stable result.
Read failures fail the command. A preflight snapshot is not a recovery reservation.
`,
	},
	inspect: {
		description: "Read the configured review control and retained effects",
		text: `
Requires an enabled policy and its original repository/tracker/host/state binding.
Reads native branch clocks, run/request IDs and recovery effects without contacting
the daemon or changing control. Empty notes yield the initial control view.

Inspect attention details and exact request/run records before follow-up. Retain
tokens, replacementIds and reopenedIds; clearing control does not restore authority.
`,
	},
	record: {
		description: "Record a frozen candidate diagnosis and update its stable marker",
		text: `
Read colony work-review --schema for the input and output contracts. Only the current
ordinary review driver may record its retained batch. Preserve the supplied actor,
tracker, branch, token and fingerprint. Stale evidence is refused; this command
does not refresh the frozen batch.

The workflow owns classification. stable requires native blocked status; tooling
and unknown remove blocker:stable. The command appends a native receipt, rechecks
freshness and conditionally publishes the marker while preserving assignments.
Keep receiptId in the workflow outcome. changed reports a new diagnosis; false
reuses its receipt but may still repair the marker. Recording grants no retry authority.
`,
	},
	recover: {
		description: "Attempt one authorized tooling recovery for an exact request lineage",
		text: `
Read colony work-review --schema for the input and result contracts. Only the current
ordinary review driver may recover its retained batch, with a fresh native tooling
receipt and evidence that the impediment cleared within existing work intent.
The command rechecks source/ancestor assignments, holds, prerequisites, request
lineage and fresh owning-host stopped-process evidence. Native and captured request
identity/task links must match the predecessor; historical failure diagnostics alone
do not refuse recovery. Missing or mismatched proof does.

For cancellation, supply continuation with the exact sourceId, runId, requestId and
closedAt. Its authority identifies a configured human's direction through an existing
native comment on the source, an ancestor or the saved run. The comment must name
the run and predecessor request and date from at or after that closure. Retain its
taskId, commentId, actual author and exact quote; agent-recorded human direction is
supported. requestedBy names the human who gave that direction, not the recorder.
The workflow must verify explicit existing tooling-pause continuation authority.
Code checks references and freshness, not natural-language intent; an agent assertion
does not grant permission. Missing, stale, unrelated or ambiguous authority stays
report-only.

Before reserving an allowance, reopening an anchor or retrying, the command inspects
the exact saved assignment through public Busy Bee preview in the original execution
checkout. Missing or unsupported checkpoints/definitions refuse recovery without those
effects and identify caller follow-up. Checkpoint identity, update time, definition
hash and native evidence are rechecked before effects. Inspection covers the retained
assignment and definition, not every future workflow path; trusted imports/renderers
are not an I/O sandbox.

The command reserves one allowance per lineage before effects, conditionally
requeues the unassigned request anchor when needed, then invokes public bee retry
for the same saved run/stage and execution directory. No claim transfer, worker
termination, checkpoint unlock, tool installation, credential change or new work
scope is authorized.

submitted confirms a replacement request, not completed work. attention retains
partial effects; already_attempted means the lineage allowance is consumed.
Preserve replacementIds, reopenedIds and detail in the workflow result. After a
refusal or uncertain effect, inspect retained control and native evidence for caller
follow-up; do not repeat recovery, clear its records or start a replacement workflow.

Tracker alerts or unreadable health checks pause all affected native work. A
tracker_unavailable failure carries requestId, taskId, phase, reopenedIds,
replacementIds and nextAction from confirmed effects; the reserved allowance stays
consumed. phase reports the last confirmed effect; the native journal may retain an
earlier phase. Retain that output outside the tracker and follow the repository's
tracker-alert recovery protocol before further native reads or writes, including
response publication, workflow outcomes and completion. Resume ordinary delivery
only when that protocol permits it; bee finish --help owns execution reporting.
`,
	},
};

/** Register only command syntax; live native and process dependencies are injected by the entry point. */
export function registerWorkReviewCommands(
	program: Command,
	dependencies: {
		workReview: (options: WorkReviewOptions) => Promise<unknown>;
		stdout: (text: string) => void;
	},
): void {
	const group = program
		.command("work-review")
		.description("Inspect hourly work reviews and perform their scoped native actions")
		.addHelpText(
			"after",
			"\nUse preflight before activation and inspect for retained effects. " +
				"Assigned workflows use record and recover; read their focused help.\n" +
				"Preserve repository, tracker, Colony state and actor selections. " +
				"Operations return one JSON document.\n",
		);
	group
		.option("--schema", "Print input, result and control schemas without native reads")
		.action((options: { schema?: boolean }) => {
			if (options.schema) {
				const schemas = {
					workflowInput: z.toJSONSchema(workReviewInputSchema),
					record: z.toJSONSchema(workReviewRecordSchema),
					recover: z.toJSONSchema(workReviewRecoverSchema),
					preflight: z.toJSONSchema(workReviewPreflightSchema.extend({ ok: z.literal(true) })),
					recorded: z.toJSONSchema(workReviewRecordedSchema.extend({ ok: z.literal(true) })),
					recovered: z.toJSONSchema(workReviewRecoveredSchema.extend({ ok: z.literal(true) })),
					control: z.toJSONSchema(workReviewControlSchema),
				};
				dependencies.stdout(
					`${JSON.stringify({ ok: true, kind: "work_review_schema", ...schemas })}\n`,
				);
				return;
			}
			group.help();
		});
	for (const operation of ["preflight", "inspect", "record", "recover"] as const) {
		const command = group
			.command(operation)
			.description(operationHelp[operation].description)
			.addHelpText("after", operationHelp[operation].text)
			.option("--repo <directory>", "Repository discovery directory", ".")
			.requiredOption("--beads-db <path>", "Selected Beads database", process.env["BEADS_DB"])
			.option("--state <directory>", "Daemon state directory")
			.requiredOption("--actor <identity>", "Native read/write actor", process.env["BD_ACTOR"])
			.option("--json", "Emit one JSON document");
		if (operation === "preflight") {
			command.requiredOption("--branch <branch>", "blocked or in_progress");
		}
		if (operation === "record" || operation === "recover") {
			command.requiredOption("--input-file <path>", "Typed decision JSON");
		}
		command.action(async (options: WorkReviewOptions & { branch?: string }) => {
			let parsed = { ...options, operation };
			if (operation === "preflight") {
				parsed = { ...options, operation, branch: workReviewBranchSchema.parse(options.branch) };
			}
			const result = await dependencies.workReview(parsed as WorkReviewOptions);
			dependencies.stdout(`${JSON.stringify({ ok: true, ...(result as object) })}\n`);
		});
	}
}
