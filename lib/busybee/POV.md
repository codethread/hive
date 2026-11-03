# Busy Bee walkthrough

This session shows parallel work and structured outcomes. Bead IDs and paths are illustrative; JSON excerpts omit unrelated response fields. Follow the [user guide](./README.md) for installation and [authoring guide](../../docs/busybee-workflows.md) for catalogue setup.

Assume `busybee` and `br` are on `PATH`, both use the repository's selected database, and the bundled parallel and groceries definitions are installed in its catalogue. From a Hive checkout, `bun run --silent busybee` invokes the same CLI.

## Find and start work

```sh
export BD_ACTOR=codex
busybee list
busybee input-schema parallel
busybee run parallel --parent EXISTING_CHANGE_ID --owner ct --json
```

The parent IDs name existing nonclosed ordinary work in the selected tracker. Each run becomes its native child and leaves that parent open. The parallel example accepts `{}`, so it needs no input file. The run response starts with one worker task:

```json
{
	"ok": true,
	"kind": "run",
	"id": "busy-2rm",
	"status": "active",
	"active": [
		{
			"bead": "busy-2rm.1",
			"title": "Prepare change",
			"commands": ["next"]
		}
	]
}
```

The run ID identifies the workflow; the task ID identifies the work to submit. Read the native run brief for caller completion instructions and the active task brief for its work and authority:

```sh
br show busy-2rm --json
busybee inspect busy-2rm --work --json
br show busy-2rm.1 --json
```

Require pending native lifecycle and `work.kind: available`. The `work.data.active` entries include frozen instructions and `choices`; here the `next` choice accepts `{}`. Use `busybee inspect --help` for the output contract and expansion limits. Read each native brief once per visit, refreshing it when relevant scope, state or authority changes.

## Complete the task, then advance

After identifying the change and completing any subtasks:

```sh
busybee complete busy-2rm busy-2rm.1 next --json
busybee advance busy-2rm --json
```

Advance returns a compact acknowledgment. Reinspect with `busybee inspect busy-2rm --work --json`; its `work.data.active` now contains these groups and workers:

| Bead             | Title          | Commands |
| ---------------- | -------------- | -------- |
| `busy-2rm.2`     | Implementation | None     |
| `busy-2rm.2.1`   | API            | None     |
| `busy-2rm.2.1.1` | Implement API  | `next`   |
| `busy-2rm.2.2`   | Documentation  | None     |
| `busy-2rm.2.2.1` | Write docs     | `next`   |

API and documentation work can proceed concurrently. Each worker uses `complete` for its own task; the driver collects results. Busy Bee closes the groups once their work finishes. These tasks belong to open groups, not the closed preparation task. Read `busybee complete --help` for payload options, closure refusal and retries.

Every outcome, including one named `next`, uses the same completion and advancement path.

## Submit a structured outcome

The groceries definition starts with “Read the week ahead”:

```sh
busybee run groceries --parent EXISTING_MEAL_PLAN_ID --owner ct --json
busybee inspect busy-8fp --work --json
```

Using illustrative returned IDs, the available `work.data.active` entry is “Read the week ahead.” Its `choices` are `busy` and `flexible`; each schema requires a positive integer `meals`.

After checking the calendar:

```sh
busybee complete busy-8fp busy-8fp.1 busy --data '{"meals":4}' --json
busybee advance busy-8fp --json
```

The next task is “Choose quick recipes.” Read each new visit's full native brief, then repeat the work, complete and advance cycle until `status` is `done`.

## Read native lifecycle

```sh
busybee inspect busy-8fp --json
busybee inspect busy-8fp --diagram --instructions --json
```

The first command reads native disposition without workflow source or Colony, provided the tracker retains the run and checkpoint. The second explicitly requests a saved diagram and labelled instruction previews. An unavailable expansion leaves native lifecycle visible; a closed run without a lifecycle marker remains unclassified. Follow `busybee inspect --help` for output and availability, and the [lifecycle contract](./SPEC.md#native-lifecycle) for closure meaning.

## Settle unfinished work

For explicitly authorized retirement or follow-up, read `busybee settle --help` and establish eligible scope and owning-host execution clearance. These independent examples use illustrative IDs; `busy-new` is an existing replacement beneath the predecessor's native parent:

```sh
busybee settle busy-old cancel --reason "The remaining work was withdrawn." --json
busybee settle busy-failed fail --reason "The remaining workflow cannot be completed." --json
busybee settle busy-failed ack --reason "The failure is accepted; no follow-up remains." --json
busybee settle busy-replaced supersede --replacement busy-new --reason "Continue in the replacement run." --json
```

Acknowledgment leaves a failed run failed. Superseding pending scope cancels its unfinished work while preserving earlier completed visits and original results. Parent acceptance remains separate. The [settlement contract](./SPEC.md#unsuccessful-settlement) covers provenance and publication recovery; `busybee settle --schema --json` exposes input and success shapes offline.

## Run Hive's landing workflow

The [land definition](../../.workflows/land/workflow.ts) records an existing user request to land; starting it does not authorize landing. Inspect its input with `busybee input-schema land`. For authorized work, `/tmp/land-input.json` might contain:

```json
{
	"request": "The user asked to land the widget change in the current conversation.",
	"canonicalRoot": "/work/hive",
	"beadsDb": "/work/hive/.worktrees/tracker--state/.beads/beads.db",
	"completedTasks": ["hv-widget"],
	"target": { "kind": "worktree", "branch": "feature/widget" }
}
```

```sh
busybee run land --parent hv-widget --owner ct --input-file /tmp/land-input.json --json
```

The run is “Land worktree feature/widget” and the first task is “Finish and check: worktree feature/widget.” Choose `passed` after completing the agreed work and checks, or `integrated` with proof the change already landed. The normal path continues through Bee-dispatched review, commit/integration, verification and local tool update; findings or changed content return to check.

Every outcome requires an `evidence` string. For example, after the first visit passes:

```sh
busybee complete RUN CHECK_TASK passed --data '{"evidence":"Complete change passes bun run check; base and diff recorded in stage comments."}' --json
busybee advance RUN --json
```

Reinspect with `busybee inspect RUN --work --json` and use the visit/request IDs to follow the [review delivery flow](./README.md#delegate-a-workflow-to-bee). If landing removes the feature checkout, continue from the retained canonical root with the same database and compatible named definition. After `status: done`, follow the run brief's caller completion instructions; [Land's user guide](./README.md#landing-from-the-current-state) explains standalone and nested publication.
