# Integration boundaries

Hive relies on external programs it does not ship. This document records, for each one, what we use it for, why, and the contract a replacement must satisfy. To evaluate a swap (skim for fzf, Zellij for tmux), check the candidate against the contract here, then change only the adapter named for that tool.

[Architecture](./architecture.md) covers how packages and layers fit together; this document covers only the edges where Hive calls out of process.

## Summary

| Tool | Role | Required | Adapter |
| --- | --- | --- | --- |
| Git | Worktree, branch and status state for Honeycomb; hooks and merge driver for the repo | Always | [`git/executor.ts`](../lib/honeycomb/src/git/executor.ts) |
| Bash | Runs configured setup and preflight snippets | When config defines `command` or `pre_remote_check` | [`hooks.ts`](../lib/honeycomb/src/hooks.ts) |
| fzf | Interactive single selection with live preview | For `pick` and interactive slot recycling | [`fzf.ts`](../lib/honeycomb/src/fzf.ts), used by `LivePickerService` in [`live-deps.ts`](../lib/honeycomb/src/live-deps.ts) |
| tmux | Session per worktree for human wrappers | Optional; only under `--interactive` inside tmux | [`integrations/tmux.ts`](../lib/honeycomb/src/integrations/tmux.ts) behind [`Multiplexer`](../lib/honeycomb/src/integrations/multiplexer.ts) |
| zsh, Nushell | Host the `wk` picker wrapper | Optional | [`commands/shell-init.ts`](../lib/honeycomb/src/commands/shell-init.ts) |
| POSIX `sh` | Runs picker preview commands | With fzf | Preview builders in [`pick.ts`](../lib/honeycomb/src/commands/pick.ts), [`add.ts`](../lib/honeycomb/src/commands/add.ts) and the multiplexer |
| Bun | Runtime, package manager, test runner and script shell | Always | None; see [Development toolchain](#development-toolchain) |
| br (Beads) | Repository work tracking | Development only | [`.beads/config.yaml`](../.beads/config.yaml), [`scripts/`](../scripts) |
| bv (Beads Viewer) | Read-only work selection | Optional, development only | [`.bv/recipes.yaml`](../.bv/recipes.yaml) |

Honeycomb reaches every runtime tool through a service in [`services.ts`](../lib/honeycomb/src/services.ts) (`GitRunner`, `HookRunner`, `PickerService`, `Multiplexer`, `CdDirective`), composed once in `createLiveDeps`. Commands and domain code never spawn processes directly, so a replacement is a new service implementation, not a change to lifecycle logic. Preview strings are the one leak: they are shell text the picker executes, and they reference picker and multiplexer syntax (see below).

## Git

**Why:** Git is the source of truth. Honeycomb keeps no database; registered worktrees, branches and working-tree status are the state it reads and mutates. Not swappable in practice, but the contract bounds which Git features we depend on.

**Contract:**

- `git` on `PATH`. Every call uses `git -C <path> …` from a neutral cwd (`/`), so commands keep working after the process's original directory is removed.
- Machine-readable output is parsed from `worktree list --porcelain` and `status --porcelain=v1`; nothing else is parsed beyond single-value results such as `rev-parse` and `branch --show-current`.
- Commands used: `worktree add|remove|list`, `branch`, `checkout`, `status`, `rev-parse`, `show-ref`, `symbolic-ref`, `merge-base`, `merge --ff-only|--squash`, `rebase`, `reset --hard`, `clean -fd`, `fetch`/`push origin`, `remote show`, `log`, `diff`, `ls-files`.
- The remote is assumed to be named `origin`; the default branch is read from `refs/remotes/origin/HEAD`.
- Failures surface as `GitError` (`reason: "git_failed"`) carrying args, stderr and exit code.

The repository itself also depends on Git hooks (Husky) and a custom merge driver for `.beads/issues.jsonl`, registered by [`scripts/setup-git.ts`](../scripts/setup-git.ts).

## Bash

**Why:** users write setup (`command`) and preflight (`pre_remote_check`) snippets in config; Bash is a predictable, ubiquitous interpreter for them.

**Contract:**

- `bash` on `PATH`. Setup runs as `bash <script-file>`; preflight runs as `bash -c <snippet>`.
- Runs in the worktree directory with the process environment plus Honeycomb's additions.
- stdout and stderr are streamed line by line to progress output and captured for `--json` payloads.
- Nonzero exit fails the operation (`HookError`) and triggers rollback.

Changing the interpreter changes the meaning of existing user config, so treat it as a config-format change, not an adapter swap.

## Fuzzy picker (fzf)

**Why:** a fast, familiar selection UI with live previews that draws on `/dev/tty` itself, so Honeycomb can keep stdout clean for the result.

**Contract** (what `PickerService.pick` needs from the tool):

- Reads candidate rows from stdin, one per line; writes the chosen row, unmodified, to stdout. Honeycomb maps the row back to an item by exact string match.
- Draws its UI on the terminal directly, not on stdout; stderr is inherited.
- Rows are tab-delimited. The first field is a hidden key (a worktree path); only fields 2+ are shown and matched (`--delimiter '\t' --with-nth 2..`).
- Runs a preview shell command per highlighted row with field substitution: `{1}` expands to the first field, shell-quoted. Previews are POSIX `sh` and use `git`, `awk` and `head`.
- Preview pane below the list (`--preview-window down,70%,wrap`) and a header line (`--header`).
- Exit status distinguishes cancellation from failure: fzf's `1` (no match) and `130` (Esc or Ctrl-C) become `PickerCancelled`; other nonzero codes are errors.
- Optional: when `--interactive`, render as a popup inside the multiplexer (`--tmux center,80%,70%`); outside tmux fzf ignores this and runs inline. A replacement without popup support may simply run inline.

**Swap checklist:** a replacement such as skim needs equivalents for stdin/stdout selection, delimiter plus visible-field selection, `{1}` substitution in previews, preview window placement, and distinguishable cancel exit codes. Change `fzf.ts` (flag mapping and exit codes) and the `WORKTREE_PATH_FIELD` placeholder in [`multiplexer.ts`](../lib/honeycomb/src/integrations/multiplexer.ts) plus the `{1}` in `add.ts`'s recycle preview.

Yes/no confirmation does not use the picker; `confirm` reads one key from `/dev/tty` directly.

## Terminal multiplexer (tmux)

**Why:** each worktree gets its own session, so a human can jump between branches with their shells, editors and running processes intact. It is a convenience for people, never a source of truth: sessions are derived from worktree paths and a missing session is never an error.

**Contract** (the [`Multiplexer`](../lib/honeycomb/src/integrations/multiplexer.ts) interface):

- `attached` — whether Honeycomb runs inside the multiplexer. For tmux, detected from `TMUX`; outside it, `NoMultiplexer` makes every operation a no-op.
- `open({ name, title, path })` — create a detached session named `name`, rooted at `path`, with a first window titled `title`, if none exists; then move the invoking client's focus to it. tmux resolves the client from `TMUX_PANE` so focus moves in the terminal that ran the command.
- `closeUnder(path)` — close every session whose root is `path` or beneath it. "No server" or "no sessions" means nothing to close, not an error.
- `previewCommand()` — shell text for the picker preview: show the live contents of a pane whose working directory is in the worktree, falling back to `git log`.
- Session lookup and kill use exact name matching (tmux `=name`), so one name never matches another's prefix.
- Only `--interactive` invocations may call `open` or `closeUnder`; agents never move a user's focus or close sessions.

**Session names** are part of Honeycomb's public output (the `session` field in `--json` payloads), computed by `sessionNameForWorktreePath`: the worktree directory name, prefixed with the repository name for nested worktrees, with `.` replaced by `_` because tmux rejects dots in session names. A replacement must accept these names or the naming rule must change for all consumers.

**Swap checklist:** a replacement such as Zellij needs create-if-missing by name with a working directory, switch the current client to a named session, list sessions with their root directories, kill by exact name, and (for previews) capture a pane's visible contents by working directory. Add an implementation beside `tmux.ts` and select it in `selectMultiplexer`; no command code changes. If the tool cannot capture panes, return `gitLogPreviewCommand()` from `previewCommand`.

## Shell integration (zsh, Nushell)

**Why:** a child process cannot change its parent shell's directory, so a thin shell function is needed to `cd` after picking.

**Contract:**

- `honeycomb shell-init <shell>` prints a `wk` function and nothing else; it holds no worktree, Git or multiplexer logic.
- `wk` creates a temporary file, runs `honeycomb --interactive pick` with `HONEYCOMB_CD_FILE` set to it, `cd`s to the path Honeycomb wrote there if any, and always deletes the file. Arguments are forwarded to `pick`.
- The engine side is `CdDirective`, which only writes a path to the named file.

Supporting another shell means adding one more template that honours the same `HONEYCOMB_CD_FILE` handshake.

## Development toolchain

These support working on Hive rather than running it; replacing them changes contributor workflow, not product behaviour.

- **Bun** runs TypeScript directly (no build step), installs dependencies, runs tests (`bun test`) and provides the `$` shell in scripts. Code uses `Bun.spawn` and Bun's test runner, so moving runtimes means replacing those calls, not just the launcher.
- **br (Beads)** tracks work in the canonical checkout's `.beads/beads.db`, shared by linked worktrees. Automatic import is enabled; automatic export is disabled. Agents publish `.beads/issues.jsonl` with an explicit flush, commit and push for new claims and after landing. Git uses the custom merge driver above when published snapshots change on both sides. [`scripts/beads-loop.ts`](../scripts/beads-loop.ts) selects canonical storage and reads label-filtered `br ready --json` and `br show --json` output. [Beads integration](./beads-integration.md) explains the publication timing and collaboration model.
- **Husky, lint-staged, commitlint, oxlint, oxfmt and TypeScript** are npm dev dependencies pinned in [`package.json`](../package.json) and configured in the repository root; they need no separate installation.

### Automation bead maintenance and debugging

This section is for maintainers explicitly working on the automation-owned `system` workstream, not day-to-day agent task selection. Ordinary agents must avoid these beads. A normal implementation task does not become a system bead merely because an agent performs it or it changes automation code.

When maintaining automation records, use the lowercase `system` label (`create --labels system` or `update --add-label system`), not a custom type or status. Label each system child explicitly too. Runner labels remain independent of this classification.

The project [viewer recipes](../.bv/recipes.yaml) provide `work` (exclude `system`) and `system` (require `system`) views. They affect `bv`, not `br` or worker execution, and are not automatically selected on startup. For read-only investigation, run from the repository root:

```nu
bv --recipe system --robot-triage
br list --label system --json
br ready --label system --json
```

The worker loop excludes system beads by default. Its `--system` option is for intentional automation execution, not inspection: it launches agents that may claim, modify, and close system beads. Use it only for an explicitly authorized automation run; dependency/readiness checks and `--agent worker|lead` routing still apply:

```nu
bun scripts/beads-loop.ts --system
```
