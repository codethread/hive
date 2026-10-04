# Hive

Tools for running coding agents against Beads work, managing Git worktrees, and reviewing repository changes.

- **Bee** submits captured spawn requests and inspects or closes them through Beads, even while the daemon is unavailable.
- **Colony** owns repository scheduling, configuration, runtime inspection, the hosting daemon and execution supervision.
- **Honeycomb** manages Git worktrees and shell picker integration.
- **Waggle** discovers and runs repository-owned semantic classifiers.

Start with the [Bee and Colony guide](./lib/colony/README.md) for installation, a disposable quickstart, configuration and verification. See [Honeycomb](./lib/honeycomb/README.md) for worktree commands and [Waggle](./lib/waggle/README.md) for classifiers.

The [documentation index](./docs/README.md) links the [architecture and library boundaries](./docs/architecture.md), [domain vocabulary](./GLOSSARY.md), integration contracts and versioned harness evidence. The [philosophy](./docs/PHILOSOPHY.md) explains the project's scope.
