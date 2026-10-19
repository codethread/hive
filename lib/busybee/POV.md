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
busybee show busy-2rm --json
br show busy-2rm.1 --json
busybee discover busy-2rm
```

```text
busy-2rm.1: Prepare change
Choice: next
```

No fields follow `next`, so it needs no payload. Use `discover --json` for complete schemas. Run views stay compact; `busybee show --help` describes optional frozen instruction expansion.

## Complete the task, then collect

After identifying the change and completing any subtasks:

```sh
busybee complete busy-2rm busy-2rm.1 next --json
busybee collect busy-2rm --json
```

The returned `active` work now contains these groups and workers:

| Bead             | Title          | Commands |
| ---------------- | -------------- | -------- |
| `busy-2rm.2`     | Implementation | None     |
| `busy-2rm.2.1`   | API            | None     |
| `busy-2rm.2.1.1` | Implement API  | `next`   |
| `busy-2rm.2.2`   | Documentation  | None     |
| `busy-2rm.2.2.1` | Write docs     | `next`   |

API and documentation work can proceed concurrently. Each worker uses `complete` for its own task; the driver collects results. Busy Bee closes the groups once their work finishes. These tasks belong to open groups, not the closed preparation task. Read `busybee complete --help` for payload options, closure refusal and retries.

Driver-handled visits also support direct `next` and `choice` submission after closure; see `busybee choice --help`. Bee-dispatched visits require saved results and collection.

## Submit a structured outcome

The groceries definition starts with “Read the week ahead”:

```sh
busybee run groceries --parent EXISTING_MEAL_PLAN_ID --owner ct --json
busybee discover busy-8fp
```

Using illustrative returned IDs, discovery shows:

```text
busy-8fp.1: Read the week ahead
Choice: busy
meals (required, integer)  {"exclusiveMinimum":0,"maximum":9007199254740991}
Choice: flexible
meals (required, integer)  {"exclusiveMinimum":0,"maximum":9007199254740991}
```

After checking the calendar:

```sh
busybee complete busy-8fp busy-8fp.1 busy --data '{"meals":4}' --json
busybee collect busy-8fp --json
```

The next task is “Choose quick recipes.” Read each new visit's full native brief, then repeat the work, complete and collect cycle until `status` is `done`.

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
busybee collect RUN --json
```

Use the returned visit/request IDs to follow the [review delivery flow](./README.md#delegate-a-workflow-to-bee). If landing removes the feature checkout, continue from the retained canonical root with the same database and compatible named definition. After `status: done`, follow the run brief's caller completion instructions; [Land's user guide](./README.md#landing-from-the-current-state) explains standalone and nested publication.
