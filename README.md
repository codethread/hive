# Hive

Tools for running coding agents, managing Git worktrees and coordinating Beads work.

| Tool | Use |
| --- | --- |
| [Bee and Colony](./lib/colony/README.md) | Submit agent requests through Beads; schedule and supervise their execution |
| [Honeycomb](./lib/honeycomb/README.md) | Manage Git worktrees and navigate them from the shell |
| [Waggle](./lib/waggle/README.md) | Run repository-owned semantic classifiers |
| [Busy Bee](./lib/busybee/README.md) | Run XState workflows as sequential, nested or concurrent Beads tasks |
| [qlock](./lib/qlock/README.md) | Serialize commands with ticketed local queues |

[Hive plugins](./plugins/README.md) provide Git worktree and merge queue guidance for Claude Code, Codex and Pi.

For a new clone:

```sh
mise trust
mise run
```

The default task installs dependencies, builds workspace launchers, runs workspace binary installers (including Bee, Colony and qlock), and bootstraps Beads. Rerunning it preserves the existing tracker. See [Beads setup](./docs/beads-integration.md#bootstrap-a-clone) for details, then follow the relevant tool guide above.

The [documentation index](./docs/README.md) covers architecture, terminology and integration contracts. [Philosophy](./docs/PHILOSOPHY.md) explains the project's scope.
