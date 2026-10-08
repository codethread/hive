# Authoring Busy Bee workflows

Keep task meaning beside the chart structure so a reader can inspect both in source and a visualizer. XState owns transitions and context; Busy Bee turns active states into Beads tasks. The [specification](../lib/busybee/SPEC.md) explains execution semantics, and the [user guide](../lib/busybee/README.md) covers running workflows.

## Definition contract

Export the following from a JavaScript or TypeScript module:

| Export | Contract |
| --- | --- |
| `machine` | XState v5 machine with pure workflow actions; Busy Bee publishes native effects after advancement |
| `inputSchema` | Zod schema for initial input |
| `runBrief(input)` | Returns `{title, description}` for the run bead |
| `commandSchemas` | Maps outcome names to Zod payload schemas; use `z.object({})` for no payload |
| `validateCommand(entry, command, data)` (optional) | Checks context-dependent constraints after schema parsing; throws to reject |
| `inputConstraints` (optional) | Readable initial-input constraints |
| `describe(entry)` (optional) | Adds per-task discovery fields, such as constraints or an assigned revision |

[definition.ts](../lib/busybee/src/definition.ts) defines the types and boundary schemas. For library callers, `@hive/busybee` exports the operations in [runtime.ts](../lib/busybee/src/runtime.ts); these return plain result objects, and the CLI adds the terminal envelope.

A non-final state with `meta.title` creates a bead. Every such state supplies `meta.task({context})`, returning instructions and optional metadata overrides such as title or `bee: {kind}`. Worker states map outcome names to events in `meta.commands`; containers omit commands. Final states create no worker beads, even when titled. Runner command names such as `show` and `collect` are valid author outcomes too.

Spawned actors set their input/context `group` to the containing state node ID. Keep actor references in `workers`, which Busy Bee excludes from task context; keep other exposed context JSON-serializable. Persistence includes child-actor state. Use branch-specific events so one parallel worker's `next` does not advance another branch.

Workflow modules and callbacks must leave stdout and stderr to Busy Bee. They execute as trusted Bun code, without an I/O sandbox.

## Repository catalogue

Store each workflow at `.workflows/<name>/busybee.toml` in the caller's Git checkout. Names are lowercase alphanumeric segments separated by hyphens, starting with a letter.

```toml
description = "Prepare a weekly meal plan and grocery list"
version = "1"
run = "./workflow.ts"
```

`description` and `run` are required; `version` is descriptive text, not a compatibility mechanism. The entry must be a relative `.js` or `.ts` path within the folder. Keep local helpers beside it and generated outputs elsewhere: Busy Bee fingerprints the folder's regular files. External imports and installed packages are outside that check.

`list` reads manifests without evaluating workflow code; a missing `.workflows` directory yields an empty catalogue, while malformed entries fail. `run NAME` and `input-schema NAME` resolve entries from the current checkout, including nested callers or `--repo`. Use `start PATH` and `input-schema --source PATH` when working without a manifest.

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
