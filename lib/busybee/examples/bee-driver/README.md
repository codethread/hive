# Bee workflow assignment POC

This POC has one assignment surface: every submission starts one Busy Bee workflow run and links that run to one Bee driver request. The default workflow has one work stage containing the caller's actual assignment. Custom workflows can have multiple stages. Work lives beneath the run; callers do not supply separately assigned task bead IDs.

The example composes Busy Bee and the public Bee CLI. Production Bee commands and kind configuration remain unchanged. Colony's stopped-execution cleanup releases unfinished descendants held by the stopped identity; independent workers keep their assignments.

## Submit an assignment

Use a disposable Git repository with initialized Beads and a configured Bee kind. Submission creates real tracker records. An awake Colony on this host can execute the resulting request. The selected kind must permit driving a workflow; specialist role restrictions still apply.

From this Hive checkout, replace the example paths:

```sh
bun lib/busybee/examples/bee-driver/workflow-only.ts worker \
  --input-file /path/to/work.json \
  --repo /path/to/checkout --db /path/to/beads.db --actor codex --owner ct
```

The default `work.json` contains the assignment itself:

```json
{
	"title": "Write the release notes",
	"request": "Write release-notes.md summarizing the changes in this checkout.",
	"acceptance": [
		"Each user-visible change is covered",
		"Every entry is supported by the checkout's changes"
	]
}
```

The title, request and at least one verification criterion are required. Busy Bee freezes the rendered assignment and criteria on the work stage. The bee performs the assignment, records verification evidence, closes that stage and submits its outcome. Busy Bee then closes the run; Colony observes that closure as completion. The criteria are worker instructions, not automatically populated native acceptance gates.

Select a custom workflow with its own validated input:

```sh
bun lib/busybee/examples/bee-driver/workflow-only.ts worker \
  --workflow lib/busybee/examples/bee-driver/linear.ts \
  --input-file /path/to/linear.json \
  --repo /path/to/checkout --db /path/to/beads.db --actor codex --owner ct
```

```json
{ "worktree": "/path/to/checkout", "request": "The caller's assignment" }
```

Inspect inputs with `bun run --silent busybee input-schema --source PATH --json`. The POC command emits one JSON success or failure document. Success identifies the driver request and run, including the initial active stage. Inspect with `bee status REQUEST_ID --json` and `busybee show RUN_ID --json`.

Inputs are validated before native run/spawn creation and retained in the checkpoint. Changing the input file later does not change the captured assignment. `--repo` selects the execution checkout and is passed as Bee's execution directory; a `worktree` input remains separate schema-validated data.

## Execution and record shape

The default assignment creates four records: the run, checkpoint, work stage and Bee spawn request. There is no external original task. Colony claims the run, and the driver claims manual stages beneath it. Native parent closure refuses unfinished children; Busy Bee advances after completed stages and owns run closure.

Automatic stages use Busy Bee's existing independent Bee requests. The driver collects their results and leaves their assignments intact. This POC does not change that internal execution path or recursively wrap those requests in default workflows.

## Remaining POC limits

- **Kind defaults:** this POC supplies a built-in do-work default and an explicit workflow override. Per-kind workflow defaults are not wired into canonical Bee configuration.
- **Run handoff:** the example makes the active run open and unassigned using the existing typed Beads service. A product interface should own that handoff explicitly.
- **Already complete:** a workflow that finishes during initialization stays closed, returns `workflow_already_done` with its run ID and creates no driver request.
- **Submission effects:** workflow creation and Bee submission are separate mutations. A failed spawn leaves a run for inspection; `workflow_spawn_failed` includes its ID. Inspect it before resubmitting.
- **Automatic stages:** worker capacity, child failure propagation and live automatic-worker coordination still need proof. Completion authority remains with Busy Bee.
- **Retries and definitions:** the finite retry budget remains. Blocked reports stop automatic attempts. These examples start explicit-file runs, so resumption requires the saved entry-file hash to match; imports and installed dependencies remain author-owned. Named runs instead use the manifest's forward SemVer caret contract. Existing uncertain-write checkpoint rules still apply.
- **Verification:** the automated suite does not cover native driver execution. Verify completion and blocked handoff in a disposable repository before relying on this example.

This is an isolated workflow-only proof of concept, with no production workflow default enabled.
