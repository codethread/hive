---
name: operations
description: Configure Bee kinds, operate Colony scheduling, diagnose stalled requests and change execution capacity or policy.
---

Follow application policy and the user's authorized scope. Read `colony --help` and focused command help before changing runtime state.

## Select the authority

Keep three selections explicit: `--repo` discovers the canonical repository, `--beads-db` (or `BEADS_DB`) selects native task/request authority, and `--state` selects the server's private runtime state. Use subcommand help for endpoint defaults and socket selection.

Repositories normally share the default daemon. Choosing another `--state` directory selects separate daemon membership and execution history; use it deliberately for isolation and retain that selection for later controls and diagnosis.

The recipe's execution directory is separate from all three. Canonical `.hive/bees.toml` and `.hive/bees/` supply kind defaults and policy.

Before configuring kinds or harness templates, or verifying a first execution, read [kind and harness configuration](references/configuration.md) with `colony skills file operations references/configuration.md`.

For the attention query and BV views, follow `bee setup --help`. That setup operation requires this repository's permanent `tracker/state` database; other Bee operations keep their general selected-database contract.

## Diagnose stalled execution

1. Use `bee status REQUEST --json` for native request/task facts and timestamped last observations.
2. Use `colony explain REQUEST --json` with the same repository/tracker and selected server for eligibility, capacity, checkpoint and process evidence. It observes without repairing. Inspect source availability and freshness; `ok: true` only means the report was produced.
3. Follow `colony inspect --help` for retained attempts and paths, or `colony events --help` for recorded failures. Inspection time is not reconciliation time. Historical records and request closure do not establish live process state or successful work.

```text
Evidence
  |
  +-- unavailable/disagrees --> retain uncertainty; inspect the reported source
  +-- waiting for capacity --> inspect limits and retained occupancy
  +-- asleep/failed -------> resolve cause, then authorized wake
  +-- work complete -------> verify native acceptance and execution settlement
```

## Control scheduling deliberately

Use `colony add --help` to register without scheduling, or `colony wake --help` to activate scheduling and reload canonical policy. For native startup prerequisites, runtime replacement and recovery, follow `colony daemon restart --help` with the same state/socket selection.

`sleep` and `remove` affect only the selected repository's colony. `daemon stop` stops the selected server and pauses every colony it hosts; use repository sleep when other colonies should stay awake.

Sleeping a colony, removing its registration or stopping its daemon leaves detached workers alive. To cancel work, follow `bee stop --help` with the owning Colony awake, then verify execution stopped before cleanup. Stopping a workflow driver leaves independent stage workers and the run available for continuation.

Before changing live capacity/formulas or recovering failed execution, read [policy and recovery](references/recovery.md) with `colony skills file operations references/recovery.md`.
