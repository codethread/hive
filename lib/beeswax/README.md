# Beeswax

Beeswax owns reusable repository plumbing: Beads setup and publication, JSONL merging and validation, Git hook adapters and built executable installation. Hive uses the same CLI as consuming repositories.

## Install

From a Hive checkout with dependencies installed:

```sh
bun run --filter @hive/beeswax build
bun run --filter @hive/beeswax install:bin
beeswax --help
```

The standalone executable includes Bun, bundled setup instructions and the unmodified Husky 9.1.7 runner with its [MIT license](assets/HUSKY-LICENSE). Consuming repositories need Git and native `br`; tracker creation also needs installed Honeycomb. Mise is required only when that integration is selected. Installing hooks does not require application JavaScript dependencies; running application checks may require them.

## Configure a repository

```sh
beeswax setup
```

In a terminal, Clack asks for missing choices. Use `beeswax setup --help` for the same choices as flags and their defaults. JSON and non-TTY invocations never prompt; `--yes` also skips prompts in a terminal. Without a known database, headless setup requires an explicit tracker choice before making changes.

For an existing tracker:

```sh
beeswax setup --tracker adopt --beads-db /absolute/tracker/.beads/beads.db \
  --hooks husky --environment none --no-codex --yes --json
```

Use `--tracker bootstrap` for a clone with accepted `origin/tracker/state` history. It imports an absent database and preserves an existing one. `--tracker none` configures Git integration without tracker changes.

First initialization starts from the canonical checkout's `HEAD`. For versioned hooks, run `--tracker none` first, review the generated project contract and hook sections, and commit them into that checkout's history before `--tracker init --prefix app --owner operator`. Retain the initialization receipt and deliberately establish the first snapshot and upstream before publication.

`--beads-db` overrides `BEADS_DB`; otherwise setup looks for the canonical checkout's tracker. `--actor` or `BD_ACTOR` supplies tracker attribution. Setup stays local; publication is a separate `beeswax beads sync` operation.

## Commit the project contract

Commit `.hive/beeswax/config.toml` and `.hive/beeswax/meta/lock.json`. The configuration names the actual integration points; application linting, type checks and commit-message policy remain in your own hook files.

```toml
[bootstrap]
hooks = "husky"

[hooks]
pre_commit = ".husky/pre-commit"
pre_merge_commit = ".husky/pre-merge-commit"
```

`--pre-commit` and `--pre-merge-commit` set these POSIX-shell file paths during setup. `--hooks git` selects Git's direct hook directory. `--hooks none` skips framework bootstrap; it still generates validation sections. For another framework, set `bootstrap.hooks = "none"` and name the files that framework invokes. Use `beeswax schema` for the configuration and lock schemas.

Beeswax generates a minimal shell hook when a configured file is absent. In a mixed file it owns only this exact section, preserving surrounding bytes and file mode:

```sh
# beeswax:begin tracker-validation v1
"$(git rev-parse --git-path beeswax/cli)" hooks validate || exit $?
# beeswax:end tracker-validation
```

The section validates snapshot-only commits on `tracker/state`, then returns to the surrounding hook. Any decision to skip application checks belongs outside the section. An unmarked file or edited section requires `beeswax migrate hooks`; changed paths or unsupported project metadata require `beeswax migrate setup`. These commands print goals for an agent to work through with you and make no changes.

The lock pins the release, normalized configuration digest, component revisions, bundled instruction IDs and owned-section hashes. `beeswax sync` reproduces that contract locally; `beeswax update` advances it after review. Neither publishes tracker changes. Unknown upgrade paths require migration with the user.

Hive's release preparation runs `bun run beeswax lock` after bumping package manifests and `bun.lock`, when Beeswax is configured. It refreshes the committed lock to the source CLI's package version without installing the unpublished release. See `beeswax lock --help` for prerequisites.

Each checkout gets a launcher and observation receipt under `git rev-parse --git-path beeswax`. The launcher binds to an absolute installed Beeswax command whose version setup verifies. Receipts describe local outputs; the committed contract remains authoritative. Run sync in each checkout to bind it locally, and again after relocating a clone.

The permanent tracker uses the same `[hooks]` pair. Its files must already contain the exact validation section before Beeswax binds the installed CLI and bootstraps the configured framework. Setup leaves tracked tracker hooks unchanged. If the tracker predates those hooks, use `beeswax migrate hooks` to agree changes that preserve its application policy and accepted history.

## Operate the tracker

```sh
beeswax beads env --json
beeswax beads setup --beads-db /absolute/tracker/.beads/beads.db --environment mise
beeswax beads bootstrap --environment mise
beeswax beads sync
```

Environment setup and session hooks stay local. `beeswax beads sync` receives and publishes the tracker snapshot under a shared lock; preserve the permanent checkout, database and unpublished history when resolving conflicts. For Hive's exchange checkpoints and recovery procedure, see [Beads integration](../../docs/beads-integration.md). Discover Git merge and staged-validation protocols with `beeswax git --help`.

## Source bootstrap and artifacts

Hive's [setup recipe](../../docs/repository-commands.md#setup-and-automation) orders dependency installation, executable installation, tracker bootstrap and local Beeswax sync. [CLI artifacts](../tooling/README.md#cli-artifacts) covers build and installation; `beeswax artifacts install --help` lists installer options.

## Bundled instructions

```sh
beeswax skills list --json
beeswax skills get repository-setup
beeswax skills file repository-setup references/publication.md
```

These reads work offline outside a repository. Finite JSON commands emit one document on stdout with silent stderr, including errors. Help remains plain text. Setup failures identify completed phases so successful effects need not be repeated blindly.
