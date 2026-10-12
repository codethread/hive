# Beads integration

Hive keeps its live tracker in a permanent full checkout at `.worktrees/tracker--state`, on branch `tracker/state`. Its ignored `.beads/beads.db` is shared by all local feature worktrees. Its tracked `.beads/issues.jsonl` is the snapshot exchanged with colleagues. Separate clones have separate databases and tracker checkouts.

Native `br` reads and writes locally, with automatic JSONL import/export enabled. It does not fetch, commit or push. Local agents see the same database immediately; other clones receive updates through the tracker branch. Application code and the SQLite file are not part of tracker publication.

## Synchronization checkpoints

```nu
bun run beads:sync
```

This command reconciles SQLite and JSONL, commits local tracker changes, fetches and merges compatible remote changes, reconciles the received snapshot and pushes `tracker/state`. It never force-pushes; conflicting records or claims stop synchronization. A shared lock serializes publication checkpoints.

Publication is an explicit remote-exchange step. Session-start hooks only configure the environment; Git hooks do not publish the tracker. Snapshot-only commits and merges on `tracker/state` validate the staged JSONL with the existing merge parser (valid issue records and unique IDs), without unrelated code checks. Other changes retain lint-staged and typecheck. Commitlint remains on commit-msg; native reconciliation, snapshot scope checks and conflict handling remain in the publisher.

Synchronize at these boundaries:

- **Explicit pull/remote refresh:** the operator consuming remote work runs `bun run beads:sync`, including when returning to an independent or dormant clone before selecting shared work. A code pull and repeat bootstrap do not refresh the live tracker. Sync exchanges changes in both directions; it is not receive-only.
- **Landing/merge:** the landing actor publishes once after integration and all final task/workflow updates, from a surviving configured checkout.
- **Deliberate remote handoff/checkpoint:** the responsible actor publishes valuable tracker-only or unlanded work when handing it to another clone, switching/retiring hosts, or requesting a remote checkpoint. Ordinary local handoffs and recording new tasks stay local.

All worktrees and bees sharing the selected database see local claims and updates immediately. Routine startup/resume, child completion, progress and local commits need no publication. Independent clones may remain stale until explicit exchange; local-only work has no remote backup or bounded publication delay. Each clone must eventually exchange its updates for remote visibility.

For deliberate cross-clone shared work, prefer agreed task allocation. Otherwise refresh, make the actual claims, successfully publish and verify the reservations before execution; batch reservations when useful. Publish release/handoff before another clone takes over. Claims remain provisional until publication succeeds. Separate clones have separate databases even on one host. Neither local locks nor Git exchange provide distributed leases or fencing; reused actor names can produce identical claims without proving exclusivity. Never force competing claims. Autonomous shared-queue dispatch across clones requires a separately agreed pre-execution coordination protocol.

Native `br` automatic JSONL import/export remains enabled independently of Git publication. Every publication includes the shared database's snapshot, including colleagues' ongoing tasks; publishing does not close their work. Never merge `tracker/state` into a code branch.

## Selecting storage

Configure an existing tracker endpoint:

```nu
bun run beads:setup --db /absolute/hive/.worktrees/tracker--state/.beads/beads.db
```

Setup preserves unrelated TOML settings and writes `BEADS_DB` to ignored `mise.local.toml` and `.codex/config.toml`. `bun install` inherits the canonical checkout's selection for new Honeycomb worktrees; `bun run beads:setup --source <canonical-root>` repeats that setup explicitly. Consumers honor the selected endpoint rather than deriving another database from their working directory.

Mise supplies the project environment. Direnv projects the selection after normal local approval; Claude's SessionStart hook exports it; Pi's extension sets it at session start; Codex reads its generated shell-environment configuration. Session integrations only configure the environment; remote exchange follows the explicit checkpoints above.

When updating from the former wrapper setup, rerun setup in existing configured checkouts, including the permanent tracker checkout, and restart shells and agents. Setup removes generated wrapper PATH and shell-adapter overrides. Keep the tracker checkout's tooling current with the relevant changes, without merging the entire code branch into `tracker/state`.

For a fresh clone, create the permanent tracker checkout from the accepted tracker branch. Use native `br` with the selected `--db` to run `sync --import-only` followed by `sync --flush-only`, then configure the checkout. Import creates SQLite from JSONL; flush establishes the local three-way merge base. Do not initialize a private tracker in a feature worktree.

## Conflicts and recovery

If synchronization reports a conflict, stop tracker work and preserve the evidence. Independent changes merge automatically; competing claims require review. Timestamps and forced synchronization are not ownership decisions.

Manual recovery takes place in a separate human terminal with tracker writers paused:

1. Explicitly flush SQLite and commit the tracker JSONL before integrating incoming Git changes, preserving local work and establishing its merge base.
2. Integrate tracker commits using the JSONL merge driver. Resolve disputed records deliberately while retaining unrelated changes and respecting accepted reservations.
3. Use native `br` with the selected `--db` to inspect `sync --status --json`, then run unforced `sync --merge`. Commit any resulting snapshot changes and run `bun run beads:sync` successfully before resuming tracker work.

`jsonl_newer` compares content with the last certified hash, not timestamps. Auto-import can skip independently changed SQLite and JSONL with a warning; export can overwrite changed fields of existing tasks. A missing merge base with diverged state needs reviewed recovery, not forced synchronization.

## Checkout maintenance

The tracker checkout is permanent: keep it out of worktree pools and ordinary finish/remove cleanup. Its database, history and pending work must survive feature checkout deletion. Preserve older private databases until their unpublished state is reconciled; selecting a new endpoint does not migrate them.

The full checkout supplies the relative JSONL merge-driver script and Husky tooling. Maintain these deliberately; do not routinely merge main into the tracker branch because code branches carry no live tracker snapshot.
