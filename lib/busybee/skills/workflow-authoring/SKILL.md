---
name: workflow-authoring
description: Author or simplify Busy Bee workflow definitions, audit their instructions and evolve saved-run contracts.
---

# Author workflow definitions

Workflows enforce non-obvious process and leave an audit trail. Trust agents to plan and perform ordinary work.

- Write each step in one sentence, occasionally two; separate steps where ordering matters.
- Keep review visits, recorded outcomes and repair/review loops where handoffs need evidence.
- Delete narration of default agent behavior instead of relocating it into helpers or other guidance.
- Supply the stage's task-specific scope, constraints and evidence.
- Bee roles define remit, judgement and authority; workflows define the task's sequence. Read `bee skills get delegation` when selecting a role.

Busy Bee appends result discovery, delivery and closure instructions to generated briefs. Author only the application's work in task callbacks.

## Define the chart

Definitions are trusted Bun modules; imports must resolve in the execution checkout. Store named definitions in `.workflows/<name>/`, with lowercase alphanumeric names separated by hyphens, starting with a letter. Add `busybee.toml`:

```toml
description = "Complete and verify the requested work"
version = "1.0.0"
run = "./workflow.ts"
```

Use full SemVer and a relative `.ts` or `.js` entry inside the folder; keep generated output elsewhere. Discover command options through `busybee --help`.

Export `machine`, `inputSchema`, `runBrief(input)` returning `{title, description}`, and `commandSchemas` mapping outcome names to Zod payload schemas:

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

Non-final states with `meta.title` create beads and supply `meta.task({context})`, rendered once per visit. Workers map outcomes to events in `meta.commands`; containers omit commands and final states create no work. Return `bee: {kind}` for Bee dispatch, requiring an available kind and awake Colony; omit it for driver-handled work. Both modes complete through `complete` → `collect`; `next` in the example is an authored outcome, not a CLI entry point.

Return optional `acceptanceCriteria` from `runBrief` or `meta.task` for native checklist gates. Assign run/group verification and ticks to a reachable visit before their engine-owned closure. Busy Bee never ticks criteria; later native edits, not frozen rendering, govern completion.

Keep chart structure explicit and task callbacks inline for visualizer inspection. Actions, callbacks and imports leave stdout/stderr clear and avoid external effects; workers perform work, and Busy Bee publishes native changes after advancement.

For spawned actors, set input/context `group` to the containing state node ID and retain actor references in `workers`; keep other exposed context JSON-serializable. Give parallel branches distinct events so one outcome cannot advance another branch. Sequential stages are siblings; nested stages belong to their containing group.

Optional exports: `validateCommand(entry, command, data)` rejects context-dependent invalid outcomes; `inputConstraints` and `describe(entry)` add discovery guidance.

## Validate the experience

Use `busybee validate --help` for initialization checks. Before changing a named definition with unfinished runs, follow `busybee preflight --help`.

Exercise outcomes, branches, joins and loops in a disposable tracker. Inspect the visualizer, `busybee show RUN --instructions --json`, `busybee discover RUN --json` and native briefs alongside the Bee role; remove repeated guidance from composed instructions.

## Evolve existing runs

Compatible versions preserve saved state IDs, actor routes, context, frozen outcomes and completed-work meaning. Newly mandatory prerequisites before completed work break compatibility. Preflight checks restoration, active states, frozen commands and task rendering; optional `resumeSchema` checks raw root context without migration, only during preflight. Future paths, child-context schemas and external effects remain unproved.

Named versions must be equal or newer within the saved caret range: `1.2.3` permits newer `1.x`, `0.2.3` newer `0.2.x`, and `0.0.3` only itself; prereleases require exact SemVer equality. A successful mutation saves the current version. Cross the caret boundary when these contracts break.

Explicit-file runs reject changed entry-file bytes. Named fingerprints record provenance, including the shared `.workflows` package manifest and lockfiles; `node_modules` is excluded. Neither verifies installed dependencies or external imports. Checkpoint formats are separate from workflow versions and have no automatic migration. For the format-2 toolchain break, use matching old tools to finish old-format work or deliberately start a fresh same-name, same-scope run within existing authorization after inspecting effects and preserving evidence. A fresh run neither retires old obligations nor authorizes live cutover; a missing name requires the caller's workflow choice. Refresh custom workflow/guidance copies deliberately; replacing the executable does not update them or saved briefs.
