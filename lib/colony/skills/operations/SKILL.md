---
name: operations
description: Use Colony to inspect scheduling and execution, operate repository colonies, or diagnose stalled Bee requests.
---

Operate Colony within the application's repository policy and the user's authorized scope. Repository conventions and verification commands remain authoritative. Read `colony --help` and relevant subcommand help before changing runtime state.

## Select the authority

Keep three selections explicit: `--repo` discovers the canonical repository, `--beads-db` (or `BEADS_DB`) selects native task/request authority, and `--state` selects the server's private runtime state. Use subcommand help for endpoint defaults and socket selection.

The recipe's execution directory is separate from all three. Canonical `.hive/bees.toml` and `.hive/bees/` supply role defaults and policy. Changing kind defaults does not rewrite existing captured recipes; the active formula controls how an attempt invokes its harness.

## Diagnose before changing state

1. Read `bee status REQUEST --repo REPOSITORY --beads-db DATABASE --json` for native request/task facts. It needs no daemon or configuration and retains timestamped last observations.
2. Read `colony explain REQUEST --repo REPOSITORY --beads-db DATABASE --state STATE --json` for eligibility, capacity, checkpoint and verified process evidence. It does not wake, claim, reconcile or repair. `ok: true` means the report was produced; inspect unavailable sources and freshness, not just that flag.
3. Use `colony daemon status --state STATE` or `colony list --state STATE` for the selected running server and colony policy. Use `colony inspect --repo REPOSITORY --beads-db DATABASE --state STATE` for retained attempts and paths. Inspection time is not checkpoint reconciliation time.
4. For recorded failures, read `colony events --repo REPOSITORY --beads-db DATABASE --state STATE --request REQUEST --failures`. It reads retained private history offline. Historical checkpoints, old observations and closed requests do not establish live process state or successful work.

```text
Evidence
  |
  +-- unavailable/disagrees --> retain uncertainty; inspect the reported source
  +-- waiting for capacity --> inspect limits and retained occupancy
  +-- asleep/failed -------> resolve cause, then authorized wake
  +-- work complete -------> verify native acceptance and execution settlement
```

## Control scheduling deliberately

`colony add` registers a repository without waking its scheduling loop. `colony wake` registers and wakes it, reloads canonical policy, and can start an absent daemon. `--temp` limits activation to that daemon lifetime. Both commands require the intended repository/tracker and server selection.

`colony sleep` drains the scheduling pass and pauses polling/reconciliation. `colony remove` removes registration while retaining attempts. `colony daemon stop` stops the selected server. All leave detached workers alive. To cancel a request, use `bee stop REQUEST` while the owning Colony is awake, then verify owned execution has stopped before cleanup. Stopping a workflow driver leaves independent stage workers and the run available for continuation.

Before changing capacity/formulas or recovering failed execution, read [policy and recovery](references/recovery.md) with `colony skills file operations references/recovery.md`.
