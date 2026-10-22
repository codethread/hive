# Beads integration

Hive's default tracker is a permanent full checkout at `.worktrees/tracker--state`, on branch `tracker/state`. Local worktrees and bees share its ignored `.beads/beads.db`; separate clones have separate databases, even on one host. Tracker publication exchanges only the tracked `.beads/issues.jsonl` snapshot through Git.

Native `br` owns local reads, writes and publication reconciliation; its configured automatic import/export can affect JSONL during ordinary commands. Publication exchanges the whole shared snapshot, including colleagues' ongoing work, without closing their tasks. See the [publication contract and native prerequisite](../lib/beeswax/README.md#snapshot-exchange). Never merge `tracker/state` into a code branch.

## Bootstrap a clone

Install Git, Bun, native `br`, and `mise`, then run the default setup task from the canonical checkout:

```nu
mise trust
mise run
```

The [setup recipe](../mise.toml) installs the tools and bootstraps accepted `origin/tracker/state` history and its `.beads/issues.jsonl`. If that history is unavailable or setup fails, preserve existing state and follow [recovery](#conflicts-and-recovery).

## Selecting storage

Use the selected `BEADS_DB`; do not initialize a private tracker in a feature worktree. [Environment setup](./integrations.md#development-toolchain) covers Hive's default, local overrides and generated Codex configuration.

For an existing custom endpoint or inheritance from a configured checkout, use `beeswax beads setup --help`. For canonical bootstrap options, use `beeswax beads bootstrap --help`. Selecting an endpoint does not migrate older databases; retain them until their unpublished state is reconciled.

## Synchronization checkpoints

```nu
bun run beads:sync
```

This receives and publishes tracker changes through [Beeswax](../lib/beeswax/README.md#operate-the-tracker). Setup, session hooks and Git hooks stay local.

Synchronize at these boundaries:

- **Explicit pull/remote refresh:** the operator refreshes an independent or dormant clone before selecting shared work. A code pull or repeat bootstrap does not refresh the live tracker.
- **Landing/merge:** the landing actor publishes once after integration and all final task/workflow updates, from a surviving configured checkout.
- **Deliberate remote handoff/checkpoint:** the responsible actor publishes valuable tracker-only or unlanded work when handing it to another clone, switching/retiring hosts, or requesting a remote checkpoint. Ordinary local handoffs and recording new tasks stay local.

Routine startup/resume, child completion, progress and local commits need no publication. Independent clones may remain stale until exchange; local-only work has no remote backup or bounded publication delay.

For cross-clone shared work, agree task allocation or refresh, claim, successfully publish and verify reservations before execution. Publish release/handoff before another clone takes over. Local locks and Git exchange provide no distributed lease; identical actor claims do not prove exclusivity. Never force competing claims. Autonomous shared-queue dispatch requires an agreed pre-execution coordination protocol.

## Child identities across clones

New Hive-created children, including Bee and Busy Bee work, use native hash IDs with a `parent-child` dependency created atomically through `br create --deps parent-child:PARENT`. They do not use the clone-local sequence allocated by `br create --parent`, which can give independent children the same ID before exchange. Use dependency edges, not ID prefixes, to discover hierarchy. Existing IDs and parentage remain unchanged.

## Conflicts and recovery

Pre-publication `tracker_busy` alone is not an incident and does not release an existing hold; see [Beeswax's contention and recovery guidance](../lib/beeswax/README.md#operate-the-tracker).

On a tracker alert or other synchronization failure, pause Beads workflows, ordinary tracker operations and merges involving that tracker. Use `beeswax beads recover --beads-db "$BEADS_DB"` for the installed recovery handoff, including observer waiting and explicitly user-authorized recovery. Beeswax owns the reusable procedure and independent alert state.

Hive retains the selected database, actor and permanent checkout conventions above. Apply its [publication checkpoints](#synchronization-checkpoints) and coordinate Bee/Colony writers through their owning tools. Recovery authorization must cover the affected endpoint and any publication; it does not authorize application-code pushes. Keep incident evidence outside the affected tracker until ordinary writes are safe.

Once ordinary tracker writes are safe, record each new sync incident as an investigation/fix child of pinned `hv-1sylid` (Beads Rust / Hive sync issues); never claim or close that parent. Include symptoms, exact root cause or explicitly unknown cause, fix versus operational recovery, verification and original evidence, and the first fixed version (or full fix commit SHA for a fix predating versioned releases). Keep unresolved or unverified facts explicit; close the child only when its scope is complete. Preserve original task history and parentage; historical backfills link the original work and do not imply a new fix.

## Checkout maintenance

Keep the permanent tracker out of worktree pools and ordinary finish/remove cleanup. Its database, accepted history and pending work must survive feature checkout deletion.

For explicit Git object packing, see [Pack Git storage](../lib/beeswax/README.md#pack-git-storage).

Follow the [Beeswax project contract](../lib/beeswax/README.md#commit-the-project-contract) for tracker hook setup and migration. Changes to tracked application policy require reviewed, narrowly scoped tooling commits that also exist on main. Do not routinely merge main into the tracker branch: code branches carry no live snapshot. Preserve pending JSONL and the database. Finish staged non-snapshot changes before publication; unstaged hook or recipe edits stay local and are not included in snapshot exchange.
