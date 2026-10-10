# Beads integration

Hive keeps its live tracker in a permanent full checkout at `.worktrees/tracker--state`, on branch `tracker/state`. Its ignored `.beads/beads.db` is shared by all local feature worktrees. Its tracked `.beads/issues.jsonl` is the snapshot exchanged with colleagues. Separate clones have separate databases and tracker checkouts.

Native `br` reads and writes locally, with automatic JSONL import/export enabled. It does not fetch, commit or push. Local agents see the same database immediately; other clones receive updates through the tracker branch. Application code and the SQLite file are not part of tracker publication.

## Bootstrap a clone

Install Git, Bun, native `br`, and `mise`, then run the default setup task from the canonical checkout:

```nu
mise trust
mise run
```

The default task installs dependencies, builds the workspace launchers, then runs the idempotent `bun run beads:bootstrap` step. Rerun `mise run` for setup after a pull; run `bun run beads:bootstrap` directly when only tracker setup is needed. Dependency installation alone does not create the tracker.

`beads:bootstrap` invokes Honeycomb's CLI from this checkout through Bun; no installed Honeycomb launcher or global build is required. It uses a temporary, isolated Honeycomb configuration to create the permanent tracker as a nested, non-pooled worktree at `.worktrees/tracker--state`, on `tracker/state`, from `origin/tracker/state`. If `origin/tracker/state` is unavailable, Git's fetch fails; arrange for the accepted tracker branch and its existing `.beads/issues.jsonl` snapshot to be available, then retry. Bootstrap does not create a private tracker in a feature worktree.

Bootstrap imports the tracker's existing `.beads/issues.jsonl` only when `.beads/beads.db` does not exist, then flushes to establish the local merge base. It installs the tracker checkout's tooling and reuses `beads:setup` to configure the canonical checkout, permanent tracker checkout, and invoking checkout to use the selected tracker.

Bootstrap is deliberately local. Repeating it does not re-import an existing database and does not publish, merge, or push tracker state. An incompatible existing tracker checkout, an unhealthy database, unreconciled JSONL or missing tracker snapshot, or a selected nonstandard `BEADS_DB` endpoint fails visibly rather than being reset or migrated. For an existing custom endpoint, use `beads:setup` directly:

```nu
bun run beads:setup --db /absolute/path/to/tracker/.beads/beads.db
```

Use `--source <configured-checkout>` when adopting the environment from an already configured checkout. Bootstrap is for the canonical tracker layout; setup is the path for an explicitly selected custom endpoint.

## Synchronization checkpoints

```nu
bun run beads:sync
```

This command reconciles SQLite and JSONL, commits local tracker changes, fetches and merges compatible remote changes, reconciles the received snapshot and pushes `tracker/state`. It never force-pushes; conflicting records or claims stop synchronization. A shared lock serializes publication checkpoints.

The JSONL merge driver combines append-only comments using their issue, author, text and creation timestamp; comment IDs are local counters and may be reassigned during sync. It preserves repeated identical comments up to the greatest count seen on either side. A compatible comment addition can merge with a one-sided status or assignment change. Competing scalar changes, including assignments and closure timestamps, and deletion against an edited issue still require deliberate resolution.

Verified Git conflicts, native `SYNC_CONFLICT` failures and the native `sync --merge` conflict diagnostic produce a `cc-notify` alert with the host, repository, tracker and recovery action. Notification failure is reported alongside the original sync failure. Colony records the same context in its failed status; its existing [independent watchdog](../lib/colony/README.md#health-notifications) delivers that alert and deduplicates the incident.

Publication is an explicit remote-exchange step. Session-start hooks only configure the environment; Git hooks do not publish the tracker. Snapshot-only commits and merges on `tracker/state` validate the staged JSONL with the existing merge parser (valid issue records and unique IDs), without unrelated code checks. Other changes retain lint-staged and typecheck. Commitlint remains on commit-msg; native reconciliation, snapshot scope checks and conflict handling remain in the publisher.

Synchronize at these boundaries:

- **Explicit pull/remote refresh:** the operator consuming remote work runs `bun run beads:sync`, including when returning to an independent or dormant clone before selecting shared work. A code pull and repeat bootstrap do not refresh the live tracker. Sync exchanges changes in both directions; it is not receive-only.
- **Landing/merge:** the landing actor publishes once after integration and all final task/workflow updates, from a surviving configured checkout.
- **Deliberate remote handoff/checkpoint:** the responsible actor publishes valuable tracker-only or unlanded work when handing it to another clone, switching/retiring hosts, or requesting a remote checkpoint. Ordinary local handoffs and recording new tasks stay local.

All worktrees and bees sharing the selected database see local claims and updates immediately. Routine startup/resume, child completion, progress and local commits need no publication. Independent clones may remain stale until explicit exchange; local-only work has no remote backup or bounded publication delay. Each clone must eventually exchange its updates for remote visibility.

For deliberate cross-clone shared work, prefer agreed task allocation. Otherwise refresh, make the actual claims, successfully publish and verify the reservations before execution; batch reservations when useful. Publish release/handoff before another clone takes over. Claims remain provisional until publication succeeds. Separate clones have separate databases even on one host. Neither local locks nor Git exchange provide distributed leases or fencing; reused actor names can produce identical claims without proving exclusivity. Never force competing claims. Autonomous shared-queue dispatch across clones requires a separately agreed pre-execution coordination protocol.

Native `br` automatic JSONL import/export remains enabled independently of Git publication. Every publication includes the shared database's snapshot, including colleagues' ongoing tasks; publishing does not close their work. Never merge `tracker/state` into a code branch.

## Selecting storage

Tracked `mise.toml` selects the canonical checkout's `.worktrees/tracker--state/.beads/beads.db` by default. It resolves Git's absolute common directory and uses its parent as the canonical root, so the selection is portable across checkout locations and shared by linked worktrees. This assumes the standard layout with `.git` inside the canonical checkout. Trust `mise.toml` with `mise trust` before resolving the environment.

To explicitly configure an existing tracker endpoint, including Codex's generated environment:

```nu
bun run beads:setup --db /absolute/hive/.worktrees/tracker--state/.beads/beads.db
```

Setup preserves unrelated TOML settings and writes `BEADS_DB` to ignored `mise.local.toml` and `.codex/config.toml`. The local mise selection overrides the tracked default. `bun install` inherits the canonical checkout's selection for new Honeycomb worktrees only when that checkout has `mise.local.toml`; with only the tracked default, run `bun run beads:setup --source <canonical-root>` explicitly when generated Codex configuration is needed. Consumers honor the selected endpoint rather than deriving another database from their working directory.

Setup also refreshes the Hive-owned native `bee-attention` saved query in the selected database. It is local configuration rather than issue JSONL. See the [spawn query contract](./agents/spawn-requests.md#saved-presets) for its exact filters, direct installation command and history queries.

Mise supplies the project environment. Direnv projects the selection after normal local approval; Claude's SessionStart hook exports it; Pi's extension sets it at session start; Codex reads its generated shell-environment configuration. Codex needs no Beads SessionStart hook. Claude and Pi startup integrations do not synchronize. Remote exchange follows the explicit checkpoints above; a failed synchronization stops tracker work under the recovery procedure below.

When updating from the former wrapper setup, rerun setup in existing configured checkouts, including the permanent tracker checkout, and restart shells and agents. Setup removes generated wrapper PATH and shell-adapter overrides. Keep the tracker checkout's tooling current with the relevant changes, without merging the entire code branch into `tracker/state`.

For a fresh clone, follow [Bootstrap a clone](#bootstrap-a-clone). Do not initialize a private tracker in a feature worktree.

## Pi status bar

Pi shows `bead: <id>` after an agent's Bash tool successfully runs `br update <id> --claim --json`, including Bash calls nested through codemode. The tool output must be the JSON update response without extra command output. The latest claim replaces the previous ID; failed and unrelated calls leave it unchanged. This is a session-local indicator of the last claim, not live tracker state: it clears when a session starts or switches and is not restored on resume.

## Conflicts and recovery

If synchronization reports a conflict, stop tracker work and preserve the evidence. Independent changes merge automatically; competing claims require review. Timestamps and forced synchronization are not ownership decisions.

Manual recovery takes place in a separate human terminal with tracker writers paused:

1. Explicitly flush SQLite and commit the tracker JSONL before integrating incoming Git changes, preserving local work and establishing its merge base.
2. Integrate tracker commits using the JSONL merge driver. Resolve disputed records deliberately while retaining unrelated changes and respecting accepted reservations.
3. Use native `br` with the selected `--db` to inspect `sync --status --json`, then run unforced `sync --merge`. Commit any resulting snapshot changes and run `bun run beads:sync` successfully before resuming tracker work.

`jsonl_newer` compares content with the last certified hash, not timestamps. Auto-import can skip independently changed SQLite and JSONL with a warning; export can overwrite changed fields of existing tasks. A missing merge base with diverged state needs reviewed recovery, not forced synchronization.

## Checkout maintenance

The tracker checkout is permanent: keep it out of worktree pools and ordinary finish/remove cleanup. Its database, history and pending work must survive feature checkout deletion. Preserve older private databases until their unpublished state is reconciled; selecting a new endpoint does not migrate them.

The full checkout supplies the relative JSONL merge-driver script and Husky tooling. Maintain these deliberately with reviewed, narrowly scoped tooling commits that also exist on main; do not routinely merge main into the tracker branch because code branches carry no live tracker snapshot. Preserve pending JSONL and the database, and finish the maintenance commit before publication so the publisher sees only snapshot changes.
