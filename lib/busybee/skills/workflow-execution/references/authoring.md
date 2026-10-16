# Authoring workflow definitions

Busy Bee executes workflow definitions as trusted Bun modules. Follow [checkout preparation](../SKILL.md#select-the-run) before validation.

## Define and discover

Store named definitions in `.workflows/<name>/` in the application's Git checkout. Names begin with a lowercase letter and contain lowercase alphanumeric segments separated by hyphens. Add `busybee.toml`:

```toml
description = "Complete and verify the requested work"
version = "1.0.0"
run = "./workflow.ts"
```

Use a full SemVer version and a relative `.ts` or `.js` entry inside the folder. Keep generated output outside the definition folder; `node_modules` trees are excluded from fingerprints. `busybee list` reads manifests without importing code. `input-schema NAME --json` imports the selected definition. Explicit modules use `input-schema --source PATH` and `start PATH --parent WORK_ID --owner HUMAN`.

Export `machine`, `inputSchema`, `runBrief(input)` returning `{title, description}`, and `commandSchemas` mapping outcome names to Zod payload schemas. An optional `resumeSchema` checks persisted root context during preflight, not ordinary resume. Optional `validateCommand(entry, command, data)` rejects context-dependent invalid outcomes; `inputConstraints` and `describe(entry)` expose additional discovery guidance.

A minimal module:

```ts
import { createMachine } from "xstate";
import { z } from "zod";

export const inputSchema = z.object({});
export const commandSchemas = { next: z.object({}) };
export function runBrief() {
	return { title: "Complete work", description: "Deliver and verify the requested change" };
}
export const machine = createMachine({
	id: "work",
	initial: "implement",
	states: {
		implement: {
			meta: {
				title: "Implement and verify",
				commands: { next: "NEXT" },
				task: () => ({
					instructions: "Implement the requested change and run the application's required checks.",
				}),
			},
			on: { NEXT: "done" },
		},
		done: { type: "final" },
	},
});
```

Each non-final state with `meta.title` creates a visit bead and supplies `meta.task({context})`. Worker states map outcomes to events in `meta.commands`; containers omit commands and final states create no work. The task callback renders instructions and optional metadata overrides once per published visit. It may return `bee: {kind: "worker"}` to request Bee dispatch; choose an available kind through `bee kinds`. Driver-handled tasks omit `bee`. Dispatch requires Bee and an awake Colony configured by the application.

Keep task callbacks focused on the application's work. Busy Bee appends result discovery, delivery and closure instructions to each generated brief. Workflow actions, callbacks and imports must keep stdout/stderr clear and avoid external effects; workers perform the real work. Busy Bee performs native publication after chart advancement.

For spawned actors, set input/context `group` to the containing state node ID and retain actor references in `workers`. Keep other exposed context JSON-serializable. Use distinct events for parallel branches so one worker's outcome cannot accidentally advance another branch. Sequential stages are siblings; nested stages belong to their containing group.

## Validate and evolve

Run `busybee validate PATH --input-file INPUT.json --json` before creating work. It checks input, definition resolution and the pure initial transition without a tracker or native writes. Imports and initialization calculations still execute trusted code. Success proves initialization only: exercise representative outcomes, branches, joins and loops separately, and inspect rendered briefs and schemas through `show` and `discover` in a disposable tracker.

Before updating a named definition with unfinished runs, run `busybee preflight NAME --json` against the selected tracker and proposed checkout. `--source PATH` checks a proposed module but leaves manifest compatibility unchecked. Preflight examines snapshot restoration, active states, frozen command mappings and current task rendering. `resumeSchema` additionally checks raw persisted root context without migrating it. Future paths, child-context schemas and external effects remain unproved; an `unchecked` report is not a complete compatibility guarantee.

Compatible named versions must preserve saved state IDs, actor routes, context, frozen outcomes and completed-work meaning. Current versions must be equal or newer within the saved caret range: `1.2.3` allows newer `1.x`, `0.2.3` allows newer `0.2.x`, and `0.0.3` allows only itself. Prereleases require exact SemVer equality. A successful mutation saves the current version. Use a version outside that range when contracts break; a newly mandatory prerequisite before already-completed work cannot be enforced by restoring an old snapshot.

Explicit-file runs reject changes to the entry file's own bytes. Named fingerprints record provenance, including the shared `.workflows` package manifest and lockfiles, rather than deciding compatibility. Neither fingerprint verifies installed dependency contents or external imports. Keep evidence and recovery decisions explicit when an existing run cannot resume. Checkpoint format versions are separate from workflow versions and have no automatic migration.
