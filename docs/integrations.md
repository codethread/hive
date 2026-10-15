# Integration boundaries

External dependencies and the contracts a replacement must satisfy. [Architecture](./architecture.md) owns package boundaries; adapters below own subprocess details.

## Summary

| Tool | Role | Required | Boundary |
| --- | --- | --- | --- |
| Git | Worktree, branch and status authority; repository hooks and merge driver | Always | Honeycomb's [`git/executor.ts`](../lib/honeycomb/src/git/executor.ts); [Beeswax](../lib/beeswax/README.md) for repository plumbing |
| Bash | Honeycomb setup and preflight snippets | Config with `command` / `pre_remote_check` | [`hooks.ts`](../lib/honeycomb/src/hooks.ts) |
| fzf | Interactive selection with live preview | `pick` and interactive slot recycling | [`fzf.ts`](../lib/honeycomb/src/fzf.ts) |
| tmux | Human worktree sessions | Optional, under `--interactive` inside tmux | [`tmux.ts`](../lib/honeycomb/src/integrations/tmux.ts) |
| zsh, Nushell | `wk` picker wrapper | Optional | [`shell-init.ts`](../lib/honeycomb/src/commands/shell-init.ts) |
| POSIX `sh` | Picker previews, using `git`, `awk` and `head` | With fzf | Preview builders in [`pick.ts`](../lib/honeycomb/src/commands/pick.ts), [`add.ts`](../lib/honeycomb/src/commands/add.ts) and the multiplexer |
| Bun | Development runtime, compiler, package manager and test runner | Development and builds; embedded in installed CLIs | [CLI artifacts](../lib/tooling/README.md#cli-artifacts) |
| br (Beads) | Native task and request authority | Bee/Colony and development | [`@hive/beads`](../lib/beads/README.md) |
| bv (Beads Viewer) | PageRank scheduling | Default Colony ranking; optional with FIFO | [`ranking.ts`](../lib/colony/src/ranking.ts) |

Honeycomb composes its subprocess services in [`live-deps.ts`](../lib/honeycomb/src/live-deps.ts). Replace implementations of [`services.ts`](../lib/honeycomb/src/services.ts) without changing lifecycle logic. Picker preview strings also couple shell, picker and multiplexer syntax.

## Bee and Colony runtime

- **Honeycomb** resolves the canonical root. **br** supplies native task and request facts through the typed `@hive/beads` boundary. Tracker selection is explicit; see [Beads integration](./beads-integration.md).
- **BV** reads the selected SQLite database directly in read-only mode and returns the complete visible graph's PageRank scores. The adapter verifies source authority and completeness. It neither exports nor reconciles the tracker. [Scheduling](../lib/colony/README.md#scheduling) explains when ranking runs and the FIFO alternative.
- **Native harnesses** receive formula tokens directly, with the execution directory, identity and tracker environment. Recipe text is not evaluated as shell syntax. Model access and authentication belong to the harness installation.
- **Process ownership** requires supervisor artifacts and observed process fingerprints. A wrapper dispatching to an external daemon needs its own ownership contract; process exit alone does not prove task completion.

The [Colony guide](../lib/colony/README.md) owns runtime operations. The [harness capability reference](./harness-capabilities.md) distinguishes dated launch evidence from implemented behavior and remaining Scent work.

## Git

Git is Honeycomb's state store. Registered worktrees, branches and status remain authoritative; Honeycomb keeps no parallel database. Calls run from a neutral directory with `git -C`, so deleting the original working directory does not strand subsequent operations. Git adapters parse porcelain worktree/status output and single-value queries, preserving args, stderr and exit status on failure.

Honeycomb assumes remote `origin` and reads the default branch from `refs/remotes/origin/HEAD`. [Beeswax](../lib/beeswax/README.md#commit-the-project-contract) owns hook installation and the `.beads/issues.jsonl` merge driver; application checks remain repository-owned.

## Bash

Honeycomb's configured setup and preflight snippets are Bash programs. They run in the worktree with the inherited environment plus Honeycomb's additions. Output is streamed and retained for results; a nonzero exit fails the operation and triggers rollback. Changing the interpreter changes the configuration language, not merely the adapter.

## Fuzzy picker (fzf)

The picker must return an unchanged candidate row on stdout while drawing its UI directly on the terminal. Tab-delimited rows keep the worktree path in the hidden first field; visible fields drive matching. Cancellation must remain distinguishable from failure.

A replacement must support field substitution in POSIX-shell previews and visible-field selection. Update [`fzf.ts`](../lib/honeycomb/src/fzf.ts), the [`WORKTREE_PATH_FIELD`](../lib/honeycomb/src/integrations/multiplexer.ts) placeholder and `add.ts`'s recycle preview together. Popup support is optional; inline selection remains valid. Yes/no confirmation reads `/dev/tty` independently of the picker.

## Terminal multiplexer (tmux)

Sessions are a human convenience derived from worktree paths, never repository authority. A missing session is normal. Only interactive invocations may change focus or close sessions.

The [`Multiplexer`](../lib/honeycomb/src/integrations/multiplexer.ts) contract requires create-if-missing and focus, removal by working-directory subtree, and preview text. A replacement needs exact-name matching and current-client selection; it may use Git history when pane capture is unavailable. Session names also appear in public JSON output: preserve [`sessionNameForWorktreePath`](../lib/honeycomb/src/domain/worktree.ts) semantics across adapters.

## Shell integration (zsh, Nushell)

A child cannot change its parent's directory. `honeycomb shell-init` therefore prints a thin `wk` wrapper: it forwards arguments to interactive `pick`, reads the path written through `HONEYCOMB_CD_FILE`, changes directory, and removes the temporary file. New shell templates must preserve that handshake; worktree and multiplexer logic stay in Honeycomb.

## Development toolchain

Bun-specific process and test APIs make a runtime replacement broader than a launcher change. Build/install behavior belongs to [Repository tooling](../lib/tooling/README.md#cli-artifacts); pinned development dependencies and their recipes live in [`package.json`](../package.json).

Beeswax writes the selected `BEADS_DB` to ignored `mise.local.toml` when Mise integration is enabled. `beeswax beads setup --help` covers explicit endpoint selection and matching ignored Codex environment configuration; unrelated settings are preserved. Actor identity remains process-local. [Beads integration](./beads-integration.md) owns storage and publication policy.

Pi's [Beads extension](../.pi/extensions/beads.ts) displays the last successful Bash claim whose output contains only its JSON update response. The indicator clears on session start/switch; it is not live tracker state.

### Automation bead maintenance and debugging

Access to automation-owned records follows the [system-label authority](./beads-labels.md#taxonomy). The [`work` and `system` viewer recipes](../.bv/recipes.yaml) filter BV views; they do not authorize execution or filter `br` calls.

For an authorized maintenance assignment, put its scope and system bead IDs in workflow input beneath an ordinary work parent. Use `bee spawn --help` for submission. [Spawn state and native queries](./agents/spawn-requests.md) owns lifecycle inspection and recovery.
