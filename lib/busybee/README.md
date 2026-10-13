# Busy Bee

Busy Bee runs XState workflows as native Beads tasks. Agents do the work, close their tasks and submit outcomes; the chart decides what happens next. Workflows can branch, loop, nest tasks and join parallel work.

## Install

Requires Bun for building and native `br` on `PATH`. From a Hive checkout:

```sh
bun install
bun run --filter @hive/busybee build
bun run --filter @hive/busybee install:bin
busybee --help
```

The build writes the standalone executable `lib/busybee/dist/busybee`. Installation copies it to `~/.local/bin`; put that directory on `PATH`. Use `install:bin --directory /path/to/bin` for another destination. Workflow definitions remain checkout-owned and must provide their imports. Automatic workers also require `bee` and an awake Colony; see [automatic tasks](#automatic-tasks).

## Run a workflow

Use a repository with an existing Beads database. Busy Bee uses the same database as `br`: `--db PATH` overrides `BEADS_DB` and native discovery. `--repo PATH` selects the working checkout independently of database storage.

Repository workflows live in `.workflows/<name>/`. To try one, copy the [groceries definition](./examples/groceries/workflow.ts) to `.workflows/groceries/workflow.ts` and add `.workflows/groceries/busybee.toml`:

```toml
description = "Prepare a weekly meal plan and grocery list"
version = "1.0.0"
run = "./workflow.ts"
```

The repository must provide the definition's imports (`xstate` and `zod` for this example). Workflow modules execute as trusted Bun code.

From that repository or a nested directory:

```sh
export BD_ACTOR=codex
busybee list
busybee input-schema groceries
busybee run groceries --owner ct --json
```

For workflows requiring initial values, add `--input-file FILE` with the JSON input described by `input-schema`; omitted input is `{}`. The response contains the run `id`, `active` tasks and their bead IDs, `created` visit records, and XState `status`.

Use the returned IDs to inspect the work and its choices:

```sh
RUN=example-run-id
TASK=example-active-task-id
busybee show "$RUN" --json
busybee discover "$RUN"
br show "$TASK" --json
```

The groceries example first asks about the week ahead. After doing that work and completing any child tasks, close the task and submit its outcome:

```sh
br close "$TASK" --reason "Completed: four meals at home with limited cooking time"
busybee choice "$RUN" "$TASK" busy --data '{"meals":4}' --json
```

For a task offering `next`, use `busybee next "$RUN" "$TASK"`. Commands with an empty-object schema need no payload; larger payloads can use `--data-file FILE` instead of `--data`.

Repeat until `status` is `done`. A closed task stays active until Busy Bee accepts its result. Workers close their own tasks after satisfying native Beads acceptance and child-completion gates; Busy Bee closes grouping beads and the run. [The walkthrough](./POV.md) shows parallel tasks and example responses.

## Commands

| Command | Use |
| --- | --- |
| `list` | List repository workflows without executing them |
| `input-schema NAME` | Inspect a workflow's initial input |
| `run NAME --owner HUMAN` | Start a repository workflow |
| `show RUN` | Read current tasks and visit records |
| `discover RUN` | Inspect choices, payload schemas and task constraints |
| `next RUN TASK` | Submit the task's `next` outcome |
| `choice RUN TASK CHOICE` | Submit a named outcome |
| `collect RUN` | Process closed automatic tasks |
| `input-schema --source PATH` | Inspect an explicit definition file |
| `start PATH --owner HUMAN` | Run a definition without a catalogue manifest |
| `validate PATH` | Check a definition and its initial input without creating beads |
| `preflight NAME [--source PATH]` | Check unfinished named runs against a current or proposed definition |

`run`, `start` and `validate` accept `--input-file FILE`. See `busybee --help` for options and the [authoring guide](../../docs/busybee-workflows.md) for definitions and validation limits.

`list`, `input-schema` and `validate` need no tracker or actor. `preflight` needs the selected tracker but no actor. `show` and `discover` are read-only snapshots, not reservations. Discovery summaries are readable by default; `--json` includes complete schemas, including nested and conditional constraints. Run commands return JSON. With `--json`, every command emits one stdout document containing `ok` and `kind`; command errors add `reason`, `message` and known context, leave stderr empty and exit nonzero. A preflight incompatibility retains its full report alongside those failure fields.

Before updating a named workflow, check the selected tracker's existing unfinished runs:

```sh
busybee preflight groceries --json
busybee --repo /path/to/candidate-checkout --db /path/to/beads.db preflight groceries --json
busybee preflight groceries --source /path/to/proposed-workflow.ts --json
```

`--repo` selects the proposed catalogue and its manifest version. `--source` checks an explicit proposed module without requiring a current catalogue entry; because the module declares no manifest version, version compatibility is reported as unchecked. Preflight checks version compatibility, snapshot restoration, active states and frozen command contracts, current task rendering and persisted root actor context when the author supplies `resumeSchema`. Without that schema, the report identifies root context validation as unchecked; child context validation and future paths remain unproved in either case. Incompatible runs produce a nonzero exit and preserve the full JSON report with `ok: false`, `reason: "preflight_incompatible"` and a summary `message`. Preflight performs no engine writes, starts no actor and launches no worker, but imports and render callbacks execute trusted workflow code. It is not a sandbox. See the [authoring guide](../../docs/busybee-workflows.md#preflight-existing-runs) for author obligations and limits.

## Ownership and assignment

Mutations require `--actor` or `BD_ACTOR`; the flag takes precedence. Starting also requires `--owner` for the accountable human. `--assignee` defaults to the starting actor. Later tasks inherit the run's native owner and assignee, even when another actor submits a result.

The run and manual tasks are assigned. Grouping and checkpoint beads are unassigned; automatic tasks remain unassigned for Colony to claim. Native attribution variables such as `BR_AGENT_NAME`, `BR_HARNESS` and `BR_MODEL` pass through to `br`.

## Automatic tasks

A definition can request a Bee kind for a task. Entering that task submits a Bee request immediately; an awake Colony executes it through the [Bee and Colony interface](../colony/README.md).

The worker follows the [durable result contract](#delegate-a-workflow-to-bee): record the outcome and original payload, then close the stage. Run `busybee collect RUN` to process saved results. Automatic tasks advance through `collect`; manual `next` and `choice` submissions are rejected. Closure means the work finished: a review result can still request changes.

## Examples

| Definition | Demonstrates |
| --- | --- |
| [Parallel work](./examples/parallel/workflow.ts) | Sequences, nested groups, concurrent tasks, joins and loop visits |
| [Groceries](./examples/groceries/workflow.ts) | Context, guards, branching and replanning |
| [Change review](./examples/change-review/workflow.ts) | Planner-authored briefs, dynamic reviewers, revision-aware results and repair loops |
| [Land](../../.workflows/land/workflow.ts) | One triage entry for unfinished work, reviewed changes or existing PRs; implementation/review and PR feedback loops |

To prepare a disposable change-review repository and stop at its first planner task:

```sh
bun lib/busybee/examples/change-review/demo.ts --owner ct --actor codex
```

The demo prints `repo`, `db`, `inputFile` and `run`. For your own change, use `input-schema --source` on the definition: input includes `title`, `request`, full base commit `base` and `execution: {"mode":"manual"}`. For automatic execution, use `execution: {"mode":"bee","kind":"worker"}` with a kind listed by `bee kinds`. Agents supply revision fingerprints; Busy Bee does not calculate them independently.

## Landing from the current state

The repository's `land` workflow requires an actual user request to finish and land the agreed scope. Starting it is not authorization. Inspect `busybee input-schema land`: input retains the request, canonical checkout, tracker endpoint and task scope, plus a `target` of `{"kind":"worktree","branch":"feature/example"}` or `{"kind":"pr","url":"https://github.com/owner/repo/pull/123"}`. `expectedCommits` may be `[]` when implementation is unfinished.

Triage chooses implementation, checks, local review, committing approved content, an already-reviewed committed change or already-integrated work. Normal work passes through implementation, checks, local review and commit before integration; passing evidence can skip completed phases. Review findings and verified PR defects return to implementation. PR comments get a brief verify/fix/reply loop; rebuttals return to PR readiness, not directly to merge. Pending external checks, approvals or queue progress leave the active task open rather than creating polling visits.

Every outcome requires `evidence`. Before closing a worker, record narrative verification in comments and save the selected outcome and original payload using the [durable result contract](#delegate-a-workflow-to-bee). `approved`, `commit` and `reviewed` additionally require a `review` receipt containing `bead`, `base` and `revision`. Landing workers require a passing `bun run check` before agent review and verify the referenced review bead records local approval for the current cumulative diff; a closed bead alone is insufficient. Busy Bee validates the payload and legal transition, **not the truth or freshness of Git/PR/review evidence**. External commands remain worker instructions, not chart side effects.

Worktree integration uses Honeycomb; PR integration uses the repository's GitHub policy, followed by Honeycomb cleanup with integration proof. Already-merged work skips merging and still verifies main, cleans up and publishes completion. Retain an unchanged definition in the surviving checkout before removing the feature checkout. The workflow finishes with tracker publication and a report; publish final run-closure bookkeeping afterward. The [land integration tests](./tests/integration/land.test.ts) cover simulated navigation and persistence, not real merges or GitHub actions.

## Resume and failures

Named runs resolve their saved name in the current checkout and can resume there with the same database, even after the original worktree is removed. Each manifest requires a full SemVer `version`, such as `1.2.3`. The current version must be equal to or newer than the saved version within its forward caret range: saved `1.2.3` permits newer `1.x` patch/minor versions and rejects `2.0.0` and downgrades. Before `1.0.0`, caret ranges are narrower: `0.2.3` permits versions below `0.3.0`, while `0.0.3` permits only itself. If either version is a prerelease, only the exact same SemVer version resumes; build metadata does not affect equality or precedence. Successful mutations save the current version for subsequent comparisons; read-only inspection does not persist that update. Authors promise that allowed versions preserve saved state, context and task contracts; preflight helps check that promise.

The named definition's folder hash records the definition that produced the latest saved checkpoint, rather than deciding compatibility. Keep generated files outside that folder: the manifest, entry and local helpers are fingerprinted. Explicit-path runs retain their source path and require the entry-file hash to match before import; changed files require a fresh run. Neither hash covers external imports or installed dependencies.

Engine checkpoints use `formatVersion: 1`, independently of workflow SemVer. The engine validates the checkpoint header and trusts its own stored snapshot and visit body. Old or unknown checkpoint formats are rejected with fresh-run guidance; there is no migration. See the [checkpoint contract](./SPEC.md#checkpoint-and-failure-boundary).

For an incompatible named workflow that still exists, a bee may start a fresh run of the **same name for the same already-authorized scope without asking the user again**. Inspect `busybee input-schema NAME`, prepare input for the current schema, then use `busybee run NAME --input-file FILE --owner HUMAN` with the retained repository, database and assignment options. Preserve the original request and authorization, source/target, scope, owner/assignment intent, tracker and old run/task/evidence references. Inspect completed and uncertain effects before execution; use the current workflow's triage and current evidence to continue remaining work without blindly replaying completed effects or bypassing checks and reviews. Retain the old run as history; starting fresh does not decide its closure.

If the saved workflow name no longer exists, **stop and ask the user which workflow to use**. Do not infer a replacement. A missing/malformed manifest in an existing workflow folder, invalid entry or unrelated I/O failure needs diagnosis of that failure. Busy Bee reports these separately from a missing name. It does not create a replacement run or migrate the saved snapshot. Explicit-file runs continue to identify their saved source file; the same-name recovery policy applies to named runs.

Concurrent submissions require one live database. Tracker synchronization does not provide a distributed lock. Invalid submissions fail before publishing task effects. If a write has been attempted and its outcome is uncertain, Busy Bee retains the checkpoint lock for inspection. There is no automatic expiry or partial-write recovery. Inspect the reported checkpoint and native records before recovery; prefer a fresh run after uncertain effects. The [specification](./SPEC.md#checkpoint-and-failure-boundary) explains this boundary.

## Delegate a workflow to Bee

`bee spawn KIND --input-file FILE` creates a workflow run and driver request, using the kind's named workflow (`do-work` by default). Install that versioned default with `busybee init` in the execution checkout. Use Bee's `--workflow NAME` or `--source PATH` for a caller-selected definition; `--cwd` selects the catalogue and execution checkout. See [Bee submission](../colony/README.md#create-requests) for directory, tracker and partial-submission behavior.

For delegated stages, save the outcome before native closure:

```sh
busybee record-result RUN STAGE CHOICE --data-file result.json --json
br close STAGE --actor YOUR_IDENTITY
busybee collect RUN --json
```

`result.json` supplies only the choice payload. `record-result` validates it against the active visit and stores `{choice,data}` without advancing or closing work. Both manual and automatic stage workers use this result envelope; automatic workers leave collection to the driver. A replacement driver collects already-closed active visits with saved results, retaining nonempty payloads across interruption. Comments hold narrative verification evidence. Missing or malformed saved results fail visibly.

`busybee prepare-driver RUN` prepares an active unassigned run for Bee under its checkpoint lock. It preserves closed runs, human reservations, blocked work and worker assignments. Use `bee attach-workflow KIND RUN` only after inspecting an orphan run and confirming absent driver publication. Existing failed drivers use `bee retry` on their request. These operations retain the same saved workflow input and version compatibility contract.
