# Busy Bee

Busy Bee runs XState workflows as native Beads tasks. Agents do the work and use `complete` to save outcomes and close their tasks; the driver collects those results and the chart decides what happens next. Workflows can branch, loop, nest tasks and join parallel work.

## Install

Requires Bun for building and native `br` on `PATH`. From a Hive checkout:

```sh
bun install
bun run --filter @hive/busybee build
bun run --filter @hive/busybee install:bin
busybee --help
```

The build writes the standalone executable `lib/busybee/dist/busybee`. Installation copies it to `~/.local/bin`; put that directory on `PATH`. Use `install:bin --directory /path/to/bin` for another destination. Workflow definitions remain checkout-owned and must provide their imports. Bee-dispatched workers also require `bee` and an awake Colony; see [Bee-dispatched tasks](#bee-dispatched-tasks).

## Bundled agent guidance

The executable embeds version-matched agent guidance at build time. Read it offline without a source checkout, tracker or runtime configuration:

```sh
busybee skills list --json
busybee skills get workflow-execution
busybee skills file workflow-execution references/authoring.md
```

The guidance covers execution and definition authoring; the application's instructions and verification policy govern the work. Read `busybee skills --help` for resource and output contracts. Running workflows still requires the dependencies described below.

## Prepare a checkout

Use `busybee init --help` to install the bundled `do-work` definition and act on its dependency readiness report. Preserve an existing workflow and supply its imports through the application's dependency tooling. Imports resolve normally from the workflow directory; a root `package.json` is unnecessary.

Use `busybee list` to discover manifests, then `busybee input-schema NAME --json` to verify imports and inspect the selected definition's required input before starting a run. Manifest discovery alone does not establish dependency readiness. These checks create no work and launch no worker.

## Run a workflow

Use a repository with an existing Beads database. Busy Bee uses the same database as `br`: `--db PATH` overrides `BEADS_DB` and native discovery. `--repo PATH` selects the working checkout independently of database storage.

Every new root workflow requires `--parent ID` naming existing nonclosed ordinary work in that database. Tasks, bugs, features and epics are accepted; `system` records such as spawn requests and checkpoints are excluded. Busy Bee reads the parent before publishing the run or its work, creates one native parent edge and leaves the parent's assignment and closure to its workers. Generated visits and groups remain beneath the run; its checkpoint stays related.

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
busybee run groceries --parent EXISTING_WORK_ID --owner ct --json
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

The groceries example first asks about the week ahead. After doing that work and completing any child tasks, complete the task with its original outcome payload, then collect it as the driver:

```sh
busybee complete "$RUN" "$TASK" busy --data '{"meals":4}' --json
busybee collect "$RUN" --json
```

Read `busybee complete --help` for payload options, closure refusal and retries. `record-result` remains available for saving without closure; `choice --help` covers direct submission of closed driver-handled work. A choice named `next` can require data; use its discovered schema.

Repeat until `status` is `done`. A closed task stays active until Busy Bee accepts its result. Workers close their own tasks after satisfying native Beads acceptance and child-completion gates; Busy Bee closes grouping beads and the run. [The walkthrough](./POV.md) shows parallel tasks and example responses.

## Commands

Use `busybee --help` for the command flow and global options, then focused help to choose a read:

| Need                                                  | Help                          |
| ----------------------------------------------------- | ----------------------------- |
| Bundled agent guidance                                | `busybee skills --help`       |
| Creation input                                        | `busybee input-schema --help` |
| Active task briefs and run status                     | `busybee show --help`         |
| Outcome choices and payload schemas                   | `busybee discover --help`     |
| Saved diagrams and state for active or completed runs | `busybee preview --help`      |

The [preview contract](./SPEC.md#saved-state-preview) defines its payload, source-matching limits and execution boundary; [Hive UI](../hive-ui/README.md#workflow-preview) displays it in a modal. The [authoring guide](../../docs/busybee-workflows.md) covers definitions and validation limits.

Before updating a named workflow, check the selected tracker's existing unfinished runs:

```sh
busybee preflight groceries --json
busybee --repo /path/to/candidate-checkout --db /path/to/beads.db preflight groceries --json
busybee preflight groceries --source /path/to/proposed-workflow.ts --json
```

`--repo` selects the proposed catalogue and its manifest version. `--source` checks an explicit proposed module without requiring a current catalogue entry; because the module declares no manifest version, version compatibility is reported as unchecked. Preflight checks version compatibility, snapshot restoration, active states and frozen command contracts, current task rendering and persisted root actor context when the author supplies `resumeSchema`. Without that schema, the report identifies root context validation as unchecked; child context validation and future paths remain unproved in either case. Incompatible runs produce a nonzero exit and preserve the full JSON report with `ok: false`, `reason: "preflight_incompatible"` and a summary `message`. Preflight performs no engine writes, starts no actor and launches no worker, but imports and render callbacks execute trusted workflow code. It is not a sandbox. See the [authoring guide](../../docs/busybee-workflows.md#preflight-existing-runs) for author obligations and limits.

## Ownership and assignment

Mutations require `--actor` or `BD_ACTOR`; the flag takes precedence. Starting also requires `--owner` for the accountable human. `--assignee` defaults to the starting actor. Later tasks inherit the run's native owner and assignee, even when another actor submits a result.

The run and driver-handled tasks are assigned. Grouping and checkpoint beads are unassigned; Bee-dispatched tasks remain unassigned for Colony to claim. Native attribution variables such as `BR_AGENT_NAME`, `BR_HARNESS` and `BR_MODEL` pass through to `br`.

## Bee-dispatched tasks

Both driver-handled and Bee-dispatched worker visits are workflow auto beads: Busy Bee creates them. Supporting beads created by an agent are manual. These provenance terms are independent of dispatch; see the [shared vocabulary](../../GLOSSARY.md#workflows).

A definition can request a Bee kind for a task. Entering that task submits a Bee request immediately; an awake Colony executes it through the [Bee and Colony interface](../colony/README.md).

The worker follows the [delegation and result flow](#delegate-a-workflow-to-bee). Closure means the work finished: a review result can still request changes.

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

The demo creates its original work bead and prints `repo`, `db`, `parent`, `inputFile` and `run`. For your own change, use `input-schema --source` on the definition: input includes `title`, `request`, full base commit `base` and `execution: {"mode":"driver-handled"}`. For Bee dispatch, use `execution: {"mode":"bee-dispatched","kind":"worker"}` with a kind listed by `bee kinds`. Agents supply revision fingerprints; Busy Bee does not calculate them independently.

## Landing from the current state

The repository's [Land workflow](../../.workflows/land/workflow.ts) owns triage, completion checks, review, integration, local tool refresh and cleanup. It requires an explicit user request to land the agreed scope. Read `busybee input-schema land`, then the run and active stage briefs; starting a workflow does not grant landing authority.

Land retains the authorized task IDs, canonical checkout and tracker endpoint through cleanup. Its run brief assigns post-done task closure and tracker publication to the authorized caller/driver. Follow that retained brief even after the feature checkout is removed. Busy Bee validates transitions and payloads; workers verify external Git/PR/review evidence.

The [Land integration tests](./tests/integration/land.test.ts) exercise saved states and navigation without real merges, publication or GitHub actions.

## Resume and failures

Named runs resolve their saved name in the current checkout and can resume there with the same database, even after the original worktree is removed. Each manifest requires a full SemVer `version`, such as `1.2.3`. The current version must be equal to or newer than the saved version within its forward caret range: saved `1.2.3` permits newer `1.x` patch/minor versions and rejects `2.0.0` and downgrades. Before `1.0.0`, caret ranges are narrower: `0.2.3` permits versions below `0.3.0`, while `0.0.3` permits only itself. If either version is a prerelease, only the exact same SemVer version resumes; build metadata does not affect equality or precedence. Successful mutations save the current version for subsequent comparisons; read-only inspection does not persist that update. Authors promise that allowed versions preserve saved state, context and task contracts; preflight helps check that promise.

Named fingerprints record provenance; manifest versions determine resume compatibility. Explicit-path runs retain their source path and require the entry-file hash to match before import. See the [provenance contract](./SPEC.md#contracts-and-authority) for included files and dependency limits.

Engine checkpoints use `formatVersion: 1`, independently of workflow SemVer. The engine validates the checkpoint header and trusts its own stored snapshot and visit body. Old or unknown checkpoint formats are rejected with fresh-run guidance; there is no migration. See the [checkpoint contract](./SPEC.md#checkpoint-and-failure-boundary).

For an incompatible named workflow that still exists, a bee may start a fresh run of the **same name for the same already-authorized scope without asking the user again**. Inspect `br show RUN --json` to recover its native parent and visit links, then `busybee input-schema NAME`. Prepare input for the current schema and use `busybee run NAME --parent ORIGINAL_PARENT --input-file FILE --owner HUMAN` with the retained repository, database and assignment options. Preserve the original request and authorization, source/target, scope, owner/assignment intent, tracker and old run/task/evidence references. Inspect completed and uncertain effects before execution; use the current workflow's triage and current evidence to continue remaining work without blindly replaying completed effects or bypassing checks and reviews. Retain the old run as history; starting fresh does not decide its closure.

For abandoned, incompatible or uncertain partial work, inspect the retained run, visits, request IDs and comments (`br show ID --json`, `br comments ID --json`, and `bee status REQUEST --json`). Record completed effects, saved results, remaining acceptance and the next operator action in comments on unfinished work. Leave unfinished visits and runs open for an explicit handoff; a completed replacement does not satisfy an old sibling or allow their shared parent to close. Do not force-close unfinished work, detach history or steal a checkpoint lock to make completion appear successful. Busy Bee reports retained visit/request IDs and accepted-result references for incompatible runs, and an inspection command for partial writes.

If the saved workflow name no longer exists, **stop and ask the user which workflow to use**. Do not infer a replacement. A missing/malformed manifest in an existing workflow folder, invalid entry or unrelated I/O failure needs diagnosis of that failure. Busy Bee reports these separately from a missing name. It does not create a replacement run or migrate the saved snapshot. Explicit-file runs continue to identify their saved source file; the same-name recovery policy applies to named runs.

Concurrent submissions require one live database. Tracker synchronization does not provide a distributed lock. Invalid submissions fail before publishing task effects. If a write has been attempted and its outcome is uncertain, Busy Bee retains the checkpoint lock for inspection. There is no automatic expiry or partial-write recovery. Inspect the reported checkpoint and native records before recovery; prefer a fresh run after uncertain effects. The [specification](./SPEC.md#checkpoint-and-failure-boundary) explains this boundary.

## Delegate a workflow to Bee

Read `bee spawn --help` to submit a workflow assignment. Drivers coordinate the run; Bee-dispatched workers own their assigned stage. [Response delivery](../../docs/agents/responses.md) routes complete answers separately from workflow outcomes.

Follow `busybee complete --help` for stage completion and `busybee collect --help` for driver progression, including interrupted deliveries. The [work and progression contract](./SPEC.md#work-and-progression) owns lifecycle rules. Bee-dispatched workers leave collection/navigation to the driver.

`busybee prepare-driver RUN` prepares an active unassigned run for Bee under its checkpoint lock. It preserves closed runs, human reservations, blocked work and worker assignments. Use `bee attach-workflow KIND RUN` only after inspecting an orphan run and confirming absent driver publication. Existing failed drivers use `bee retry` on their request. These operations retain the same saved workflow input and version compatibility contract.

The driver reacquires unfinished unassigned driver-handled visits under its current identity, preserving other identities and human/HITL reservations. Closed visits with saved results are collected once. Bee-dispatched workers keep their stage claims; neither handoff nor retry reassigns the whole hierarchy.
