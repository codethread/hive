---
name: workflow-execution
description: Run or resume Busy Bee workflows, deliver outcomes and author workflow definitions.
---

The application's instructions, domain conventions, verification commands and authorization govern the work; Busy Bee supplies orchestration. Consult `busybee --help`, then focused command help for options. Use `--json` for complete schemas and machine-readable results.

For definition authoring, read [authoring](references/authoring.md) with `busybee skills file workflow-execution references/authoring.md`. The execution path follows below.

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

Read each active task with `br show TASK --json` for its full brief, children, assignment and blockers. `show` identifies visits and dispatch requests; `discover` supplies legal outcomes and payload schemas. On retry, resume the supplied run and collect saved closed-stage results before doing more work.

For authorized new work, use `busybee list` and `busybee input-schema NAME --json`, then `busybee run NAME --parent WORK_ID --owner HUMAN --input-file INPUT.json --json` with matching input. Retain the run ID. When the checkout needs the bundled `do-work` definition, follow `busybee init --help` before input discovery. Existing definitions must resolve their imports in the execution checkout; `list` reads manifests without importing code.

Preserve supplied `BEADS_DB` and `BD_ACTOR`; otherwise supply your agent actor for mutations. `--db` selects the tracker independently of the `--repo` execution checkout. Human ownership and agent assignment are separate.

## Work and deliver

Classify each active visit by its dispatch request and task instructions:

- **Driver-handled:** claim an unfinished visit only when unassigned or already yours. Preserve other identities, human/HITL reservations and blockers; record the required handoff when they prevent progress.
- **Bee-dispatched:** the worker owns its stage claim. For stalled or failed execution, follow `bee status --help` using the reported request ID.

For a stage you own:

1. Satisfy acceptance and child work using the application's verification commands.
2. Follow the brief's delivery instructions; in Bee execution, `bee response --help` owns answer publication and verification. Dispatched workers deliver before stage closure.
3. Follow `busybee record-result --help` to save the original outcome before closing the stage through `br`. Narrative evidence belongs in comments; notes hold the saved result.

The driver runs `busybee collect RUN --json`, then reinspects active work. Read `collect --help` for progression and `choice --help` for direct submission of driver-handled outcomes. Busy Bee alone closes groups and the run.

Remain running while workers are pending; waiting drivers consume ordinary quota. If limits starve workers, ask the user to raise them. Read worker answers through `bee result --help` for the final synthesis. The driver is complete when the run reports `done`, its synthesis is delivered and the run brief's caller completion instructions are satisfied. The original parent requires its own acceptance and closure authority.

In Bee execution, follow `bee finish --help` after completing your assigned run or stage, or when reporting a blocker.

## Continue safely

If collection reports missing or invalid saved data, recover the original outcome from evidence before resubmission. Inspect confirmed effects and retained IDs after any command failure; a failed response can follow partial publication.

For definition restoration failures, read the compatibility rules in [authoring](references/authoring.md). Retain run/task/evidence references and follow the task's recovery authorization; retrying does not authorize a duplicate run. A missing saved name needs the caller's workflow choice. Checkpoint locks retained after uncertain writes require inspection and explicit recovery; never steal them or force-close unfinished work.
