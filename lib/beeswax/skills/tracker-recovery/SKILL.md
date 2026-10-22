---
name: tracker-recovery
description: Respond to a Beeswax tracker alert or synchronization failure; wait for verified clearance or carry out explicitly user-authorized recovery.
---

Pre-publication `tracker_busy` alone is [contention, not an incident](../repository-setup/references/publication.md#publication-contention); preserve any existing hold. Read that guidance offline with `beeswax skills file repository-setup references/publication.md`.

For tracker alerts, failed checks or other synchronization failures, stop ordinary tracker operations, Beads workflows and merges involving the affected tracker. Independent non-Beads work may continue. Preserve the selected `BEADS_DB`, actor, incident ID and failure output outside the affected tracker; creating an alert bead there can itself overwrite unreconciled JSONL changes.

```text
Alert, failed check or other synchronization failure
  |
  +-- Observer --------------------> recheck; retain any known hold
  |
  +-- Explicit recovery authority -> pause writers, preserve evidence, reconcile
```

## Observe and wait

Use `beeswax beads alert status --help` to inspect the independent receipt. Pass the known database path explicitly when repository discovery is unavailable:

```sh
beeswax beads alert status --beads-db "$BEADS_DB" --json
beeswax beads alert wait --beads-db "$BEADS_DB" --timeout 60 --json
```

Status and wait with an explicit endpoint need neither SQLite nor native `br`. Poll or run bounded waits in the background while doing independent work. A wait returns an observation on receipt change or timeout; command success alone does not release the hold.

A failed observation pauses work without creating an incident. If no hold is known, a healthy selected-endpoint check with no active incident restores baseline work; do not announce clearance. A healthy check includes applicable session-receipt processing; an unselected endpoint, timeout, silence or elapsed time does not qualify.

A known hold, including an `active` receipt, handoff or observed sync failure other than `tracker_busy`, survives failed checks and missing state (`alert: null`). Resume only after observing `cleared` for the same endpoint, incident and generation, or a strictly newer generation with recorded clearance evidence. Announce clearance before resuming. A lost receipt or session cursor cannot erase a hold known from other evidence.

Receipts persist in user-local state keyed by the selected database path. They are independent of the tracker and survive session restarts, but are not distributed across users, clones or hosts. Coordinate those participants explicitly. Harness callbacks supply advisory context at supported events; they cannot lock arbitrary native writes, stop existing workers or notify idle sessions immediately. Sessions without current adapters need an explicit handoff.

## Recover with authority

`beeswax beads recover --beads-db "$BEADS_DB"` prints a non-mutating handoff. Recovery requires explicit user authorization for the endpoint and incident; a fresh agent session alone grants none. Existing authorization remains valid within its agreed scope.

Once authorized, read [manual recovery](references/manual-recovery.md), available offline through `beeswax skills file tracker-recovery references/manual-recovery.md`. Complete its evidence and quiescence checks before changing tracker state. Ordinary observers remain on the waiting path.

Recovery is manual in this version. Automated Bee recovery is a possible future improvement, not an available dispatch path.
