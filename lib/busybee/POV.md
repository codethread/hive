# Busy Bee: the agent's point of view

A concrete session using the bundled examples. Paths and bead IDs are illustrative; command and response shapes were checked against the CLI. JSON excerpts omit unrelated fields, not required command inputs. See the [user guide](./README.md) for setup and the [specification](./SPEC.md) for the reasons behind the behavior.

Assume `busybee` is on `PATH`, the repository already has a native Beads database, and its environment supplies `BEADS_DB` (for example through mise). Busy Bee and `br` use that same selection. From a Hive checkout, `bun run --silent busybee` invokes the same CLI.

```sh
cd /work/widget
export BD_ACTOR=codex
printenv BEADS_DB
```

```text
/work/widget/.beads/beads.db
```

## Find a workflow, then inspect its input

For this walkthrough, assume the bundled [parallel](./examples/parallel/workflow.ts) and [groceries](./examples/groceries/workflow.ts) examples have been copied into `/work/widget/.workflows/parallel` and `/work/widget/.workflows/groceries`. Each folder has a manifest; `.workflows/parallel/busybee.toml` contains:

```toml
description = "Prepare a change, then implement its API and documentation."
run = "./workflow.ts"
```

```sh
busybee list --json
```

```json
{
	"ok": true,
	"kind": "list",
	"repo": "/work/widget",
	"workflows": [
		{
			"name": "parallel",
			"description": "Prepare a change, then implement its API and documentation.",
			"run": "./workflow.ts"
		}
	]
}
```

The excerpt shows one catalogue entry. Listing reads manifests without evaluating workflow code. Inspecting the initial schema imports the selected definition:

```sh
busybee input-schema parallel --json
```

This example accepts an empty object, so no initial input file is needed. Definitions with required fields take a JSON file through `run --input-file`.

An author can check the entry's definition, input and initial state before starting:

```sh
busybee validate .workflows/parallel/workflow.ts --json
```

```json
{
	"ok": true,
	"kind": "validate",
	"source": "/work/widget/.workflows/parallel/workflow.ts",
	"checks": ["definition_resolution", "input_schema", "initial_snapshot"],
	"status": "active"
}
```

The status describes the initial XState snapshot. Validation creates no beads; it evaluates trusted workflow code and leaves later transition behavior to scenario tests. Supply `--input-file` when initialization needs values.

## Start and discover a task

```sh
busybee run parallel --owner ct --json
```

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

The run ID identifies the workflow; the task ID identifies the work being submitted. The human owner is `ct`; the initiating actor and default run assignee are `codex`. The system checkpoint remains unassigned. `show` reads its current instructions and state. `discover` describes its available choices and payloads:

```sh
busybee show busy-2rm --json
busybee discover busy-2rm
```

Task portion of the readable discovery output:

```text
busy-2rm.1: Prepare change
Choice: next
```

No fields follow `next`: no payload is required. Discovery with `--json` includes an empty-object schema. `list` finds definitions; `input-schema` describes their starting input; `discover` describes an existing run's active tasks.

## Do the work, close, then advance

Having identified the change and finished any subtasks, the agent closes its task through Beads and advances the workflow:

```sh
br close busy-2rm.1 \
  --reason "Completed: identified API and documentation scope"

busybee next busy-2rm busy-2rm.1 --json
```

The next response exposes the current work, including containers with no worker commands:

```json
{
	"ok": true,
	"kind": "next",
	"id": "busy-2rm",
	"status": "active",
	"active": [
		{ "bead": "busy-2rm.2", "title": "Implementation", "commands": [] },
		{ "bead": "busy-2rm.2.1", "title": "API", "commands": [] },
		{ "bead": "busy-2rm.2.1.1", "title": "Implement API", "commands": ["next"] },
		{ "bead": "busy-2rm.2.2", "title": "Documentation", "commands": [] },
		{ "bead": "busy-2rm.2.2.1", "title": "Write docs", "commands": ["next"] }
	]
}
```

The two worker tasks can proceed concurrently. They belong to new open containers, not the closed preparation task. Each worker closes and submits its own task; the engine finishes the containers.

Calling `next` before closing the task fails with exit code 1. Its JSON response includes:

```json
{
	"ok": false,
	"kind": "next",
	"reason": "task_not_closed",
	"target": "busy-2rm"
}
```

The omitted `message` names the open task and gives the native close command. The workflow has not advanced. If Beads refuses closure because children remain open, finish those children first.

## A choice with input

A separate run of the [groceries example](./examples/groceries/workflow.ts) starts at “Read the week ahead.” Its returned run and first-task IDs are illustrated here as `busy-8fp` and `busy-8fp.1`:

```sh
busybee run groceries --owner ct --json
busybee discover busy-8fp
```

Task portion of the readable output:

```text
busy-8fp.1: Read the week ahead
Choice: busy
meals (required, integer)  {"exclusiveMinimum":0,"maximum":9007199254740991}
Choice: flexible
meals (required, integer)  {"exclusiveMinimum":0,"maximum":9007199254740991}
```

`busybee discover busy-8fp --json` includes the full schemas: the meal count must be a positive integer. After checking the calendar and finding four meals with limited cooking time:

```sh
br close busy-8fp.1 \
  --reason "Completed: four meals at home with limited cooking time"

busybee \
  choice busy-8fp busy-8fp.1 busy --data '{"meals":4}' --json
```

```json
{
	"ok": true,
	"kind": "choice",
	"id": "busy-8fp",
	"status": "active",
	"active": [
		{
			"bead": "busy-8fp.2",
			"title": "Choose quick recipes",
			"commands": ["next"],
			"context": { "busyWeek": true, "plannedMeals": 4, "substitutions": 0 }
		}
	]
}
```

The chosen outcome selects the next task and carries the submitted data into its context. Larger payloads can use `--data-file`. The agent repeats the same inspect, work, close and submit cycle until the run reports `status: "done"`.

To target another database explicitly, add `--db /work/other-project/.beads/beads.db`. That overrides `BEADS_DB`; without either, Busy Bee uses native Beads discovery. `--repo` selects another working repository when needed.

## Run the repository's landing workflow

Hive's [land definition](../../.workflows/land/workflow.ts) uses the same interface. Starting it records the user's existing landing request; it does not grant permission to land.

```sh
busybee input-schema land
```

For an already-authorized change, `/tmp/land-input.json` might contain these illustrative values:

```json
{
	"request": "The user asked to land the widget change in the current conversation.",
	"canonicalRoot": "/work/hive",
	"beadsDb": "/work/hive/.worktrees/tracker--state/.beads/beads.db",
	"expectedCommits": ["7f3a91c"],
	"completedTasks": ["hv-widget"]
}
```

```sh
busybee run land --owner ct --input-file /tmp/land-input.json --json
```

The first task is “Verify explicit landing authorization and prerequisites.” Subsequent tasks cover cleanup, checks, commits, Honeycomb landing, verification, tracker publication and reporting. Each uses the same close-then-`next` interaction; routine steps require no payload. The agent leaves a task open when its work fails.

If landing removes the feature checkout, continue from `/work/hive` with the retained database and identical named definition. The worker briefs contain the retained paths, commits and task scope. The final task also calls for publishing the workflow's completion bookkeeping after `next` closes the run.
