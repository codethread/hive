# Migrate the Beeswax project contract with the user

Restore a reproducible Beeswax setup when the CLI cannot establish a deterministic upgrade path. This command prints the task and makes no changes. Use the user's existing decisions and resolve remaining choices with them.

Reach these outcomes:

- `.hive/beeswax/config.toml` names the agreed integration points, and `.hive/beeswax/meta/lock.json` pins their accepted generation and release.
- Each checkout can reproduce that contract with `beeswax sync`, binding executable paths locally. Local receipts describe installed outputs; they do not override the committed contract.
- Application policy, the selected database, accepted tracker history and publication rules are preserved.

Inspect the reported mismatch, configuration, lock, receipts and effective Git settings. Establish what was generated, what changed and which release is intended. Use `beeswax schema` and `beeswax update --help` to discover supported transitions. For hook changes, follow `beeswax migrate hooks`; when moving paths, account for old owned sections before changing the lock.

Explain undecided changes and their consequences to the user before applying them. Use deterministic CLI operations where supported; keep machine-specific paths and actors out of the portable contract. Verify affected behavior and repeat local sync with the accepted release. Report results and unresolved work. Stay within the agreed migration scope; this task grants no additional authority to commit, publish or delete custom integration.
