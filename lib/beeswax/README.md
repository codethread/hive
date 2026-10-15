# Beeswax

Beeswax configures Beads trackers, snapshot publication, JSONL merging, Git hooks and executable installation. Hive uses the same CLI as consuming repositories.

## Install

From a Hive checkout with dependencies installed:

```sh
bun run --filter @hive/beeswax build
bun run --filter @hive/beeswax install:bin
```

The standalone executable bundles Bun and the unmodified Husky 9.1.7 runner ([MIT license](assets/HUSKY-LICENSE)). Consuming repositories need Git and native `br`; tracker creation also needs Honeycomb. Mise is optional. Installing hooks requires no application dependencies; running application checks may require them.

## Configure a repository

Run `beeswax setup` for the interactive wizard or `beeswax setup --help` for headless options, tracker selection and first-initialization prerequisites. Setup and session hooks stay local. `beeswax beads sync` receives and publishes tracker changes.

## Commit the project contract

Commit `.hive/beeswax/config.toml` and `.hive/beeswax/meta/lock.json`. Configuration names the actual hook files and bootstrap adapter; the lock pins the accepted release and generation. Discover their schemas with `beeswax schema`.

Beeswax owns only the marked `tracker-validation` section in each configured hook, preserving surrounding bytes and file mode. It validates snapshot-only commits on `tracker/state`, then returns to the surrounding hook. Application checks, commit-message policy and any snapshot exemption remain application-owned.

The permanent tracker uses the same configured hook pair. Those files must already contain the exact validation section before setup binds the installed CLI and bootstraps the framework; setup leaves tracked tracker hooks unchanged.

`beeswax sync` reproduces the committed contract locally; `beeswax update` advances it after review. Each checkout gets a launcher and observation receipt in Git metadata. The committed contract is authoritative; receipts describe local outputs. Run sync in each checkout and after relocating a clone.

Ambiguous hooks or project metadata require interpretation: `beeswax migrate hooks` and `beeswax migrate setup` print agent tasks for resolving the reported conflict with you. These commands make no changes.

## Operate the tracker

Use `beeswax beads env --json` to inspect the selected tracker. For Hive's publication checkpoints and recovery, see [Beads integration](../../docs/beads-integration.md). Discover merge and staged-validation protocols with `beeswax git --help`.

Hive's [setup recipe](../../docs/repository-commands.md#setup-and-automation) coordinates installation and local configuration. [CLI artifacts](../tooling/README.md#cli-artifacts) covers build and installation. For release lock refreshes, read `beeswax lock --help`.

## Bundled instructions

Agent setup decisions and conditional migration/publication guidance are available offline, including outside a repository:

```sh
beeswax skills list --json
beeswax skills get repository-setup
beeswax skills file repository-setup references/publication.md
```
