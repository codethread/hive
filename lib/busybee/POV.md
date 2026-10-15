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
			"instructions": "Identify the change to implement.",
			"commands": ["next"]
		}
	]
}
```

The run ID identifies the workflow; the task ID identifies the work to submit. Inspect active work, its native brief and its outcome schemas:

```sh
busybee show busy-2rm --json
br show busy-2rm.1 --json
busybee discover busy-2rm
```

```text
busy-2rm.1: Prepare change
Choice: next
```

No fields follow `next`, so it needs no payload. Use `discover --json` for complete schemas.

## Save the result, close the task, then collect

After identifying the change and completing any subtasks:

```sh
busybee record-result busy-2rm busy-2rm.1 next --json
br close busy-2rm.1 --reason "Completed: identified API and documentation scope"
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

API and documentation work can proceed concurrently. Each worker saves its outcome and closes its own task; the driver collects results. Busy Bee closes the groups once their work finishes. These tasks belong to open groups, not the closed preparation task.

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
busybee record-result busy-8fp busy-8fp.1 busy --data '{"meals":4}' --json
br close busy-8fp.1 --reason "Completed: four meals at home with limited cooking time"
busybee collect busy-8fp --json
```

The next task is “Choose quick recipes,” with context including `busyWeek: true` and `plannedMeals: 4`. Repeat the inspect, work, save, close and collect cycle until `status` is `done`.

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
busybee run land --parent hv-widget --owner ct --input-file /tmp/land-input.json --json
```

The run is “Land worktree feature/widget” and the first task is “Triage the authorized landing: worktree feature/widget.” Inspect `discover` and its brief, then choose the outcome matching the actual work: `implement`, `check`, `review`, `commit`, `reviewed` or `integrated`. Later tasks can return to implementation, review or PR readiness rather than advancing in a fixed sequence.

Every landing outcome, including `next`, requires an `evidence` payload describing the observed result and next brief. Put narrative verification in comments. Follow `busybee record-result --help` to save the chosen outcome and payload before closing the stage, then collect the saved result. Outcomes `approved`, `commit` and `reviewed` also require the current local-review receipt (`bead`, `base`, `revision`); see [landing from the current state](./README.md#landing-from-the-current-state). Leave unresolved blockers open rather than inventing evidence to advance.

If landing removes the feature checkout, continue from the retained canonical root with the same database and unchanged named definition. Before the final visit closes, comment on the run with integration, acceptance and verification evidence. Its brief retains the authorized `completedTasks`, paths and caller instructions. Collect the final saved `next` result and verify `status: done`; only then does the authorized standalone caller or Land driver close proven `hv-widget` and publish once with `bun run beads:sync`. The parent edge does not add closure permission for other tasks. See [landing from the current state](./README.md#landing-from-the-current-state) for the post-done failure handoff.
