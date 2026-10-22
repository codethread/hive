---
name: workflow-execution
description: Run or resume Busy Bee workflows and deliver outcomes.
---

The application's instructions, domain conventions, verification commands and authorization govern the work; Busy Bee supplies orchestration. Consult `busybee --help`, then focused command help for options. Use `--json` for complete schemas and machine-readable results.

Keep Busy Bee commands alive during native tracker lock waits. Prefer asynchronous execution with polling when available; otherwise allow an outer timeout for the configured native lock wait plus command work.

For definition authoring or refactoring, read [workflow-authoring](../workflow-authoring/SKILL.md) with `busybee skills get workflow-authoring`.

## Select the run

```text
Existing run ID? -- yes --> show + discover --> continue saved visits
       |
       no
       v
list + input-schema --> run beneath existing work --> inspect visits
```

For an existing run, start with:

```sh
br show RUN --json
busybee show RUN --json
busybee discover RUN --json
```

Read the native run brief once for caller completion instructions. Read `br show TASK --json` once per active visit for its full brief, acceptance, assignment, children, blockers and delivery/closure instructions. Refresh native briefs when relevant scope, state or authority changes, or required context is missing.

Between those reads, use compact `show`/`collect` results to identify visits and dispatch requests, and `discover` for legal outcomes and payload schemas. See `show --help` for on-demand frozen instruction text. On retry, resume the supplied run and collect saved closed-stage results before doing more work.

For authorized new work, use `busybee list` and `busybee input-schema NAME --json`, then `busybee run NAME --parent WORK_ID --owner HUMAN --input-file INPUT.json --json` with matching input. Retain the run ID. When the checkout needs the bundled `do-work` definition, follow `busybee init --help` before input discovery. Existing definitions must resolve their imports in the execution checkout; `list` reads manifests without importing code.

Preserve supplied `BEADS_DB` and `BD_ACTOR`; otherwise supply your agent actor for mutations. `--db` selects the tracker independently of the `--repo` execution checkout. Human ownership and agent assignment are separate.

## Work and deliver

Classify each active visit by its dispatch request and task instructions:

- **Driver-handled:** claim an unfinished visit only when unassigned or already yours. Preserve other identities, human/HITL reservations and blockers; record the required handoff when they prevent progress.
- **Bee-dispatched:** the worker owns its stage claim. For stalled or failed execution, follow `bee status --help` using the reported request ID.

For a stage you own:

1. Satisfy acceptance and child work using the application's verification commands.
2. Follow the brief's delivery instructions; in Bee execution, `bee response --help` owns answer publication and verification. Dispatched workers deliver before stage closure.
3. Follow `busybee complete --help` to save the original outcome and close the stage.

The driver runs `busybee collect RUN --json`, then inspects newly active visits. Read `collect --help` for progression and `choice --help` for direct submission of driver-handled outcomes. Busy Bee alone closes groups and the run.

Remain running while workers are pending; waiting drivers consume ordinary quota. If limits starve workers, ask the user to raise them. Read worker answers through `bee result --help` for the final synthesis. The driver is complete when the run reports `done`, its synthesis is delivered and the run brief's caller completion instructions are satisfied. The original parent requires its own acceptance and closure authority.

In Bee execution, follow `bee finish --help` after completing your assigned run or stage, or when reporting a blocker.

## Continue safely

Inspect confirmed effects and retained IDs after any command failure; a failed response can follow partial publication. For closure refusal or interrupted completion, follow `complete --help` before retrying. If collection reports missing or invalid saved data, recover the original outcome from evidence before resubmission.

For explicitly authorized failure or cancellation of pending generated work, read `busybee settle --help`. Settlement is separate from successful completion and source acceptance; a request to resume work does not authorize retirement.

For definition restoration failures, read [saved-run compatibility](../workflow-authoring/SKILL.md#evolve-existing-runs) with `busybee skills get workflow-authoring`. Retain run/task/evidence references and follow the task's recovery authorization; retrying does not authorize a duplicate run. A missing saved name needs the caller's workflow choice. Checkpoint locks retained after uncertain writes require inspection and explicit recovery; never steal them or force-close unfinished work.
