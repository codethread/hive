# Busy Bee

Busy Bee runs agent workflows on native Beads. XState charts choose the current tasks; agents do the work, close their task beads and submit results. Sequential stages are siblings, nested states create parent-child groups, and parallel work joins before the next stage.

[Specification](./SPEC.md) · [Agent walkthrough](./POV.md)

## Install or invoke

From a Hive checkout, install dependencies and invoke the CLI directly:

```sh
bun install
bun run --silent busybee --help
```

To use `busybee` from other repositories, link this checkout's package bin:

```sh
bun link --cwd lib/busybee
export PATH="${BUN_INSTALL:-$HOME/.bun}/bin:$PATH"
busybee --help
```

Keep the linked checkout and its installed dependencies available. This is a local workspace package, not a registry installation. Native `br` must be on `PATH`; automatic tasks also need the public `bee` executable.

## Repository catalogue

Store each definition at the caller repository root in `.workflows/<name>/`, independently of where Busy Bee is installed. Names use lowercase letters, digits and hyphens, beginning with a letter. For example, save the [groceries definition](./examples/groceries/workflow.ts) as `.workflows/groceries/workflow.ts` beside this `busybee.toml`:

```toml
description = "Prepare a weekly meal plan and grocery list"
version = "1"
run = "./workflow.ts"
```

`description` and `run` are required; `version` is optional descriptive text. The entry may have any relative `.js` or `.ts` filename within that folder, with helpers beside it. From the repository or any nested directory:

```sh
busybee list
busybee list --json
busybee input-schema groceries --json
export BD_ACTOR=codex
busybee run groceries --owner ct --json
```

Use `--repo PATH` to select another checkout. Discovery asks Git for that checkout's root, independently of the tracker database. `list` parses metadata without importing entry code and needs no database or actor; an absent `.workflows` directory produces an empty list. Malformed definitions fail visibly. `input-schema NAME` imports the selected trusted definition to inspect its initial Zod schema; it also needs no database or actor. The source files are trusted Bun code, not sandboxed data.

Named runs resolve their saved catalogue name in the current invocation's checkout. Busy Bee fingerprints the definition folder's regular files, including manifest and helpers, and rejects a mismatch before importing it on restore. Keep generated outputs outside the folder. With the same files, a run can resume from another checkout using the same Beads database even after the original worktree is gone. External imports and installed packages are outside this fingerprint. Resuming after definition changes is unsupported and has no migration or compatibility promise; the mismatch check does not establish general change detection.

## Start and navigate

Run from the repository where you already use `br`; Busy Bee defaults to that directory. Native `br where` selects the database using `BEADS_DB` (including an existing mise environment) or repository discovery. `--db` overrides that selection; `--repo` targets another execution directory. Busy Bee does not read mise configuration itself or derive the execution directory from the database path. Use a disposable repository while exploring.

```sh
REPO=/absolute/path/to/repository
DB="$REPO/.beads/beads.db"
export BD_ACTOR=codex
bun run --silent busybee --repo "$REPO" --db "$DB" \
  start lib/busybee/examples/parallel/workflow.ts --owner ct --json
```

The explicit-path `start` command is also supported for authoring and testing without a catalogue manifest. This example needs no initial input. The response supplies a run `id`, its `active` tasks and their bead IDs, `created` visit records, and XState `status`. Use the returned IDs:

```sh
RUN=example-run-id
TASK=example-active-task-id
bun run --silent busybee --repo "$REPO" --db "$DB" show "$RUN" --json
bun run --silent busybee --repo "$REPO" --db "$DB" discover "$RUN"
br show "$TASK" --db "$DB" --json
# Perform the task, finish its children and satisfy its native acceptance gates.
br close "$TASK" --db "$DB" --actor codex --reason "Completed: work and verification recorded."
bun run --silent busybee --repo "$REPO" --db "$DB" next "$RUN" "$TASK" --json
```

An empty-object command schema needs no `--data`. A choice with structured input uses `choice RUN TASK CHOICE --data '{"field":"value"}'` or `--data-file /absolute/path/result.json`. Do not supply both. A task stays active after native closure until Busy Bee accepts its result. Workers leave grouping and run beads open; Busy Bee closes those after processing results. Native Beads owns child-completion and acceptance gates.

| Command | Result |
| --- | --- |
| `list` | Repository catalogue metadata without evaluating workflow code |
| `run NAME --owner HUMAN [--input-file FILE]` | Start a named catalogue definition |
| `input-schema NAME` | Initial input schema before a named run exists |
| `input-schema --source PATH` | Inspect an explicit source module for authoring |
| `start SOURCE --owner HUMAN [--input-file FILE]` | Create a run; omitted input means `{}` |
| `validate PATH [--input-file FILE]` | Resolve a definition, parse initial input and calculate its initial snapshot without native writes |
| `show RUN` | Current tasks and visit records |
| `discover RUN` | Legal choices, authoritative JSON schemas and workflow-specific constraints |
| `next RUN TASK` | Submit the task's `next` command |
| `choice RUN TASK CHOICE` | Submit a named command |
| `collect RUN` | Consume results from closed automatic tasks |

Commands accept optional `--repo` and `--db` overrides. `list`, `input-schema` and `validate` need no database or actor. Discovery is readable by default. Other successful commands print the run as JSON. With `--json`, every command prints exactly one stdout document: `{ "ok": true, "kind": "show", ... }` on success or `{ "ok": false, "kind": "show", "reason": "command_failed", "message": "...", "target": "..." }` on failure. `kind` names the command (`cli` for parsing failures), stderr stays silent and failure exits nonzero. `show` and discovery are read-only snapshots, not reservations.

## Validate a definition

Run `busybee validate PATH --json` before creating a run. `--input-file FILE` supplies initial input; omission supplies `{}`. Validation imports the trusted module, parses that input through its schema, resolves `machine.definition`, and computes XState's pure initial transition. An error snapshot fails. It does not start a live actor, select a tracker or create beads.

Success covers definition resolution, the supplied input and the initial snapshot only. It does not prove every path, guard outcome or action implementation. Module imports, context initializers, assign calculations and guards remain trusted executable code and can perform their own I/O. XState entry effects are not started by validation.

## Identity

Mutations require `--actor` or `BD_ACTOR`; an explicit flag wins. This identifies the auditing agent and never falls back to the human shell `USER`. Read-only commands need no actor. Native attribution environment such as `BR_AGENT_NAME`, `BR_HARNESS` and `BR_MODEL` passes through to `br`.

Starting a run also requires `--owner` for the accountable human. Optional `-a`/`--assignee` selects the initiating agent assignment; it defaults to the starting actor. These are native create fields, with no invented owner or assignee environment variable. Later task creation inherits owner and assignment from the native run bead even when another actor submits a result. The run and manual worker tasks are assigned; grouping containers and the system checkpoint are unassigned. Bee tasks remain unassigned for Colony to claim. The checkpoint still has the human owner and normal audit attribution.

## Examples

| Definition | Demonstrates |
| --- | --- |
| [Parallel work](./examples/parallel/workflow.ts) | No-input sequence, nested documentation/API groups, independent progress, joins and fresh loop visits |
| [Groceries](./examples/groceries/workflow.ts) | Non-coding work, context, guards, branching and replanning; `busy`/`flexible` accept a positive integer `meals` |
| [Change review](./examples/change-review/workflow.ts) | Planner-authored briefs, dynamic reviewer actors, revision-aware results, repair/replan and optional Bee execution |

To prepare a real disposable change and stop at its first planner task:

```sh
bun lib/busybee/examples/change-review/demo.ts --owner ct --actor codex
```

The demo prints `repo`, `db`, `inputFile` and `run`; it neither supplies review answers nor repairs the example. To review your own change, inspect its input schema and supply `title`, `request`, full base commit `base`, and `execution: {"mode":"manual"}` in an input file. Start the definition with that file. A planner's `planned` result supplies a revision fingerprint, summary and concrete review tasks. Reviewers return `approved` or `changes`; findings lead to one `repaired` task and another planning round. Discovery shows the exact schemas. Revision fingerprints are supplied by agents, not independently calculated by Busy Bee.

For automatic tasks, select `execution: {"mode":"bee","kind":"worker"}` using a kind in the selected repository's `bees.toml`. Entering a task immediately submits a native Bee request. An awake Colony executes it through the existing [Bee and Colony interface](../colony/README.md). Each worker records a JSON result containing `choice` in its task's notes and closes the task. `collect RUN` processes those closed tasks; manual `next`/`choice` do not advance automatic tasks. A closed review may request changes: closure means work finished, while the result selects the next stage.

## Author a definition

Export these from a JavaScript or TypeScript module:

- `machine`: an XState v5 machine. Pure chart actions own transitions and context; Busy Bee publishes native effects after advancement.
- `inputSchema`: the Zod schema for initial actor input.
- `runBrief(input)`: return `{title, description}` for the readable run bead.
- `commandSchemas`: map each command name to its authoritative Zod payload schema. Use `z.object({})` when no payload is needed. Outcome names such as `show`, `collect` and `initialize` remain valid author choices; runner operations are distinct.
- Optional `validateCommand(entry, command, data)`: check context-dependent constraints after schema parsing; throw to reject a submission.
- Optional `inputConstraints` and `describe(entry)`: readable initial constraints and per-task discovery fields, such as `constraints` or an assigned `revision`.

A bead-bearing state declares `meta.title` and `meta.instructions`. Worker states also map `meta.commands` names to XState event names. Containers have no commands. Final states mark completion and never create worker beads, even when they carry titles. `meta.task({context})` may render title, instructions and optional `bee: {kind}` when a visit is created; the resolved brief remains stable throughout that visit. Only currently active work is created. Accepted worker completion retires its visit even when a self-transition returns to the same state; untouched parallel tasks retain their beads and briefs. Projection observes published frontiers, not every internal XState microstep. Unsubmitted siblings or containers that leave and re-enter within one macrostep may retain their visit. Branch-specific events prevent one parallel branch's `next` from advancing another.

Spawned actors set their input/context `group` to the containing state node ID. The examples use `workers` for actor references; Busy Bee excludes that field from exposed task context. It persists XState's deep actor snapshot, including child state. Keep other exposed context JSON-serializable. Workflow modules and callbacks must leave stdout and stderr to Busy Bee so the CLI can preserve its output contract. They run as trusted Bun code; this rule does not sandbox or prevent other I/O.

The package exports `startNamed(name, options)`, `start(source, options)`, `navigate({operation: "submit", id, bead, choice, data?}, options)` (or `{operation: "show" | "collect", id}`) and `discover(run, options)` from [runtime.ts](./src/runtime.ts). Options accept `repo`, `db`, `inputFile`, `actor`, `owner` and `assignee`; omitted repository/database options use the same native selection as the CLI. These return plain result objects; the [CLI](./src/cli.ts) adds the terminal envelope.

## Checkpoint and failure boundary

The readable run and task beads are separate from a related bead labelled `system` and `busybee-checkpoint`. That bead's description holds the checkpoint and its notes hold a lock UUID and diagnostic PID. A nonblocking `related` edge connects it to the run.

Each mutation acquires a native `br update --if-unchanged` lock, reads fresh state, validates the whole submission batch, advances the actors, publishes task/Bee effects and state, then releases ownership conditionally. Agent work runs outside this short lock. Contenders poll for up to ten seconds and never steal ownership. Every writer must share one live database; synchronized copies do not form a distributed lock.

Invalid input, unclosed tasks and invalid results fail before publication. A transition creating work beneath an existing closed parent, including the workflow run, is rejected; model nested work with an open grouping state. Read and rendering failures before a native write release the lock. Once a native write is attempted, an uncertain failure retains the lock for inspection. There is no automatic expiry, partial-effect retry or recovery. Initialization can leave orphan records, and later failures can leave partially created tasks or requests. Inspect the native records and owner before explicit recovery; a PID alone is not proof that its process is still the same owner. Prefer a fresh run after uncertain effects. Resuming after source changes is unsupported; named runs check their definition folder, while explicit-path runs checksum only the entry file. Neither covers external imports or dependencies. Multi-write effects are not transactional.
