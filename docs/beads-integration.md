# Beads integration

Hive's default tracker is a permanent full checkout at `.worktrees/tracker--state`, on branch `tracker/state`. Local worktrees and bees share its ignored `.beads/beads.db`; separate clones have separate databases, even on one host. Tracker publication exchanges only the tracked `.beads/issues.jsonl` snapshot through Git.

Native `br` reads and writes locally with automatic JSONL import/export enabled. Publication exchanges the whole shared snapshot, including colleagues' ongoing work, without closing their tasks. Never merge `tracker/state` into a code branch.

## Bootstrap a clone

Install Git, Bun, native `br`, and `mise`, then run the default setup task from the canonical checkout:

```nu
mise trust
mise run
```

The [setup recipe](./repository-commands.md#setup-and-automation) owns installation and tracker bootstrap. Bootstrap requires accepted `origin/tracker/state` history and its `.beads/issues.jsonl`; arrange for these to be available if missing. Preserve existing state when setup fails and follow [recovery](#conflicts-and-recovery).

## Selecting storage

Use the selected `BEADS_DB`; do not initialize a private tracker in a feature worktree. Tracked [`mise.toml`](../mise.toml) selects the canonical worktree's tracker by default. [Environment setup](./integrations.md#development-toolchain) covers local overrides and generated Codex configuration.

For an existing custom endpoint or inheritance from a configured checkout, use `beeswax beads setup --help`. For canonical bootstrap options, use `beeswax beads bootstrap --help`. Selecting an endpoint does not migrate older databases; retain them until their unpublished state is reconciled.

## Synchronization checkpoints

```nu
bun run beads:sync
```

This receives and publishes tracker changes; it is not receive-only. [Beeswax](../lib/beeswax/README.md#operate-the-tracker) owns publication and reconciliation. Setup, session hooks and Git hooks do not publish.

Synchronize at these boundaries:

- **Explicit pull/remote refresh:** the operator refreshes an independent or dormant clone before selecting shared work. A code pull or repeat bootstrap does not refresh the live tracker.
- **Landing/merge:** the landing actor publishes once after integration and all final task/workflow updates, from a surviving configured checkout.
- **Deliberate remote handoff/checkpoint:** the responsible actor publishes valuable tracker-only or unlanded work when handing it to another clone, switching/retiring hosts, or requesting a remote checkpoint. Ordinary local handoffs and recording new tasks stay local.

Worktrees sharing the selected database see claims and updates immediately. Routine startup/resume, child completion, progress and local commits need no publication. Independent clones may remain stale until exchange; local-only work has no remote backup or bounded publication delay.

For cross-clone shared work, prefer agreed task allocation. Otherwise refresh, claim, successfully publish and verify reservations before execution. Claims remain provisional until publication succeeds; publish release/handoff before another clone takes over. Neither local locks nor Git exchange provide distributed leases or fencing; identical actor claims do not prove exclusivity. Never force competing claims. Autonomous shared-queue dispatch across clones requires an agreed pre-execution coordination protocol.

## Conflicts and recovery

If synchronization fails, stop tracker work and preserve the evidence. Independent changes merge automatically; competing claims require review. Timestamps and forced synchronization are not ownership decisions. Use `br sync --help` for native diagnostics and modes.

Manual recovery takes place in a separate human terminal with tracker writers paused:

1. Explicitly flush SQLite and commit the tracker JSONL before integrating incoming Git changes, preserving local work and establishing its merge base.
2. Integrate tracker commits using the JSONL merge driver. Resolve disputed records deliberately while retaining unrelated changes and respecting accepted reservations.
3. Use native `br` with the selected `--db` to inspect `sync --status --json`, then run unforced `sync --merge`. Commit any resulting snapshot changes and run `bun run beads:sync` successfully before resuming tracker work.

`jsonl_newer` compares content with the last certified hash, not timestamps. Auto-import can skip independently changed SQLite and JSONL with a warning; export can overwrite changed fields of existing tasks. A missing merge base with diverged state needs reviewed recovery, not forced synchronization.

## Checkout maintenance

Keep the permanent tracker out of worktree pools and ordinary finish/remove cleanup. Its database, accepted history and pending work must survive feature checkout deletion.

Follow the [Beeswax project contract](../lib/beeswax/README.md#commit-the-project-contract) for tracker hook setup and migration. Changes to tracked application policy require reviewed, narrowly scoped tooling commits that also exist on main. Do not routinely merge main into the tracker branch: code branches carry no live snapshot. Preserve pending JSONL and the database; finish maintenance commits before publication, which requires changes to be limited to the snapshot.
