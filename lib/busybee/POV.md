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
busybee inspect busy-2rm --work --json
br show busy-2rm.1 --json
```

Read `work.data.active[].choices` for each outcome and its complete JSON schema. The parallel example's `next` accepts `{}`; require `work.kind: available` before using this expansion.

## Complete the task, then advance

After identifying the change and completing any subtasks:

```sh
busybee complete busy-2rm busy-2rm.1 next --json
busybee advance busy-2rm --json
```

Advance returns compact bead/request IDs. Reinspect with `inspect --work --json` for the next briefs; the work expansion contains these groups and workers:

| Bead             | Title          | Commands |
| ---------------- | -------------- | -------- |
| `busy-2rm.2`     | Implementation | None     |
| `busy-2rm.2.1`   | API            | None     |
| `busy-2rm.2.1.1` | Implement API  | `next`   |
| `busy-2rm.2.2`   | Documentation  | None     |
| `busy-2rm.2.2.1` | Write docs     | `next`   |

API and documentation work can proceed concurrently. Each worker uses `complete` for its own task; the driver collects results. Busy Bee closes the groups once their work finishes. These tasks belong to open groups, not the closed preparation task. Read `busybee complete --help` for payload options, closure refusal and retries.

Both dispatch modes use `complete` followed by driver advancement. An outcome named `next` is data for `complete`, not a separate command.

## Submit a structured outcome

The groceries definition starts with “Read the week ahead”:

```sh
busybee run groceries --parent EXISTING_MEAL_PLAN_ID --owner ct --json
busybee inspect busy-8fp --work --json
```

For illustrative task `busy-8fp.1`, `work.data.active[].choices` offers `busy` and `flexible`; both require a positive integer `meals` payload.

After checking the calendar:

```sh
busybee complete busy-8fp busy-8fp.1 busy --data '{"meals":4}' --json
busybee advance busy-8fp --json
```

The next task is “Choose quick recipes,” with context including `busyWeek: true` and `plannedMeals: 4`. Repeat the inspect, work, complete and advance cycle until `status` is `done`.

## Read a completed run's lifecycle

After the groceries run reports `done`, read its native closure:

```sh
busybee inspect busy-8fp --json
```

```json
{
	"ok": true,
	"kind": "workflow_lifecycle",
	"runId": "busy-8fp",
	"nativeStatus": "closed",
	"updatedAt": "2026-10-18T10:30:00Z",
	"publication": {
		"checkpoint": "busy-c7q",
		"savedAt": "2026-10-18T10:30:01Z",
		"locked": false,
		"settlement": "none"
	},
	"lifecycle": {
		"kind": "terminal",
		"closedAt": "2026-10-18T10:30:00Z",
		"fact": {
			"kind": "busybee-lifecycle",
			"formatVersion": 1,
			"scope": "run",
			"runId": "busy-8fp",
			"outcome": "succeeded",
			"reason": "Authored workflow completed and checkpoint published."
		}
	},
	"resolution": { "kind": "resolved" }
}
```

This read works after the workflow source is removed, provided the selected tracker retains the run and checkpoint. See the [lifecycle contract](./SPEC.md#native-lifecycle) for pending and unclassified records, and `busybee inspect --help` for schema discovery.

To include the saved diagram and its instruction previews explicitly:

```sh
busybee inspect busy-8fp --diagram --instructions --json
```

The same lifecycle envelope gains `diagram`. When source is available, `diagram.kind` is `available`, `mode` is `instructions`, and `data` holds the graph and labelled briefs. If expansion fails, `diagram.kind` is `unavailable` with `reason` and `message`; the native lifecycle above remains visible. The [preview contract](./SPEC.md#saved-state-preview) defines provenance, privacy and execution limits.

## Settle unfinished work

For an explicitly authorized withdrawal, read `busybee settle --help` first. These separate examples assume eligible inventory and owning-host execution clearance. IDs are illustrative; `busy-new` is an existing replacement beneath the same native parent as its predecessor.

```sh
busybee settle busy-old cancel --reason "The remaining work was withdrawn." --json
busybee settle busy-failed fail --reason "The remaining workflow cannot be completed." --json
busybee settle busy-failed ack --reason "The failure is accepted; no follow-up remains." --json
busybee settle busy-replaced supersede --replacement busy-new --reason "Continue in the replacement run." --json
```

The failed run still reports `lifecycle.fact.outcome: "failed"` after acknowledgment, with `resolution.kind: "acknowledged"`. Superseding a pending run cancels its unfinished scope; its earlier successful visits retain their results. The settlement response includes `operation`, `closedIds` and the native lifecycle projection. The [settlement contract](./SPEC.md#unsuccessful-settlement) covers reservations, replacement provenance and uncertain publication.

To discover the input and response shapes without a tracker or daemon:

```sh
busybee settle --schema --json
colony system execution-clearance-schema --json
```

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

The run is “Land worktree feature/widget” and the first task is “Triage the authorized landing: worktree feature/widget.” Inspect `inspect --work` and its brief, then choose the outcome matching the actual work: `implement`, `check`, `review`, `commit`, `reviewed` or `integrated`. Later tasks can return to implementation, review or PR readiness rather than advancing in a fixed sequence.

Every landing outcome, including `next`, requires an `evidence` payload describing the observed result and next brief. Put narrative verification in comments. Complete the stage with that outcome and payload, then collect the saved result. Outcomes `approved`, `commit` and `reviewed` also require the current local-review receipt (`bead`, `base`, `revision`); see [landing from the current state](./README.md#landing-from-the-current-state). Leave unresolved blockers open rather than inventing evidence to advance.

If landing removes the feature checkout, continue from the retained canonical root with the same database and unchanged named definition. Before the final visit closes, comment on the run with integration, acceptance and verification evidence. Its brief retains the authorized `completedTasks`, paths and caller instructions. Collect the final saved `next` result and verify `status: done`; only then does the authorized standalone caller or Land driver close proven `hv-widget` and publish once with `bun run beads:sync`. The parent edge does not add closure permission for other tasks. See [landing from the current state](./README.md#landing-from-the-current-state) for the post-done failure handoff.
