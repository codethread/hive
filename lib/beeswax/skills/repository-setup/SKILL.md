---
name: repository-setup
description: Set up or update repository trackers, Git hooks and harness onboarding with Beeswax; resolve migration handoffs and tracker publication.
---

Use `beeswax setup --help` for options and first-initialization prerequisites. Supply explicit choices as an agent. Preserve the selected database and accepted tracker history:

```text
Existing selected database -> adopt
Published tracker/state   -> bootstrap
First tracker, authorized -> init
Git integration only      -> none
```

For an existing project contract, use `beeswax sync --help` to reproduce it locally or `beeswax update --help` for a reviewed change. Use `beeswax schema` for configuration and lock formats. Keep machine paths and actors out of the committed contract.

When implementation inspection is needed, use `beeswax info --help` for release provenance and source retrieval. It reports source availability explicitly; do not infer a matching source tree from an unrelated checkout.

For harness onboarding, follow setup/update help for selection and trust requirements. Commit the selected generated files with the contract and run sync in each checkout. Verify that the actual execution checkout has those files and the matching Beeswax executable on the harness's `PATH`.

## Complete the handoff

Use the setup receipt's `readiness` handoff before declaring onboarding complete. It reports configured artifacts and effective Honeycomb policy; execution remains unverified. Review the consuming repository's remaining needs:

- **Beads:** verify selected storage with `beeswax beads env --json`. Review the repository's agent instructions for actor/owner attribution, claims, human reservations, verification, closure and publication checkpoints. Setup does not establish that contribution policy.
- **Honeycomb:** review the receipt's effective policy, or refresh it with `honeycomb config explain --json`. Report reused policy separately from newly generated files. Preserve valid configuration; resolve worktree location, bootstrap and finish choices through `honeycomb --help` and `honeycomb skills get git-workflow`.
- **Bee/BV:** follow `bee setup --help` for the attention query and work/system views. BV shares `BEADS_DB`, but project recipes come from each checkout; verify discovery in both application and permanent tracker checkouts.
- **Managed execution:** when Bee workers are in scope, read `colony skills get operations` for kind configuration, deliberate activation and the first execution check. Harness onboarding adapters alone do not configure workers or install workflows.

Report what was created, reused, verified and left pending.

## Resolve setup failures and publication

On failure, inspect completed phases and any `trackerEffects` before retrying; checkout and database artifacts can remain after a failed native command. Follow the reported migration task, retaining agreed policy:

- Hook insertion, edited sections or missing tracker hooks: [hook migration](references/hook-migration.md), also printed by `beeswax migrate hooks`.
- Changed hook paths, unsupported project metadata or ambiguous onboarding: [setup migration](references/setup-migration.md), also printed by `beeswax migrate setup`.

At an authorized remote exchange or integration checkpoint, read [publication guidance](references/publication.md). Retrieve linked resources with `beeswax skills file repository-setup PATH`.
