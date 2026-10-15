---
name: repository-setup
description: Configure or refresh a repository's Beads tracker, merge driver and Git hook adapters through Beeswax.
---

Use `beeswax setup --help` to discover setup options. Supply explicit flags in one invocation when running as an agent; `--json` and non-TTY invocations never prompt.

Choose the tracker operation from observed repository state:

```text
Existing selected database -> --tracker adopt --beads-db PATH
Published tracker/state   -> --tracker bootstrap
First tracker, authorized -> --tracker init --prefix PREFIX --owner HUMAN
Git integration only      -> --tracker none
```

Preserve the selected database and accepted history. Initialization leaves the first snapshot and upstream for deliberate establishment before publication.

Use `beeswax schema` when preparing `.hive/beeswax/config.toml`; name the actual hook files, with application policy outside the generated sections. Commit the config and `.hive/beeswax/meta/lock.json`. Use `beeswax sync --help` to reproduce the accepted setup locally and `beeswax update --help` for a reviewed configuration or release change.

Verify the reported effects and affected hooks before reporting completion. On failure, use the completed-phase receipt to identify remaining work and follow the reported migration command:

- Hook insertion, edited sections or displaced application hooks: `beeswax migrate hooks` prints the [hook migration task](references/hook-migration.md).
- Changed hook paths or unsupported project metadata: `beeswax migrate setup` prints the [setup migration task](references/setup-migration.md).

These commands only supply instructions. Resolve remaining decisions with the user; preserve already agreed policy, including the permanent tracker's application hooks.

At an authorized remote exchange or integration checkpoint, read [publication guidance](references/publication.md) with `beeswax skills file repository-setup references/publication.md`. Setup and local sync do not publish tracker changes.
