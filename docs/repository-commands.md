# Repository commands

Run `mise tasks ls --local` when you need to discover repository tasks. The catalog in [`mise.toml`](../mise.toml) describes common operations; `mise run TASK --help` explains task arguments. Known Bun commands remain direct entry points.

## Test selection

The test entries select a file, package test scripts, or tests affected by changes from `main`:

```sh
mise run test ./lib/shared/src/bees.test.ts
mise run test ./lib/shared/src/bees.test.ts -- -t 'omitted recipe prompts'
mise run test:package @hive/shared
mise run test:package '@hive/sh*' -- -t 'recipe'
mise run test:changed
mise run test:changed -- ./lib/shared/src/bees.test.ts
```

`test` requires a file path relative to the repository root. `test:package` requires a Bun workspace name or glob and runs matching packages' `test` scripts with their own defaults. Packages without a `test` script need focused files. Arguments after `--` are forwarded as separate arguments, preserving quoted values.

Focused files are useful during iteration; package scripts cover a wider affected scope. Changed tests use the shared timing reporter described in [Repository tooling](../lib/tooling/README.md#test-timing-report-and-landing-gate). The `check` entry runs final comprehensive verification; the [Land workflow](../.workflows/land/workflow.ts) owns its completion checks, and [AGENTS.md](../AGENTS.md#validation) covers the gate outside Land.

## Recipe ownership

[`package.json`](../package.json) owns reusable execution recipes and Bun lifecycle hooks. Package manifests retain workspace test, build and `install:bin` contracts. Mise provides a curated catalog over those recipes and the focused `bun test` command; it does not enumerate package aliases or product CLI subcommands.

Root formatting, linting, typechecking and test recipes compose `check`. Git hooks also call `typecheck`. `test:all` and `test:changed` share the test runner's flags and reporting. The `waggle` and `busybee` root launchers run checkout-owned CLIs without requiring a global installation. The [Hive UI guide](../lib/hive-ui/README.md) uses its package's `start` and `dev` scripts directly.

## Setup and automation

The hidden `default` task is the deliberate setup operation: `mise run` installs dependencies, builds package-local executables, installs the built binaries, then bootstraps the tracker. It remains available in `mise tasks ls --local --hidden`. See [CLI artifacts](../lib/tooling/README.md#cli-artifacts) for build/install details and [Beads integration](./beads-integration.md) for tracker setup and recovery.

Bun's `prepare` lifecycle installs Git hooks, configures the merge driver and selects the tracker environment for the checkout. It calls the Git setup implementation directly. `beads:bootstrap` and `beads:setup` remain maintenance recipes; Pi calls `beads:env --json` for its session environment. These operations stay outside the everyday catalog. [Development toolchain](./integrations.md#development-toolchain) describes environment and hook responsibilities.

`beads:sync` explicitly receives and publishes tracker state at the [publication checkpoints](./beads-integration.md#synchronization-checkpoints); it is not part of setup or session hooks. Mise's existing environment selection and Colony watchdog configuration remain independent of task discovery.
