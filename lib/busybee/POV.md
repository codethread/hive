# Busy Bee walkthrough

This session shows parallel work and structured outcomes. Bead IDs and paths are illustrative; JSON excerpts omit unrelated response fields. Follow the [user guide](./README.md) for installation and [authoring guide](../../docs/busybee-workflows.md) for catalogue setup.

Assume `busybee` and `br` are on `PATH`, both use the repository's selected database, and the bundled parallel and groceries definitions are installed in its catalogue. From a Hive checkout, `bun run --silent busybee` invokes the same CLI.

## Find and start work

```sh
export BD_ACTOR=codex
busybee list
busybee input-schema parallel
busybee run parallel --owner ct --json
```

The parallel example accepts `{}`, so it needs no input file. The run response starts with one worker task:

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
			"instructions": "Identify the change to implement.",
			"commands": ["next"]
		}
	]
}
```

The run ID identifies the workflow; the task ID identifies the work to submit. Inspect instructions and the current input contract:

```sh
busybee show busy-2rm --json
busybee discover busy-2rm
```

```text
busy-2rm.1: Prepare change
Choice: next
```

No fields follow `next`, so it needs no payload. Use `discover --json` for complete schemas.

## Close the task, then submit

After identifying the change and completing any subtasks:

```sh
br close busy-2rm.1 --reason "Completed: identified API and documentation scope"
busybee next busy-2rm busy-2rm.1 --json
```

The returned `active` work now contains these groups and workers:

| Bead             | Title          | Commands |
| ---------------- | -------------- | -------- |
| `busy-2rm.2`     | Implementation | None     |
| `busy-2rm.2.1`   | API            | None     |
| `busy-2rm.2.1.1` | Implement API  | `next`   |
| `busy-2rm.2.2`   | Documentation  | None     |
| `busy-2rm.2.2.1` | Write docs     | `next`   |

API and documentation work can proceed concurrently. Each worker closes and submits its own task; Busy Bee closes the groups once their work finishes. These tasks belong to open groups, not the closed preparation task.

Submitting an open worker task exits nonzero with `reason: "task_not_closed"`; the message supplies its close command. Finish any children blocking native closure, close the task, then submit. The workflow remains unchanged until the result is accepted.

## Submit a structured outcome

The groceries definition starts with “Read the week ahead”:

```sh
busybee run groceries --owner ct --json
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
br close busy-8fp.1 --reason "Completed: four meals at home with limited cooking time"
busybee choice busy-8fp busy-8fp.1 busy --data '{"meals":4}' --json
```

The next task is “Choose quick recipes,” with context including `busyWeek: true` and `plannedMeals: 4`. Repeat the inspect, work, close and submit cycle until `status` is `done`.

## Run Hive's landing workflow

The [land definition](../../.workflows/land/workflow.ts) records an existing user request to land; starting it does not authorize landing. Inspect its input with `busybee input-schema land`. For authorized work, `/tmp/land-input.json` might contain:

```json
{
	"request": "The user asked to land the widget change in the current conversation.",
	"canonicalRoot": "/work/hive",
	"beadsDb": "/work/hive/.worktrees/tracker--state/.beads/beads.db",
	"expectedCommits": ["7f3a91c"],
	"completedTasks": ["hv-widget"],
	"target": { "kind": "worktree", "branch": "feature/widget" }
}
```

```sh
busybee run land --owner ct --input-file /tmp/land-input.json --json
```

The first task is “Triage the authorized landing.” Inspect `discover` and its brief, then choose the outcome matching the actual work: `implement`, `check`, `review`, `commit`, `reviewed` or `integrated`. Later tasks can return to implementation, review or PR readiness rather than advancing in a fixed sequence.

Every landing outcome, including `next`, requires an `evidence` payload describing the observed result and next brief. Put narrative verification in comments. Use the [durable result contract](./README.md#delegate-a-workflow-to-bee) to record the chosen outcome and payload before closing the stage, then collect the saved result. Outcomes `approved`, `commit` and `reviewed` also require the current local-review receipt (`bead`, `base`, `revision`); see [landing from the current state](./README.md#landing-from-the-current-state). Leave unresolved blockers open rather than inventing evidence to advance.

If landing removes the feature checkout, continue from the retained canonical root with the same database and unchanged named definition. The briefs retain the paths, commits and task scope. After the final `next` closes the run, publish its completion bookkeeping as the final brief directs.
