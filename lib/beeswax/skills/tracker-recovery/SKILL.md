---
name: tracker-recovery
description: Respond to a Beeswax tracker alert, failed alert check or synchronization failure; wait for verified clearance or carry out explicitly user-authorized recovery.
---

Pre-publication `tracker_busy` alone is [contention, not an incident](../repository-setup/references/publication.md#publication-contention); preserve any existing hold. Read that guidance offline with `beeswax skills file repository-setup references/publication.md`.

For tracker alerts, failed alert checks or other synchronization failures, pause ordinary tracker operations, Beads workflows and merges involving the affected tracker. Independent non-Beads work may continue. Observers must not run native `br` commands, including reads: automatic import/export can write unreconciled state. Preserve the selected `BEADS_DB`, actor, incident ID and failure output outside the affected tracker.

```text
Alert, failed alert check or synchronization failure
  |
  +-- Observer --------------------> recheck; retain any known hold
  |
  +-- Explicit recovery authority -> pause writers, preserve evidence, reconcile
```

## Observe and wait

Use the independent alert receipt, without opening SQLite or invoking native `br`. Pass the known database path explicitly; consult each command's `--help` for options:

```sh
beeswax beads alert status --beads-db "$BEADS_DB" --json
beeswax beads alert wait --beads-db "$BEADS_DB" --timeout 60 --json
```

A wait returns an observation on receipt change or timeout. Inspect that observation: command success or elapsed time alone proves neither safety nor clearance.

- **Active incident:** retain the endpoint, incident ID and generation. Poll or run bounded waits in the background while doing independent work.
- **Known hold:** an active alert, hold handoff or observed sync failure other than `tracker_busy` establishes a hold. Resume only after observing `cleared` for the same endpoint, incident and generation, or a strictly newer generation with recorded clearance evidence. Then stop polling this incident, announce clearance once and resume the affected work. Failed checks, missing state (`alert: null`) or lost session state never erase a known hold.
- **No known hold:** a healthy check of the selected endpoint showing a historical `cleared` receipt or `alert: null` ends checking. Resume baseline work without announcing clearance or investigating historical recovery evidence.
- **Failed observation:** keep work paused and resolve the check error before rechecking. The failure does not establish a new incident or release a known hold. An unselected endpoint or silence is not a healthy check; a successful status read does not resolve a separately reported check error.

Receipts survive session restarts in user-local state keyed by the selected database path; they are not distributed across users, clones or hosts. Coordinate those participants and running writers explicitly: an alert does not stop them or guarantee they have seen it.

## Recover with authority

`beeswax beads recover --beads-db "$BEADS_DB"` prints a non-mutating incident handoff. Native tracker inspection or recovery requires explicit user authorization for the endpoint and incident; a fresh session alone grants none. Existing authorization remains valid within its agreed scope.

Once authorized, read [manual recovery](references/manual-recovery.md), available offline through `beeswax skills file tracker-recovery references/manual-recovery.md`. Complete its evidence and quiescence checks before changing tracker state. Ordinary observers remain on the waiting path.
