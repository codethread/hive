# Authoring Busy Bee workflows

Keep task meaning beside the chart structure so a reader can inspect both in source and a visualizer. XState owns transitions and context; Busy Bee turns active states into Beads tasks. The [specification](../lib/busybee/SPEC.md) explains execution semantics, and the [user guide](../lib/busybee/README.md) covers running workflows.

## Definition contract

Export the following from a JavaScript or TypeScript module:

| Export | Contract |
| --- | --- |
| `machine` | XState v5 machine with pure workflow actions; Busy Bee publishes native effects after advancement |
| `inputSchema` | Zod schema for creation input only; not used to validate persisted context on resume |
| `resumeSchema` (optional) | Zod schema for persisted root actor context, checked by preflight |
| `runBrief(input)` | Returns `{title, description}` for the run bead |
| `commandSchemas` | Maps outcome names to Zod payload schemas; use `z.object({})` for no payload |
| `validateCommand(entry, command, data)` (optional) | Checks context-dependent constraints after schema parsing; throws to reject |
| `inputConstraints` (optional) | Readable initial-input constraints |
| `describe(entry)` (optional) | Adds per-task discovery fields, such as constraints or an assigned revision |

[definition.ts](../lib/busybee/src/definition.ts) defines the types and boundary schemas. For library callers, `@hive/busybee` exports the operations in [runtime.ts](../lib/busybee/src/runtime.ts); these return plain result objects, and the CLI adds the terminal envelope. Root creation through `start` or `startNamed` requires `options.parent` naming existing nonclosed ordinary work in the selected tracker, separately from definition input. Nested actors use their containing group; they do not initialize another root run. Bee transports the parent separately from initial input. Definitions own run titles through `runBrief`; the default `do-work` author uses `Do work: <title>` for the run and the caller title for its work stage. Other definitions keep their own title and assignment rendering.

A non-final state with `meta.title` creates a bead. Every such state supplies `meta.task({context})`, returning instructions and optional metadata overrides such as title or `bee: {kind}`. Worker states map outcome names to events in `meta.commands`; containers omit commands. Final states create no worker beads, even when titled. Runner command names such as `show` and `collect` are valid author outcomes too.

Creation provenance and dispatch are separate. Generated worker visits are workflow auto beads whether driver-handled (no `bee`) or Bee-dispatched (`bee: {kind}`). Agent-created supporting work is manual even when nested beneath the run; parent-child links alone do not establish workflow generation. The related workflow system bead stores the run's checkpoint. See the [shared vocabulary](../GLOSSARY.md#workflows).

Spawned actors set their input/context `group` to the containing state node ID. Keep actor references in `workers`, which Busy Bee excludes from task context; keep other exposed context JSON-serializable. Persistence includes child-actor state. Use branch-specific events so one parallel worker's `next` does not advance another branch.

Workflow modules and callbacks must leave stdout and stderr to Busy Bee. They execute as trusted Bun code, without an I/O sandbox.

## Repository catalogue

Store each workflow at `.workflows/<name>/busybee.toml` in the caller's Git checkout. Names are lowercase alphanumeric segments separated by hyphens, starting with a letter.

```toml
description = "Prepare a weekly meal plan and grocery list"
version = "1.0.0"
run = "./workflow.ts"
```

`description`, `version` and `run` are required. `version` must be a full SemVer such as `1.0.0` or `1.1.0-beta.1`, not `1`, `1.0` or a range. It declares compatibility with saved runs as described below. The entry must be a relative `.js` or `.ts` path within the folder. Keep local helpers beside it and generated outputs elsewhere: Busy Bee fingerprints the folder's regular files as provenance. External imports and installed packages are outside that hash.

`list` reads manifests without evaluating workflow code; a missing `.workflows` directory yields an empty catalogue, while malformed entries fail. `run NAME` and `input-schema NAME` resolve entries from the current checkout, including nested callers or `--repo`. Use `start PATH` and `input-schema --source PATH` when working without a manifest.

## Version saved workflow contracts

A named run saves its manifest version. Resume accepts the current version only when it is equal to or newer than the saved version within the saved version's caret range. This direction matters: a run saved by `1.3.0` cannot resume with `1.2.0`.

| Saved version  | Allowed current versions               | Rejected examples       |
| -------------- | -------------------------------------- | ----------------------- |
| `1.2.3`        | `1.2.3` through versions below `2.0.0` | `1.2.2`, `2.0.0`        |
| `0.2.3`        | `0.2.3` through versions below `0.3.0` | `0.2.2`, `0.3.0`        |
| `0.0.3`        | `0.0.3` only                           | `0.0.2`, `0.0.4`        |
| `1.2.3-beta.1` | Exact same version only                | `1.2.3-beta.2`, `1.2.3` |

If either version is a prerelease, exact SemVer equality is required; build metadata does not affect equality or precedence. After a successful mutation, the checkpoint saves the current manifest version, so later restores compare against that version. Read-only inspection does not persist a version update. The named folder hash records the source that produced the latest saved checkpoint; a changed hash does not refuse a compatible version. Explicit-file runs have no manifest compatibility promise and refuse changed entry-file hashes before import. Neither mechanism checks installed dependencies or external imports.

Within a compatible release, preserve the contracts already stored by a run:

- Keep state node IDs and child actor routes restorable. Renaming or removing states referenced by saved snapshots can break restoration.
- Keep persisted context understandable by guards, actions and render callbacks. Initial input parsing does not recreate or upgrade context on resume.
- Preserve active visits' frozen command names, their event mappings and accepted payload meaning. Published briefs stay fixed even if the renderer changes for future visits.
- Preserve completed work's meaning. A new mandatory prerequisite inserted before work already completed cannot be enforced by restoring that snapshot; it breaks compatibility.

For versions at or above `1.0.0`, use a major bump when these contracts break. Before `1.0.0`, cross the caret boundary (`0.2.x` to `0.3.0`, or `0.0.3` to `0.0.4`). A patch can fix instructions or computation while preserving these contracts; a minor can add compatible future work or choices without changing frozen active commands. The version is an author's promise, not an engine proof.

For example, suppose the old chart is `prepare -> review -> publish`, and a saved run is active at the stable `review` state. An optional summary step can be inserted on either side:

| Candidate chart | What the restored run does |
| --- | --- |
| `prepare -> summary -> review -> publish` | Resumes at `review`; skips the new earlier `summary` |
| `prepare -> review -> summary -> publish` | Resumes at `review`; visits the new later `summary` after its outcome |

Both can be compatible when the summary is optional for existing runs, state IDs/context remain valid and `review` keeps its frozen commands. A run already at `publish` skips either insertion. If the summary is mandatory before publishing, that run cannot satisfy the new requirement through ordinary resume; choose an incompatible version and regenerate from current evidence. Restoring a snapshot does not replay newly inserted earlier states or validate every possible saved position.

## Preflight existing runs

Use the proposed checkout's manifest and module, or check an explicit proposed module independently of the catalogue:

```sh
busybee preflight groceries --json
busybee --repo /path/to/candidate-checkout --db /path/to/beads.db preflight groceries --json
busybee preflight groceries --source /path/to/proposed-workflow.ts --json
```

With `--source`, no manifest version is inferred from a different module: version compatibility is explicitly unchecked, and the saved name need not exist in the current catalogue. To check both version and structure, use `--repo` with the proposed manifest and entry.

Preflight reads existing unfinished runs of the named workflow from the selected tracker. It checks version compatibility, restores snapshots without starting actors, checks active state IDs/actor paths and frozen command mappings, and renders current-frontier tasks against the candidate. Findings are reported per run as `passed`, `failed` or `unchecked`. The report's status is `incompatible` if a check fails, otherwise `unchecked` because future execution remains unproved. Incompatibility exits nonzero and retains the full JSON report with `ok: false`, `reason: "preflight_incompatible"` and a summary `message`; an `unchecked` report exits zero without claiming complete compatibility. A tracker containing no matching unfinished runs supplies no saved-run compatibility evidence.

Export `resumeSchema` when the workflow has persisted-context requirements. `inputSchema` validates creation input only; actor context may contain accumulated decisions and differ from that input. Preflight applies `resumeSchema` to the raw persisted root context before XState revives actor references. Child contexts can have different shapes; preflight restores child actors and checks their active paths and task rendering, but this schema does not validate their contexts. Frozen task-facing context excludes actor references in `workers`; the persisted root context retains XState’s serialized references. Keep other exposed fields JSON-serializable. Schema parsing checks compatibility without replacing stored context with parsed/transformed output. Normal resume does not run `resumeSchema` automatically.

For example, require a branch that existing root contexts must already contain:

```ts
export const resumeSchema = z.compile(z.looseObject({ branch: z.string().min(1) }));
```

Keep this schema at module scope and compile the final schema after refinements. A default or transformation cannot supply missing persisted data: preflight reports that conversion is required rather than migrating a run. Adding a newly required branch to a workflow whose saved contexts lack it needs an incompatible version and a fresh run.

Without `resumeSchema`, the report explicitly leaves context validation unchecked. Even with it, a passing schema and successful rendering do not prove future guard/action paths, all future payload semantics or external effects. An author helper that restores and renders representative snapshots is useful evidence, not proof for every future path. Exercise meaningful saved positions and outcomes separately, including runs past any inserted step.

The engine performs no writes, acquires no mutation reservation, starts no actors and creates no Bee requests during preflight. Definition imports, schema checks and render callbacks still execute trusted author code. Keep them pure; preflight is not a sandbox and cannot prevent their own I/O. It reports a momentary inspection, not a reservation against concurrent mutations.

Checkpoint storage has a separate engine `formatVersion: 1`; changing workflow SemVer does not change or upgrade that format. Busy Bee validates the small checkpoint header and trusts its own stored body. Missing, old or unknown formats reject with regenerate guidance and have no migration. For incompatible known names, preserve authorization and evidence and start a fresh same-scope run; for a missing name, stop and ask which workflow to use. See [resume and failures](../lib/busybee/README.md#resume-and-failures).

## Keep the chart inspectable

Declare hierarchy, initial/final states, events, targets and conditions directly in the machine configuration. Use named guards and actions in `setup` for computations, with meaningful references on transitions.

Write literal `meta` objects with `title` first, followed by the worker's commands and task callback. Author instructions once, inside an inline arrow callback returning an object:

```ts
review: {
	meta: {
		title: "Review change",
		commands: { approved: "APPROVED", revise: "REVISE" },
		task: () => ({
			instructions: "Review the change. Choose revise when findings need repair.",
		}),
	},
	on: { APPROVED: "done", REVISE: "repair" },
},
```

The enclosing machine supplies `done` and `repair`; `commandSchemas` supplies both result schemas. See the [parallel example](../lib/busybee/examples/parallel/workflow.ts) for a complete definition.

Use the same callback form for context-dependent briefs:

```ts
task: ({ context }: { context: ReviewContext }) => ({
	instructions: `Review revision ${context.revision}. Record evidence for each finding.`,
}),
```

Here `ReviewContext` contains `revision`. Put any title override first in the returned object. Busy Bee calls `task` once per published visit and freezes its brief; the callback renders instructions, not work or transitions. Check interpolated values with `busybee show RUN`.

A helper can produce the same runtime machine while hiding its meaning from a source extractor. In the land workflow, Stately exposed an inline arrow's returned fields and instruction template, while a `landingTask(...)` helper or block-bodied function appeared as an opaque reference. Keep chart structure and task meaning explicit by default. Extract a helper only when hiding those details is deliberate, document the reason near the call, and verify the intended visualizer. A duplicate static instructions field is unnecessary.

Keep related machines together or split them according to readability. The [change-review example](../lib/busybee/examples/change-review/workflow.ts) keeps its parent and reviewer machines together.

## Open the visualizer

The [Stately CLI](https://stately.ai/docs/packages/cli) opens local machine files in a browser:

```sh
npx statelyai open './lib/busybee/examples/change-review/workflow.ts'
```

Absolute paths work too. For files containing several machines, expand the initially collapsed workspace sidebar and select each machine.

In VS Code, install [Stately Editor](https://marketplace.visualstudio.com/items?itemName=statelyai.stately-editor) (`statelyai.stately-editor`, distinct from the older `statelyai.stately-vscode`). Open the source and run `Stately: Open Visual Editor`, or use a machine's `Open Visual Editor` CodeLens. Saving source refreshes the editor. Stately MCP also supports inspection from an agent session.

## Validate a definition

```sh
busybee validate .workflows/groceries/workflow.ts --json
```

Add `--input-file FILE` when initialization requires values; omission supplies `{}`. Validation imports the module, parses input, resolves `machine.definition` and computes XState's pure initial transition, rejecting error snapshots. It needs no tracker, performs no native writes and starts no live actor or XState entry effects. Imports, context initializers, assignments and guards still execute trusted author code.

Success proves initialization only. Exercise representative paths and outcomes separately. For authoring or refactoring, also inspect every machine's states, transitions and metadata in the intended visualizer. When extracting helpers or changing callbacks, compare visible metadata and resolved task output as well as the diagram.
