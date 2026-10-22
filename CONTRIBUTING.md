# Contributing to Hive

Read [Philosophy](./docs/PHILOSOPHY.md) for the project's scope and [AGENTS.md](./AGENTS.md) for contribution rules.

## Set up a source checkout

Install Git, Bun and mise, plus your platform's compiler/linker prerequisites for Rust. Mise provisions the pinned Rust toolchain; maintainer setup needs no Homebrew `br`. Put `~/.local/bin` before other Hive and `br` installations on `PATH`, then run from the canonical Hive checkout:

```nu
mise trust
mise run
```

The [setup recipe](./mise.toml) builds and installs Hive's workspace tools, runs `beads:install`, then bootstraps Beads. Follow [Beads setup](./docs/beads-integration.md#bootstrap-a-clone) for tracker requirements. [Repository commands](./docs/repository-commands.md#setup-and-automation) covers task discovery; [CLI artifacts](./lib/tooling/README.md#cli-artifacts) covers individual Hive builds and installation.

## Native Beads checkout

`beads:install` clones the [Beads fork](https://github.com/codethread/beads_rust) to `~/dev/projects/beads_rust` only when absent. It refuses a dirty checkout; preserve or commit/stash that work before retrying. For a clean checkout, it fetches the immutable revision only if missing and switches to that detached commit only when needed. It does not reset or clean away local work.

[`mise.toml`](./mise.toml) owns the fork and Rust pins. The task builds with the committed `Cargo.lock` and default features disabled, including upstream `self_update`. It reuses `~/dev/projects/beads_rust/target` for Cargo's build cache and copies the resulting `br` into `~/.local/bin` through Beeswax's artifact installer. Repeated setup reuses that checkout and cache, rather than a temporary Cargo installation. Once Beeswax is installed, rebuild only this dependency with `mise run beads:install`.

The task warns if the caller's `PATH` selects another `br` or none. Default setup then prepends `~/.local/bin` for its own tracker bootstrap; it does not repair the caller's persistent environment. Before subsequent tracker operations, verify that the resolved `br version --json` reports the pinned commit without `self_update` and `br sync --help` exposes `--from` and `--base`. Stock and patched builds can both report `0.7.6`; the version alone is not capability proof. Colony inherits `PATH` at startup, so coordinate active work before restarting it to adopt a changed path.

### Native dependency upkeep

Maintain the small fork patch while reviewing upstream updates. Change the immutable revision and any required Rust pin deliberately, keep the [Homebrew recipe](./Formula/hive.rb) aligned, rebuild, then run the [native contract suite](./lib/tooling/README.md#beads-contract-tests) before adoption. Use the pinned setup task, not `br upgrade`, which targets upstream releases. Retire the fork only when an upstream candidate provides the required capability and passes those contracts; update both installation routes together.

The [release guide](./docs/releases.md#native-beads-dependency) owns Homebrew-user installation. The [documentation index](./docs/README.md) routes development, architecture and integration references.
