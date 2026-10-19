# Repository commands

Discover repository tasks with `mise tasks ls --local`; read their arguments with `mise run TASK --help`.

## Test selection

[Repository tooling](../lib/tooling/README.md#beads-contract-tests) covers native-contract selection caveats and [timing reports](../lib/tooling/README.md#test-timing-report-and-landing-gate). Verification requirements belong to the [Land workflow](../.workflows/land/workflow.ts) and, outside Land, [AGENTS.md](../AGENTS.md#validation).

## Recipe ownership

[`mise.toml`](../mise.toml) defines the task catalog; [`package.json`](../package.json) and workspace manifests own execution recipes and lifecycle hooks.

## Setup and automation

Run `mise run` from the Hive checkout you intend to use for a full source bootstrap. Its hidden `default` task installs dependencies, builds and installs matching CLIs, configures the tracker and Bee, then syncs the checkout's accepted Beeswax contract. Discover the task with `mise tasks ls --local --hidden`.

Plain `bun install` runs checkout preparation and `beeswax sync`, so it requires the Beeswax release accepted by the checkout's lock and, for selected harnesses, matching Scent. The source bootstrap skips Hive's prepare hook during dependency installation, retaining dependency lifecycle scripts, then builds the CLIs before checkout setup.

Hive's [Honeycomb configuration](../.hive/honeycomb.toml) runs this bootstrap in the created checkout. `honeycomb add --skip-command` leaves that checkout's harness unprepared; run `mise run` there before starting the harness. [Per-checkout preparation](../lib/beeswax/README.md#prepare-each-checkout) covers branch changes, worktree reuse and relocation.

See [CLI artifacts](../lib/tooling/README.md#cli-artifacts) for builds and installation, [Beeswax](../lib/beeswax/README.md#configure-a-repository) for setup and hooks, and [Beads integration](./beads-integration.md#synchronization-checkpoints) for tracker exchange checkpoints.
