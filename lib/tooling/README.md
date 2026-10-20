# Repository tooling

## Beads contract tests

Tracker bootstrap checks exercise real Git, filesystem, `br` and `mise` boundaries in [`bootstrap.contract.test.ts`](../beeswax/src/beads/bootstrap.contract.test.ts). Native/in-memory Beads API conformance lives in [`lib/beads/tests/contract/`](../beads/tests/contract/).

Run `bun run test:contracts` for the complete conformance suite, including after changing the installed `br` outside Git. Ordinary `test:all` and `test:changed` runs select those contracts separately from Bun's discovery when Beads source, contract files or dependency/runtime configuration changes. Consumer-only changes do not select them. Selected contracts run in full regardless of ordinary-suite file/name filters. [`test-selection.ts`](src/test-selection.ts) owns the exact inputs; [`test-runner.ts`](src/test-runner.ts) owns comparison references and argument handling.

## Test timing report and landing gate

`bun run test:changed` forwards Bun test arguments and defaults to changes from `main`. Full, changed and contract runs share parallelism and timeout settings. The runner parses a temporary JUnit report and prints passing tests above their allowed severity, slowest first:

```text
lib/example.test.ts:42 XSLOW 20.345ms suite > test description
```

[`slow-tests.json`](./slow-tests.json) owns cutoffs and approved allowances. Severity is the highest cutoff strictly exceeded. Ordinary changed-test runs use the exact configured cutoffs. Full and contract runs multiply every cutoff by 1.25, giving a 25% buffer, including transitions above an allowed severity. Selected contracts use this buffer during `test:changed` too. Every run fails on unapproved `SLOW`, `XSLOW` or `DANGER` timings, even when all assertions pass. The buffer changes timing classification only; Bun's five-second timeout is unchanged.

Bun failures retain native diagnostics and exit status, including errors JUnit omits. Failed/skipped tests add no timing lines; an empty changed selection is quiet. Missing or malformed required reports fail visibly. Temporary reports are removed after execution.

### Allowed slow tests

Each registry entry pairs a stable `#test-N` ID with a justification and maximum permitted severity. Put the ID in the test or enclosing suite title; retain it across moves. Matching uses the complete numeric ID. Allocate the next unused ID.

An allowance suppresses timing output and timing gate failure through its permitted severity. It never suppresses assertion failures or changes timeouts. Every registry edit requires explicit user approval of the exact change and its measured-cost justification.

## CLI artifacts

From the Hive root, `bun run --filter '*' build` writes package-local `dist/` executables. Workspace manifests own the artifact names and build flags. `tsc --noEmit` remains the separate typechecking gate.

Standalone executables embed Bun and static dependencies; native external tools remain required. Busy Bee loads trusted workflows and their dependencies from the selected checkout, with package metadata and TypeScript configuration loading enabled for imports and path aliases. Waggle reads classifiers from the selected directory. Neither catalog is baked into its executable.

`bun run --filter '*' install:bin` installs already-built artifacts through Beeswax; see `beeswax artifacts install --help` for source/destination options. Installation replaces destination symlinks without modifying their targets. Keep Colony's daemon, worker and watchdog companions beside `bee` and `colony`; deliberately restart an existing daemon after updating its runtime.

[`mise.toml`](../../mise.toml) owns setup ordering. `bun install` prepares a worktree without installing global commands. For Homebrew installation from tagged source, see the [release guide](../../docs/releases.md#homebrew-installation).

## Release tooling

`bun run release --help` describes local version, release-note and per-tool changelog preparation. The [release guide](../../docs/releases.md#author-tool-changelog-records) owns the versioned commit-body record format and review of generated histories. The [release workflow](../../.workflows/release/workflow.ts) owns source publication and the later Homebrew formula change. Ordinary Land leaves version bumps and versioned history generation to Release.
