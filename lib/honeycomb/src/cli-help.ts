export const HELP = {
	add: `
Use when:
  Starting work on a branch. This is the preferred entry point over raw git
  worktree add because it applies repository policy, deterministic paths, pool
  allocation, copy setup, and the configured setup command.

Notes:
  Without --base, new branches start from the configured policy target. Use
  --base only for intentional stacked/non-default work. --base-current uses the
  branch checked out in the worktree containing --cwd instead, and is refused for
  a detached HEAD or combined with --base. Setup failure rolls the add back and
  exits 1 with reason setup_failed; with --json, setup output is in setup_output.

Blocked outcomes:
  Existing branches, stale or dirty canonical roots, pool exhaustion, and unsafe
  slot states are reported explicitly. Machine consumers should branch on kind
  such as ready, blocked, or pool_full, and on ok.
`,
	config: `
Use subcommands to explain the configuration resolved for a repository.

Related:
  config explain --cwd <path> --json
`,
	copy: `
Use when:
  Project copy configuration changed, local tool assets were updated, or a
  worktree needs its untracked setup files materialized again without recreating
  the checkout.

Notes:
  copy targets the non-canonical worktree containing --cwd (or the current directory by default) and refuses the
  canonical root. Destinations are engine-managed untracked setup paths; reruns
  replace those paths from their configured sources.
`,
	ensure: `
Use when:
  Pre-warming an expensive repository's worktree pool before agents or humans
  request work. add also ensures pools as needed, so this is mainly for setup,
  repair, or making failures visible early.

Notes:
  Non-pooled repositories have no slots to materialize. Pool initialization runs
  configured copy/setup so slots are ready for later allocation.
`,
	explain: `
Use when:
  Debugging why add, finish, pools, copy setup, or bootstrap commands behave a
  certain way for a repository.

Notes:
  Resolution starts with built-in defaults, applies matching root_glob rules in
  file order, then exact project overrides. Use --json for the matched rules,
  exact project, command source, add policy, and finish policy.
`,
	finish: `
Use when:
  Work on a branch is complete and should be folded back into the canonical
  target branch with the same lifecycle rules used by creation and cleanup.

Notes:
  finish refuses the canonical root, requires a clean source worktree, fetches,
  requires a clean/fresh target, and stops on conflicts. Strategy, push, worktree
  cleanup, and branch deletion all come from finish policy in config; use config
  explain to inspect the effective values. Valid strategies are ff_only,
  rebase_ff, squash, and merge_commit. The squash strategy requires --title and
  writes a commit body from --body, the source branch, and every source commit
  message; other strategies reject --title and --body.

Cleanup:
  Configured remove_worktree removes regular worktrees or frees pooled slots only
  after integration and configured push succeed. Configured delete_branch
  requires remove_worktree to be enabled in the same effective policy.
`,
	list: `
Use when:
  You need to discover existing worktrees, identify the canonical root, inspect
  branch/path/session identity, or decide whether an agent should reuse an
  existing checkout instead of creating one.

Notes:
  Reads Git's worktree inventory without loading config, scanning checkout
  contents, contacting remotes, or running setup. Missing pool slots are not
  created; use add or ensure to initialize them. With --json, the payload's
  worktrees array holds one item per registered worktree.

Related:
  status shows pool-focused slot state. path resolves one branch to its expected
  worktree path.
`,
	overview: `
Agent workflow:
  Pass --cwd <path> only when targeting a worktree set other than the current
  directory. Prefer --json when available: stdout is then one JSON object, on
  success and failure alike, and stderr stays silent. Branch on ok, kind, and
  reason rather than message text. Setup output and warnings are captured in the
  payload's setup_output and diagnostics.

Interactive wrappers:
  Human wrappers pass --interactive so add focuses the new worktree's multiplexer
  session, and remove/finish move the caller to the canonical root and close the
  removed worktree's sessions. Outside a multiplexer, the directory to change to is
  written to the file named by HONEYCOMB_CD_FILE. Agents must not pass it.

Common flows:
  honeycomb add --branch <feature> --json
  honeycomb list --json
  honeycomb tree
  honeycomb path --branch <feature>
  honeycomb remove --branch <feature> --json
  honeycomb remove --branch <feature> --integrated-into origin/main --json
  honeycomb finish --json
  honeycomb finish --title "<subject>" --json   # squash strategy
  honeycomb config explain --json

Pools:
  Pooled repositories reuse fixed slots instead of creating branch-named sibling
  directories. Run status and check hasPool to see whether remove/add use pooled
  slot semantics. Use remove for cleanup in both pooled and non-pooled repositories.

Safety:
  Unforced destructive operations refuse dirty, ahead, local-only, canonical-root,
  or otherwise ambiguous states. Use --force only when discarding local work is
  intentional.
`,
	path: `
Use when:
  A script or agent needs the expected checkout path for a branch without
  creating, switching, or removing anything.

Notes:
  Non-pooled repositories use sibling paths based on the canonical root and
  branch name. Pooled repositories may map active branches to reusable slot
  paths instead.
`,
	pick: `
Use when:
  A human wants to switch worktrees. pick needs a terminal; agents should use
  list or path instead.

Notes:
  Rows list every worktree, with * marking the one containing --cwd, and preview
  its multiplexer session or recent history. Inside tmux fzf opens in a popup.
  Without --open, the selected path is printed; with --interactive it is also
  written to the file named by HONEYCOMB_CD_FILE so a shell wrapper can change to
  it. --open requires --interactive and a multiplexer session. Cancelling exits
  130 without output.
`,
	remove: `
Use when:
  Cleaning up branch worktrees after work is done or abandoned. Use --branch for
  a named branch, or --self to remove the worktree containing the global --cwd
  path when a wrapper or agent wants to remove the checkout it is operating in.
  Pooled removal recycles an existing slot without initializing it or other slots.

Safety:
  The canonical root is protected. Without --force, removal refuses dirty or
  otherwise ambiguous work. Without --keep-branch, it also refuses ahead,
  local-only, or unmerged branches. --keep-branch removes only the clean
  checkout/slot occupancy and leaves the branch ref intact. For a clean branch
  squash-merged by a hosting platform, --integrated-into origin/main fetches the
  target and requires its source-relative changes to be content-equivalent before
  removing both checkout and branch. It cannot be combined with --force or
  --keep-branch.

Related:
  finish can integrate a completed worktree and then clean it up as one
  conservative lifecycle operation.
`,
	root: `
Use when:
  You need the repository anchor that honeycomb uses for config lookup, sibling path
  generation, default-branch policy, and root-protection checks.

Notes:
  The canonical root is never removed or recycled by honeycomb. Run this before
  reasoning about generated sibling paths or effective project configuration.
`,
	shellInit: `
Setup:
  zsh: add eval "$(honeycomb shell-init zsh)" to ~/.zshrc.
  Nushell: save honeycomb shell-init nu to honeycomb.nu in your config directory,
  then import it with use in config.nu.

Usage:
  wk picks a worktree and changes the current shell's directory.
  Arguments are passed to honeycomb --interactive pick, not other commands.
`,
	status: `
Use when:
  Deciding whether a repository is pooled and whether any slots can be removed
  for reuse. A size of 0 means regular non-pooled worktrees; size greater than 0
  means remove uses pool semantics.

Notes:
  Output is always JSON. Slot fields include branch, dirty state, placeholder
  status, last commit details, and initialization state.
`,
	tree: `
Use when:
  Visualizing current commit ancestry among registered worktrees, not which
  branch each worktree was originally created from.

Notes:
  Equal HEADs share a node marked "same HEAD"; nesting uses the nearest strict
  ancestor HEAD group. ? marks no known parent or multiple nearest ancestors;
  these nodes stay at the top level. Older integrated branches may appear above
  main. Bare and unborn worktrees have no HEAD and stay separate.
  Reads local Git history only (Git 2.45+); no config, setup, or remote access.
  Git errors fail the command rather than being treated as uncertain ancestry.
  --json emits kind "tree" with nodes containing id, worktrees, and parentage.
`,
};
