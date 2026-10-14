# Bee workflow assignment

Bee submits one workflow assignment beneath existing nonclosed ordinary work in the selected tracker, then publishes a driver request for the run. The original work retains its claim and owner. The standard versioned `do-work` workflow has one stage containing the caller assignment and verification criteria. Install it in an execution checkout with `busybee init`; Bee kind `workflow` defaults to `do-work`.

```sh
bee spawn worker --parent EXISTING_WORK_ID --input-file /path/to/work.json \
  --cwd /path/to/checkout --beads-db /path/to/beads.db --actor YOUR_IDENTITY --json
```

```json
{
	"title": "Write release notes",
	"request": "Write release-notes.md summarizing the changes in this checkout.",
	"acceptance": ["Every user-visible change is covered and supported by the diff"]
}
```

Select the [linear definition](./linear.ts) for a three-stage example:

```sh
bee spawn worker --parent EXISTING_WORK_ID --source lib/busybee/examples/bee-driver/linear.ts \
  --input-file /path/to/linear.json --cwd /path/to/checkout \
  --beads-db /path/to/beads.db --actor YOUR_IDENTITY --json
```

```json
{ "worktree": "/path/to/checkout", "request": "The caller assignment" }
```

Source and input paths resolve in the submitting directory. `--cwd` supplies execution and catalogue discovery; workflow input remains separate schema data. Initial submission also returns `workflow.parentId`. Inspect `request.id` with `bee status`, and `workflow.runId` with `busybee show` and `discover`. Busy Bee owns run closure. See [Bee submission](../../../colony/README.md#create-requests) for retries, same-run attachment, Bee-dispatched workers and partial effects.
