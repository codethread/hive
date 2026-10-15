---
name: repository-setup
description: Configure or refresh a repository's Beads tracker, merge driver and Git hooks through Beeswax.
---

Use `beeswax setup --help` for options and first-initialization prerequisites. Supply explicit choices as an agent. Preserve the selected database and accepted tracker history:

```text
Existing selected database -> adopt
Published tracker/state   -> bootstrap
First tracker, authorized -> init
Git integration only      -> none
```

For an existing project contract, use `beeswax sync --help` to reproduce it locally or `beeswax update --help` for a reviewed change. Use `beeswax schema` for configuration and lock formats. Keep machine paths and actors out of the committed contract.

On failure, use the completed-phase receipt to identify remaining work. Follow the reported migration task, retaining already agreed policy:

- Hook insertion, edited sections or missing tracker hooks: [hook migration](references/hook-migration.md), also printed by `beeswax migrate hooks`.
- Changed hook paths or unsupported project metadata: [setup migration](references/setup-migration.md), also printed by `beeswax migrate setup`.

At an authorized remote exchange or integration checkpoint, read [publication guidance](references/publication.md). Retrieve linked resources with `beeswax skills file repository-setup PATH`.
