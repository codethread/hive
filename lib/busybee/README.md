# Busy Bee

Busy Bee runs XState workflows as native Beads tasks. Agents do the work and use `complete` to save outcomes and close their tasks; the driver collects those results and the chart decides what happens next. Workflows can branch, loop, nest tasks and join parallel work.

## Install

Requires Bun for building and native `br` on `PATH`. Before upgrading an existing installation, read [breaking adoption](#breaking-adoption). From a Hive checkout:

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
busybee skills get workflow-authoring
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

For workflows requiring initial values, add `--input-file FILE` with the JSON input described by `input-schema`; omitted input is `{}`. The response contains the run `id`, `active` tasks and their bead IDs, `created` records, and these separate status fields:

- `chartStatus`: saved XState status.
- `completion`: `pending`, `projection_pending`, `succeeded`, `failed` or `cancelled`, based on system completion and its current native projection.
- `nativeStatus`: current native run status.
- `status`: chart status, except `completion_pending` when the chart is done without confirmed native success.

Use the returned IDs to inspect the work and its choices:

```sh
RUN=example-run-id
TASK=example-active-task-id
br show "$RUN" --json
busybee show "$RUN" --json
busybee discover "$RUN"
br show "$TASK" --json
```

Read the full native run and task briefs on entry, including caller completion instructions; refresh them when relevant scope, state or authority changes. Use compact run views between those reads; `busybee show --help` describes their fields and optional frozen instructions.

The groceries example first asks about the week ahead. After doing that work and completing any child tasks, complete the task with its original outcome payload, then collect it as the driver:

```sh
busybee complete "$RUN" "$TASK" busy --data '{"meals":4}' --json
busybee collect "$RUN" --json
```

Read `busybee complete --help` for payload options, closure refusal and retries. Both driver-handled and Bee-dispatched visits use this `complete` → `collect` path. An authored choice named `next` remains legal and can require data; use its discovered schema.

Repeat until `status` is `done`. A completed visit stays active until Busy Bee collects its result. Before `complete`, verify and tick current native acceptance, finish child work and deliver any required response. Busy Bee checks acceptance, blockers and reservations, then performs guarded closure; it never ticks criteria or takes another actor's claim. Busy Bee alone closes grouping beads and the run, through the same gates. [The walkthrough](./POV.md) shows parallel tasks and example responses.

## Commands

Use `busybee --help` for the command flow and global options, then focused help to choose a read:

| Need                                                       | Help                          |
| ---------------------------------------------------------- | ----------------------------- |
| Bundled agent guidance                                     | `busybee skills --help`       |
| Creation input                                             | `busybee input-schema --help` |
| Run status, active visits and optional frozen instructions | `busybee show --help`         |
| Outcome choices and payload schemas                        | `busybee discover --help`     |
| Saved diagrams and state for active or completed runs      | `busybee preview --help`      |
| Definition-free native completion repair                   | `busybee reconcile --help`    |
| Explicit failure or cancellation of pending generated work | `busybee settle --help`       |
| Tooling inspection, simulation and Bee driver admission    | `busybee system --help`       |

The [preview contract](./SPEC.md#saved-state-preview) distinguishes structural preview from tooling inspection with frozen briefs and rendered instruction previews. [Simulation](./SPEC.md#simulation) evaluates temporary outcomes without advancing the saved run; use `busybee system simulate --help` for requests and schema discovery. [Hive UI](../hive-ui/README.md#workflow-preview) presents both Saved and Simulate modes. The [authoring guide](../../docs/busybee-workflows.md) covers definitions and validation limits.

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

The worker follows the [delegation and result flow](#delegate-a-workflow-to-bee). Successful execution is separate from its choice: a completed review can still request changes.

## Examples

| Definition | Demonstrates |
| --- | --- |
| [Parallel work](./examples/parallel/workflow.ts) | Sequences, nested groups, concurrent tasks, joins and loop visits |
| [Groceries](./examples/groceries/workflow.ts) | Context, guards, branching and replanning |
| [Change review](./examples/change-review/workflow.ts) | Planner-authored briefs, dynamic reviewers, revision-aware results and repair loops |
| [Nested bees](./examples/nested-bees/README.md) | Child machines, Bee-dispatched visits and captured inspector examples |
| [Land](../../.workflows/land/workflow.ts) | Finish and check agreed work, review independently, integrate, verify and update local tools |

To prepare a disposable change-review repository and stop at its first planner task:

```sh
bun lib/busybee/examples/change-review/demo.ts --owner ct --actor codex
```

The demo creates its original work bead and prints `repo`, `db`, `parent`, `inputFile` and `run`. For your own change, use `input-schema --source` on the definition: input includes `title`, `request`, full base commit `base` and `execution: {"mode":"driver-handled"}`. For Bee dispatch, use `execution: {"mode":"bee-dispatched","kind":"worker"}` with a kind listed by `bee kinds`. Agents supply revision fingerprints; Busy Bee does not calculate them independently.

## Deliver independent feature tasks

Hive's [do-feature-task](../../.workflows/do-feature-task/workflow.ts) delivers an assigned task from an isolated worktree into a local feature base, or preserves blocked work in a PR. The definition owns checks, review and disposition; [Honeycomb's local-delivery guide](../honeycomb/README.md#local-feature-delivery) covers integration and cleanup.

Keep the workflow catalogue and driver in the canonical checkout. Read `busybee --repo CANONICAL_ROOT input-schema do-feature-task --json` for the `canonicalRoot`, `base` and `isolation` input; base and isolation identify distinct noncanonical worktrees on nondefault branches. The assignment and authorization remain on the source task.

Use `bee spawn --help` to dispatch a `slow-worker` with `--workflow do-feature-task --parent SOURCE_ID --input-file FILE --cwd CANONICAL_ROOT`. These workflows and bee kinds are repository configuration, separate from executable installation. Native prerequisites and Colony capacity govern admission.

The run brief owns source completion; a PR does not satisfy integration acceptance. The parent coordinator retains combined-feature delivery. The [specialist protocol](../../docs/agents/specialists.md) owns role selection and decision escalation.

## Landing from the current state

The repository's [Land workflow](../../.workflows/land/workflow.ts) handles authorized implementation delivery by default, including unfinished work and existing PRs, while respecting explicit PR-only or review-only scope. Read `busybee input-schema land` for input and follow its active briefs.

The definition owns checks, review and delivery disposition; a finished run does not alone satisfy source acceptance. Visits and filed responses retain the evidence.

The run brief retains the canonical checkout and tracker endpoint, and owns post-done closure/publication instructions. Standalone Land publishes after authorized source closures; Land nested beneath Release leaves the final checkpoint to Release. [Delegation and result flow](#delegate-a-workflow-to-bee) covers worker delivery and collection.

## Native outcomes and retirement

The workflow system bead owns original results and completion directives. Native `close_reason` is readable generated prose, not a machine protocol; outcome labels are derived query aids. Terminal completion requires a confirmed directive matching the current native closure. A direct close, a requested directive or chart `done` alone does not prove success. The [outcome contract](./SPEC.md#native-workflow-outcomes) defines this boundary. Busy Bee leaves ordinary and system notes untouched. Failed or cancelled visits cannot be collected as successful work.

Use `busybee reconcile RUN --json` to repair known completion projections, including when the definition is unavailable. It does not collect results, advance the chart or recreate work. A direct close without a directive is reopened to `open`; a saved completion with stale native closure or prose may require guarded reopen/reclose and a new `closed_at`. Current briefs, acceptance, claims, owner, notes and unrelated labels are preserved. Gates and reservations can prevent repair; resolve them through the owning actor rather than restoring old task fields.

For explicitly authorized retirement of pending generated work, read `busybee settle --help`. The reason-required `cancel` and `fail` operations preserve successful directives, including requested success. After fresh execution clearance, a retained requested success may become confirmed through the same native gates; it is never converted to failure or cancellation. Unmet acceptance or unfinished manual descendants can leave settlement pending indefinitely. A successful run directive requires collect/reconcile instead of retirement.

[Settlement](./SPEC.md#bounded-unsuccessful-settlement) leaves the saved chart and ordinary source acceptance unchanged. Retry with the same operation and reason for fresh clearance, including repair after a previously complete settlement. Generic reconciliation cannot reclose unsuccessful scope. Settlement is neither a process-stop command nor recovery for a held checkpoint lock.

## Resume and failures

Named runs resolve their saved name in the current checkout and can resume there with the same database, even after the original worktree is removed. Each manifest requires a full SemVer `version`, such as `1.2.3`. The current version must be equal to or newer than the saved version within its forward caret range: saved `1.2.3` permits newer `1.x` patch/minor versions and rejects `2.0.0` and downgrades. Before `1.0.0`, caret ranges are narrower: `0.2.3` permits versions below `0.3.0`, while `0.0.3` permits only itself. If either version is a prerelease, only the exact same SemVer version resumes; build metadata does not affect equality or precedence. Successful mutations save the current version for subsequent comparisons; read-only inspection does not persist that update. Authors promise that allowed versions preserve saved state, context and task contracts; preflight helps check that promise.

Named fingerprints record provenance; manifest versions determine resume compatibility. Explicit-path runs retain their source path and require the entry-file hash to match before import. See the [provenance contract](./SPEC.md#contracts-and-authority) for included files and dependency limits.

Engine checkpoints use `formatVersion: 2`, independently of workflow SemVer. The system description holds control state; the engine validates the consumed control contract and trusts its own snapshot and visit body. Unsupported formats fail before mutation. See the [checkpoint contract](./SPEC.md#checkpoint-and-failure-boundary) and [breaking adoption](#breaking-adoption) before changing tools.

For an incompatible saved run whose named workflow still exists, a bee may start a fresh run of the **same name for the same already-authorized scope without asking the user again**. Inspect `br show RUN --json` to recover its native parent and visit links, then `busybee input-schema NAME`. Prepare input for the current schema and use `busybee run NAME --parent ORIGINAL_PARENT --input-file FILE --owner HUMAN` with the retained repository, database and assignment options. Preserve the original request and authorization, source/target, scope, owner/assignment intent, tracker and old run/task/evidence references. Inspect completed and uncertain effects before execution; use the current workflow's triage and current evidence to continue remaining work without blindly replaying completed effects or bypassing checks and reviews. Retain the old run as history; starting fresh does not decide its closure.

For abandoned, incompatible or uncertain partial work, inspect the retained run, visits, request IDs and comments (`br show ID --json`, `br comments ID --json`, and `bee status REQUEST --json`). Record completed effects, saved results, remaining acceptance and the next operator action in comments on unfinished work. Leave unfinished work open for an explicit handoff unless its authorized [settlement](#native-outcomes-and-retirement) passes the required checks. A completed replacement neither retires an old sibling nor satisfies their shared parent's acceptance. Do not force-close unfinished work or detach history to make completion appear successful. Busy Bee reports retained visit/request IDs and accepted-result references for incompatible runs, and an inspection command for partial writes.

If the saved workflow name no longer exists, **stop and ask the user which workflow to use**. Do not infer a replacement. A missing/malformed manifest in an existing workflow folder, invalid entry or unrelated I/O failure needs diagnosis of that failure. Busy Bee reports these separately from a missing name. It does not create a replacement run or migrate the saved snapshot. Explicit-file runs continue to identify their saved source file; the same-name recovery policy applies to named runs.

Concurrent submissions require one live database. Tracker synchronization does not provide a distributed lock. A known completion failure retains any saved original and directive, reports confirmed effects and releases its own lock when possible. After resolving the gate, retry `complete` with identical original choice/data, or use collect/reconcile for saved completion projection. Matching retries after collection do not replay the transition. Accepted history and the resulting snapshot are saved before group/run closure, so refused container closure can be retried without consuming the result twice.

Unknown task-creation or request-dispatch effects retain ownership for inspection. Process death or database unavailability can also prevent release. There is no automatic lock expiry, takeover or unlock command. Inspect the checkpoint, owner and native effects before explicit recovery within existing task authority; this does not itself require renewed human permission. Preserve live or uncertain locks; prefer a fresh run under the same-scope recovery policy above rather than repeating uncertain publication. The [specification](./SPEC.md#checkpoint-and-failure-boundary) explains this boundary.

## Breaking adoption

Format-1 runs cannot resume under format-2 tools; no migration or automatic cutover is provided. Finish existing runs with matching old tools, or deliberately start a fresh run under the [same-name, same-scope recovery policy](#resume-and-failures). Existing authorization persists; inspect completed/uncertain effects and preserve old run/task/evidence references. A fresh run does not erase old obligations or authorize destructive disposition, expanded scope or live cutover. Ask for any missing workflow choice or reserved action rather than treating the format break as permission.

**Land self-upgrade:** its [`local-update` stage](../../.workflows/land/workflow.ts) installs new binaries before the old run's final `complete` → `collect`. Before replacement, retain the exact matching old Busy Bee, Bee and Colony executables and the compatible workflow definitions. Explicitly select that old toolchain for all remaining format-1 obligations, including Land's completion/collection and the driver's `bee finish`; merely keeping old copies available is insufficient. Only after those obligations are settled may matching new consumers activate or restart at a separately authorized cutover.

Update callers to `complete` → `collect`: `record-result`, direct `next`, direct `choice` and runtime submit are removed, not aliases. Authored outcome names such as `next` remain valid. Refresh customized workflow copies and generated guidance deliberately; executable replacement does not update checkout-owned definitions or saved briefs.

At that cutover, deploy version-matched Busy Bee, Bee, Colony and Hive UI builds using the same Shared contract together. Implementation checks or a code merge alone do not authorize a live tool/daemon cutover.

## Delegate a workflow to Bee

Read `bee spawn --help` to submit a workflow assignment. Drivers coordinate the run; Bee-dispatched workers own their assigned stage. Use `bee result --help` to retrieve worker answers. [Response delivery](../../docs/agents/responses.md) routes complete answers separately from workflow outcomes.

Follow `busybee complete --help` for stage completion and `busybee collect --help` for driver progression, including interrupted deliveries. The [work and progression contract](./SPEC.md#work-and-progression) owns lifecycle rules. Bee-dispatched workers leave collection/navigation to the driver.

Bee prepares driver admission through `busybee system prepare-driver`; its focused help owns the integration contract. Use `bee attach-workflow --help` after inspecting an orphan run and confirming absent driver publication. For a failed driver or stage, or deliberate cancellation resumption, follow `bee retry --help`. Retry retains the saved assignment; collection follows the [replacement provenance](../../docs/agents/spawn-requests.md#transitions-and-resolution) for dispatched stages. These operations retain the same saved workflow input and version compatibility contract.

The driver reacquires unfinished unassigned driver-handled visits under its current identity, preserving other identities and human/HITL reservations. Closed visits with saved results are collected once. Bee-dispatched workers keep their stage claims; neither handoff nor retry reassigns the whole hierarchy.
