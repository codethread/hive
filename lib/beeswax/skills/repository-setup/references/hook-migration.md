# Migrate repository hooks with the user

Integrate Beeswax with the repository's existing Git hooks, using the user's agreed policy. This command prints the task and makes no changes.

Reach these outcomes:

- Git invokes the configured `hooks.pre_commit` and `hooks.pre_merge_commit` files in the canonical checkout, linked worktrees and permanent tracker. Application checks, custom hooks and commit-message policy are preserved unless the user chooses to change them.
- Snapshot-only tracker commits validate staged JSONL through the installed Beeswax CLI, independently of disposable checkouts and application dependencies.
- The selected database, accepted tracker history and snapshot-only publication scope remain intact.
- Repeating local sync succeeds, and affected hook behavior is verified.

Start from the reported conflict. Inspect effective Git hook configuration and its origins, worktree overrides, hook files, `.hive/beeswax/config.toml`, `.hive/beeswax/meta/lock.json` and local Git-metadata receipts. Read `beeswax setup --help` and `beeswax sync --help` for the installed version's deterministic operations.

Walk the user through remaining decisions about behavior, file paths and insertion points. Pin the agreed POSIX-shell files as `hooks.pre_commit` and `hooks.pre_merge_commit`. Insert the installed release's exact `# beeswax:begin tracker-validation v1` / `# beeswax:end tracker-validation` section at the agreed point, preserving surrounding bytes and file mode. Obtain it from that release's documentation or a generated hook in a disposable repository. Keep application checks and any snapshot exemption outside the section: successful validation returns to the caller. Local receipts cannot approve custom section contents. When moving paths, remove only verified old owned sections.

Retain another hook framework with `bootstrap.hooks = "none"` and its actual shell hook files. The permanent tracker uses the same configured pair. Beeswax requires those files to contain the exact section before binding its CLI and bootstrapping the framework; it leaves tracked tracker hooks unchanged.

For a first tracker, initialization starts from the canonical checkout's `HEAD`. Prepare versioned hooks with `beeswax setup --tracker none`, review the project contract and hook sections, and have the agreed changes committed into that checkout's history before `--tracker init`. Uncommitted application hooks will not reach the new tracker. Paths under `.git/` instead resolve within shared Git metadata.

For an existing tracker, agree any required hook-file changes with the user while preserving accepted history and application policy. Account for custom hooks and effective Git settings when replacing an earlier integration; remove only verified obsolete generated files within the authorized migration scope.

Apply agreed changes using CLI operations where supported. Verify affected hooks in each checkout with valid and invalid staged JSONL, ordinary application changes and commit-message arguments. Confirm unrelated hooks still run and the tracker has no unexpected changes.

Report behavior, verification and unresolved decisions. Stay within the user's migration scope; this task grants no additional authority to commit, publish or delete custom hooks.
