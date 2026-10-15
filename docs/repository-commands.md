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

`bun run test:all` and `bun run test:changed` exclude native Beads conformance tests from ordinary discovery. Consumer behavior tests use memory. Native contracts under `lib/beads/tests/contract/` run as a separate complete suite when any of these inputs changes:

- `lib/beads/src/**` (native adapter, memory implementation, consumed types and schemas).
- `lib/beads/tests/contract/**` (contract cases and their local fixtures).
- `lib/beads/package.json`, root `package.json`, `bun.lock`, `bunfig.toml`, or `mise.toml` (package resolution, runtime/test settings and dependency configuration).

Selection includes branch changes since the merge base with `main`, staged and unstaged changes, and untracked files. A forwarded `--changed=<ref>` uses that comparison reference instead; bare `--changed` compares with `HEAD`. Consumer source, shared barrels and documentation alone do not select native contracts. Keep contract helpers inside the contract directory and import adapter modules directly, so contract inputs remain independent of consumers. Changes to the installed `br` executable outside Git require an explicit contract run.

Run `bun run test:contracts` to verify the entire native contract suite explicitly, even on a clean checkout. Automatic contracts run in full regardless of ordinary-suite file/name filters or Bun's dependency graph. The explicit command takes no filters; use `bun test ./lib/beads/tests/contract/ -t 'case'` for focused contract iteration. All runner suites use two workers and a five-second default per-test timeout; individual tests may specify longer timeouts. Ordinary changed runs report timing warnings; full and contract runs enforce the existing unapproved `DANGER` gate, retaining Bun diagnostics and JUnit timing reports independently for each suite.

## Recipe ownership

[`package.json`](../package.json) owns reusable execution recipes and Bun lifecycle hooks. Package manifests retain workspace test, build and `install:bin` contracts. Mise provides a curated catalog over those recipes and the focused `bun test` command; it does not enumerate package aliases or product CLI subcommands.

Root formatting, linting, typechecking and test recipes compose `check`. Git hooks also call `typecheck`. `test:all` and `test:changed` share the test runner's flags and reporting. The `waggle` and `busybee` root launchers run checkout-owned CLIs without requiring a global installation. The [Hive UI guide](../lib/hive-ui/README.md) uses its package's `start` and `dev` scripts directly.

## Setup and automation

The hidden `default` task is the deliberate setup operation: `mise run` installs dependencies, builds package-local executables, installs the built binaries, then bootstraps the tracker. It remains available in `mise tasks ls --local --hidden`. See [CLI artifacts](../lib/tooling/README.md#cli-artifacts) for build/install details and [Beads integration](./beads-integration.md) for tracker setup and recovery.

Bun's `prepare` lifecycle calls `beeswax prepare` through the workspace bin to inherit an existing tracker environment before binaries exist. After bootstrap, the default Mise task calls `beeswax sync` to materialize Git integration from the committed project contract. The root `beads:*` recipes delegate to Beeswax; Pi calls `beeswax beads env --json` for its session environment. These operations stay outside the everyday catalog. [Development toolchain](./integrations.md#development-toolchain) describes environment and hook responsibilities.

`beads:sync` explicitly receives and publishes tracker state at the [publication checkpoints](./beads-integration.md#synchronization-checkpoints); it is not part of setup or session hooks. Mise's existing environment selection and Colony watchdog configuration remain independent of task discovery.
