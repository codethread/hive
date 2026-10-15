# Migrate repository hooks with the user

Integrate Beeswax at the agreed hook paths and insertion points, preserving application checks, custom hooks, commit-message policy, the selected database and accepted tracker history. This task grants no additional authority to commit, publish or delete custom hooks.

Inspect the reported conflict, effective Git settings and origins, worktree overrides, hook files, project config/lock and local receipts. Walk the user through unresolved decisions; retain existing agreements.

Configure `hooks.pre_commit` and `hooks.pre_merge_commit` as the actual POSIX-shell files invoked in application checkouts and the permanent tracker. Retain another framework with `bootstrap.hooks = "none"`. Obtain the installed release's exact `tracker-validation` section from a generated hook in a disposable repository. Insert it without changing surrounding bytes or file mode. Keep application checks and snapshot exemptions outside it: successful validation returns to the caller. Receipts cannot approve custom section contents. When moving paths or replacing an integration, remove only verified obsolete generated sections/files within scope.

For a first tracker, follow the canonical-checkout preparation in `beeswax setup --help`. For an existing tracker, prepare the same configured hook pair with the user: setup binds and bootstraps those files but leaves their tracked contents unchanged.

Apply supported operations through the CLI. Repeat local sync and verify affected hooks in each checkout: valid and invalid staged JSONL, ordinary application changes, commit-message arguments and unrelated custom hooks. Snapshot-only validation must work without application dependencies or disposable checkouts. Confirm the tracker has no unexpected changes, then report verification and unresolved decisions.
