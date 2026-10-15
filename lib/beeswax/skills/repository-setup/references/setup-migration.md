# Migrate the Beeswax project contract with the user

Restore a contract each checkout can reproduce with `beeswax sync`. Preserve application policy, the selected database, accepted tracker history and publication rules. This task grants no additional authority to commit, publish or delete custom integration.

Inspect the reported mismatch, `.hive/beeswax/config.toml`, `.hive/beeswax/meta/lock.json`, local receipts and effective Git settings. Establish the intended release and generation using `beeswax schema` and `beeswax update --help`; receipts are observations, not accepted intent.

Resolve remaining choices with the user and apply supported CLI operations. For hook changes, follow `beeswax migrate hooks`, accounting for old owned sections before changing the lock. Keep machine paths and actors out of the portable contract. Verify affected behavior and repeat sync with the accepted release; report results and unresolved work.
