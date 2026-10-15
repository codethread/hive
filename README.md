# Hive

Tools for running coding agents, managing Git worktrees and coordinating Beads work.

| Tool | Use |
| --- | --- |
| [Bee and Colony](./lib/colony/README.md) | Submit agent requests through Beads; schedule and supervise their execution |
| [Honeycomb](./lib/honeycomb/README.md) | Manage Git worktrees and navigate them from the shell |
| [Beeswax](./lib/beeswax/README.md) | Set up repository integrations and publish tracker changes |
| [Waggle](./lib/waggle/README.md) | Run repository-owned semantic classifiers |
| [Busy Bee](./lib/busybee/README.md) | Run XState workflows as sequential, nested or concurrent Beads tasks |
| [qlock](./lib/qlock/README.md) | Serialize commands with ticketed local queues |

[Hive plugins](./plugins/README.md) provide Git worktree and merge queue guidance for Claude Code, Codex and Pi.

For Homebrew installation, see [installation and releases](./docs/releases.md).

For a new clone:

```sh
mise trust
mise run
```

This installs the tools and bootstraps Beads. See [Beads setup](./docs/beads-integration.md#bootstrap-a-clone) for prerequisites and tracker requirements, then follow a tool guide above.

For individual builds, installation destinations and runtime requirements, see [CLI artifacts](./lib/tooling/README.md#cli-artifacts).

The [documentation index](./docs/README.md) covers architecture, terminology and integration contracts. [Philosophy](./docs/PHILOSOPHY.md) explains the project's scope.
