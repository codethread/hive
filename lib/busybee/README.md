# Busy Bee

Busy Bee runs XState workflows as native Beads tasks. Agents do the work, close their tasks and submit outcomes; the chart decides what happens next. Workflows can branch, loop, nest tasks and join parallel work.

## Install

Requires Bun and native `br` on `PATH`. From a Hive checkout:

```sh
bun install
bun run --silent busybee --help
```

To run `busybee` from other repositories, link the local package:

```sh
bun link --cwd lib/busybee
export PATH="${BUN_INSTALL:-$HOME/.bun}/bin:$PATH"
busybee --help
```

Keep the linked checkout and its dependencies available. Automatic workers also require `bee` and an awake Colony; see [automatic tasks](#automatic-tasks).

## Run a workflow

Use a repository with an existing Beads database. Busy Bee uses the same database as `br`: `--db PATH` overrides `BEADS_DB` and native discovery. `--repo PATH` selects the working checkout independently of database storage.

Repository workflows live in `.workflows/<name>/`. To try one, copy the [groceries definition](./examples/groceries/workflow.ts) to `.workflows/groceries/workflow.ts` and add `.workflows/groceries/busybee.toml`:

```toml
description = "Prepare a weekly meal plan and grocery list"
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

| Command                      | Use                                                             |
| ---------------------------- | --------------------------------------------------------------- |
| `list`                       | List repository workflows without executing them                |
| `input-schema NAME`          | Inspect a workflow's initial input                              |
| `run NAME --owner HUMAN`     | Start a repository workflow                                     |
| `show RUN`                   | Read current tasks and visit records                            |
| `discover RUN`               | Inspect choices, payload schemas and task constraints           |
| `next RUN TASK`              | Submit the task's `next` outcome                                |
| `choice RUN TASK CHOICE`     | Submit a named outcome                                          |
| `collect RUN`                | Process closed automatic tasks                                  |
| `input-schema --source PATH` | Inspect an explicit definition file                             |
| `start PATH --owner HUMAN`   | Run a definition without a catalogue manifest                   |
| `validate PATH`              | Check a definition and its initial input without creating beads |

`run`, `start` and `validate` accept `--input-file FILE`. See `busybee --help` for options and the [authoring guide](../../docs/busybee-workflows.md) for definitions and validation limits.

`list`, `input-schema` and `validate` need no tracker or actor. `show` and `discover` are read-only snapshots, not reservations. Discovery summaries are readable by default; `--json` includes complete schemas, including nested and conditional constraints. Run commands return JSON. With `--json`, every command emits one stdout document containing `ok` and `kind`; failures add `reason`, `message` and known context, leave stderr empty and exit nonzero.

## Ownership and assignment

Mutations require `--actor` or `BD_ACTOR`; the flag takes precedence. Starting also requires `--owner` for the accountable human. `--assignee` defaults to the starting actor. Later tasks inherit the run's native owner and assignee, even when another actor submits a result.

The run and manual tasks are assigned. Grouping and checkpoint beads are unassigned; automatic tasks remain unassigned for Colony to claim. Native attribution variables such as `BR_AGENT_NAME`, `BR_HARNESS` and `BR_MODEL` pass through to `br`.

## Automatic tasks

A definition can request a Bee kind for a task. Entering that task submits a Bee request immediately; an awake Colony executes it through the [Bee and Colony interface](../colony/README.md).

The worker writes a JSON result containing `choice` and its payload fields to the task's notes, then closes the task. Run `busybee collect RUN` to process those results. Automatic tasks advance through `collect`; manual `next` and `choice` submissions are rejected. Closure means the work finished: a review result can still request changes.

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

Every outcome requires `evidence`. Before closing a worker, record that evidence in its bead notes as well as the submitted payload. `approved`, `commit` and `reviewed` additionally require a `review` receipt containing `bead`, `base` and `revision`. Landing workers require a passing `bun run check` before agent review and verify the referenced review bead records local approval for the current cumulative diff; a closed bead alone is insufficient. Busy Bee validates the payload and legal transition, **not the truth or freshness of Git/PR/review evidence**. External commands remain worker instructions, not chart side effects.

Worktree integration uses Honeycomb; PR integration uses the repository's GitHub policy, followed by Honeycomb cleanup with integration proof. Already-merged work skips merging and still verifies main, cleans up and publishes completion. Retain an unchanged definition in the surviving checkout before removing the feature checkout. The workflow finishes with tracker publication and a report; publish final run-closure bookkeeping afterward. The [land integration tests](./tests/integration/land.test.ts) cover simulated navigation and persistence, not real merges or GitHub actions.

## Resume and failures

Named runs can resume from another checkout with the same database and unchanged definition folder, even after the original worktree is removed. Keep generated files outside that folder: its manifest, entry and local helpers are fingerprinted. Explicit-path runs retain their source path and fingerprint only the entry file. Neither check covers external imports or installed dependencies. Changed-definition resumption is unsupported; start a fresh run.

Concurrent submissions require one live database. Tracker synchronization does not provide a distributed lock. Invalid submissions fail before publishing task effects. If a write has been attempted and its outcome is uncertain, Busy Bee retains the checkpoint lock for inspection. There is no automatic expiry or partial-write recovery. Inspect the reported checkpoint and native records before recovery; prefer a fresh run after uncertain effects. The [specification](./SPEC.md#checkpoint-and-failure-boundary) explains this boundary.
