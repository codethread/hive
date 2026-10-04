# Beads integration

Hive keeps its live tracker in a permanent full checkout at `.worktrees/tracker--state`, on branch `tracker/state`. Its ignored `.beads/beads.db` is shared by all local feature worktrees. Its tracked `.beads/issues.jsonl` is the snapshot exchanged with colleagues. Separate clones have separate databases and tracker checkouts.

Native `br` reads and writes locally, with automatic JSONL import/export enabled. It does not fetch, commit or push. Local agents see the same database immediately; other clones receive updates through the tracker branch. Application code and the SQLite file are not part of tracker publication.

## Synchronization checkpoints

```nu
bun run beads:sync
```

This command reconciles SQLite and JSONL, commits local tracker changes, fetches and merges compatible remote changes, reconciles the received snapshot and pushes `tracker/state`. It never force-pushes; conflicting records or claims stop synchronization. A shared lock serializes publication checkpoints.

Synchronization runs at session start and before code commits, not on ordinary `br` commands or agent tool calls. The pre-commit hook runs after local quality checks and aborts the commit if synchronization fails, including network failures. Tracker commits skip the sync step to avoid recursion, but retain normal quality hooks. The pre-merge-commit hook uses the same checkpoint.

Explicitly synchronize:

- **After claiming, before working:** the claim is provisional until publication succeeds. Respect already-published reservations; do not force a claim to win.
- **After closure or handoff:** these updates may happen after the final code commit, or without any code commit.
- **After landing updates:** publish completion separately from application code.

Progress updates remain local until a checkpoint. Every publication includes the shared database's snapshot, including colleagues' ongoing tasks; publishing does not close their work. Never merge `tracker/state` into a code branch.

## Selecting storage

Tracked `mise.toml` selects the canonical checkout's `.worktrees/tracker--state/.beads/beads.db` by default. It resolves Git's absolute common directory and uses its parent as the canonical root, so the selection is portable across checkout locations and shared by linked worktrees. This assumes the standard layout with `.git` inside the canonical checkout. Trust `mise.toml` with `mise trust` before resolving the environment.

To explicitly configure an existing tracker endpoint, including Codex's generated environment:

```nu
bun run beads:setup --db /absolute/hive/.worktrees/tracker--state/.beads/beads.db
```

Setup preserves unrelated TOML settings and writes `BEADS_DB` to ignored `mise.local.toml` and `.codex/config.toml`. The local mise selection overrides the tracked default. `bun install` inherits the canonical checkout's selection for new Honeycomb worktrees only when that checkout has `mise.local.toml`; with only the tracked default, run `bun run beads:setup --source <canonical-root>` explicitly when generated Codex configuration is needed. Consumers honor the selected endpoint rather than deriving another database from their working directory.

Mise supplies the project environment. Direnv projects the selection after normal local approval; Claude's SessionStart hook exports it; Pi's extension sets it at session start; Codex reads its generated shell-environment configuration. Review Codex's SessionStart hook through native hook review once per clone. A failed session-start sync is reported to the user; there is no ongoing tool-call gate.

When updating from the former wrapper setup, rerun setup in existing configured checkouts, including the permanent tracker checkout, and restart shells and agents. Setup removes generated wrapper PATH and shell-adapter overrides. Keep the tracker checkout's tooling current with the relevant changes, without merging the entire code branch into `tracker/state`.

For a fresh clone, create the permanent tracker checkout from the accepted tracker branch. Use native `br` with the selected `--db` to run `sync --import-only` followed by `sync --flush-only`, then configure the checkout. Import creates SQLite from JSONL; flush establishes the local three-way merge base. Do not initialize a private tracker in a feature worktree.

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

The full checkout supplies the relative JSONL merge-driver script and Husky tooling. Maintain these deliberately; do not routinely merge main into the tracker branch because code branches carry no live tracker snapshot.
