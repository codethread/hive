# Migrate the Beeswax project contract with the user

Restore a contract each checkout can reproduce with `beeswax sync`. Preserve application policy, the selected database, accepted tracker history and publication rules. This task grants no additional authority to commit, publish or delete custom integration.

Inspect the reported mismatch, `.hive/beeswax/config.toml`, `.hive/beeswax/meta/lock.json`, local receipts and effective Git settings. Establish the intended release and generation using `beeswax schema` and `beeswax update --help`; receipts are observations, not accepted intent.

For `onboarding_ambiguous`, inspect the reported `path`, `observed` and `desired` alongside the saved harness selection. Agree the intended onboarding with the user and resolve unfamiliar commands/options or incomplete/duplicate markers, preserving unrelated settings and code. Recognized JSON entries use a `Beeswax onboarding vN` status message and the supported `beeswax prime` command; Pi owns the section between `// beeswax:begin onboarding vN` and `// beeswax:end onboarding`. Routine recognized version or filter changes are automatic. The handoff concerns ownership that Beeswax cannot establish.

For `bv_recipes_ambiguous`, inspect the reported `path`, `observed` and `desired`. Agree ownership with the user before resolving unmarked `_hive_` recipe collisions or malformed YAML. The managed section runs from `# beeswax:begin bv-recipes v1` to `# beeswax:end bv-recipes` and holds only the required Hive definitions. Preserve personal recipes and comments outside it, including generic `work`, `system` and `workflows`. Repair incomplete, duplicate or unfamiliar markers before retrying.

Resolve remaining choices with the user and apply supported CLI operations. For hook changes, follow `beeswax migrate hooks`, accounting for old owned sections before changing the lock. Keep machine paths and actors out of the portable contract. Verify affected behavior and repeat sync with the accepted release; report results and unresolved work.
