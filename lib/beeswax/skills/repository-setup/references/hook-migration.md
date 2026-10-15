# Migrate repository hooks with the user

Integrate Beeswax with the repository's existing Git hooks, using the user's agreed policy. This command prints the task and makes no changes.

Reach these outcomes:

- Git invokes the intended hooks in the canonical checkout, linked worktrees and permanent tracker. Application checks, custom hooks and commit-message policy are preserved unless the user chooses to change them.
- Snapshot-only tracker commits validate staged JSONL through the installed Beeswax CLI, independently of disposable checkouts and application dependencies.
- The selected database, accepted tracker history and snapshot-only publication scope remain intact.
- Repeating local sync succeeds, and affected hook behavior is verified.

Start from the reported conflict. Inspect effective Git hook configuration and its origins, worktree overrides, hook files, `.hive/beeswax/config.toml`, `.hive/beeswax/meta/lock.json` and local Git-metadata receipts. Read `beeswax setup --help` and `beeswax sync --help` for the installed version's deterministic operations.

Walk the user through remaining decisions about behavior, file paths and insertion points. Pin the agreed POSIX-shell files as `hooks.pre_commit` and `hooks.pre_merge_commit`. Insert the installed release's exact `# beeswax:begin tracker-validation v1` / `# beeswax:end tracker-validation` section at the agreed point, preserving surrounding bytes and file mode. Obtain it from that release's documentation or a generated hook in a disposable repository. Keep application checks and any snapshot exemption outside the section: successful validation returns to the caller. Local receipts cannot approve custom section contents. When moving paths, remove only verified old owned sections.

Retain another hook framework with `bootstrap.hooks = "none"` and its actual file paths. If the permanent tracker needs private hooks because its HEAD predates the integration, declare its existing application entrypoints in `tracker.hooks`. Preserve pre-commit, pre-merge-commit and commit-msg behavior, arguments and exit status. Select the private directory only for that worktree; account for every other hook it would displace before changing the selection. Preserve tracked tracker files and history.

Apply agreed changes using CLI operations where supported. Verify affected hooks in each checkout with valid and invalid staged JSONL, ordinary application changes and commit-message arguments. Confirm unrelated hooks still run and the tracker has no unexpected changes.

Report behavior, verification and unresolved decisions. Stay within the user's migration scope; this task grants no additional authority to commit, publish or delete custom hooks.
