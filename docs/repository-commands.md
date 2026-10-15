# Repository commands

Discover repository tasks with `mise tasks ls --local`; read their arguments with `mise run TASK --help`.

## Test selection

[Repository tooling](../lib/tooling/README.md#beads-contract-tests) covers native-contract selection caveats and [timing reports](../lib/tooling/README.md#test-timing-report-and-landing-gate). Verification requirements belong to the [Land workflow](../.workflows/land/workflow.ts) and, outside Land, [AGENTS.md](../AGENTS.md#validation).

## Recipe ownership

[`mise.toml`](../mise.toml) defines the task catalog; [`package.json`](../package.json) and workspace manifests own execution recipes and lifecycle hooks.

## Setup and automation

Run `mise run` for checkout setup. Its hidden `default` task appears in `mise tasks ls --local --hidden`. See [CLI artifacts](../lib/tooling/README.md#cli-artifacts) for builds and installation, [Beeswax](../lib/beeswax/README.md#configure-a-repository) for setup and hooks, and [Beads integration](./beads-integration.md#synchronization-checkpoints) for tracker exchange checkpoints.
