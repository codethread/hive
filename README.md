# Hive

Tools for running coding agents, managing Git worktrees and coordinating Beads work.

## Set up the Hive stack

Install with Homebrew:

```sh
brew tap codethread/hive https://github.com/codethread/hive.git
brew install oven-sh/bun/bun dicklesworthstone/tap/br dicklesworthstone/tap/bv codethread/hive/hive
```

Then, from the repository you want to configure:

```sh
beeswax setup
```

See [repository setup](./lib/beeswax/README.md#configure-a-repository) for details, including headless setup and managed workers.

## Tools

| Tool | Use |
| --- | --- |
| [Bee and Colony](./lib/colony/README.md) | Submit agent requests through Beads; schedule and supervise their execution |
| [Honeycomb](./lib/honeycomb/README.md) | Manage Git worktrees and navigate them from the shell |
| [Beeswax](./lib/beeswax/README.md) | Set up repository integrations and publish tracker changes |
| [Scent](./lib/scent/README.md) | Supply native harness identity through Beeswax-managed integrations |
| [Waggle](./lib/waggle/README.md) | Run repository-owned semantic classifiers |
| [Busy Bee](./lib/busybee/README.md) | Run XState workflows as sequential, nested or concurrent Beads tasks |
| [qlock](./lib/qlock/README.md) | Serialize commands with ticketed local queues |

Load [Beeswax onboarding](./lib/beeswax/README.md#load-onboarding-in-your-harness) in your harness for shared safety guidance and pointers to the installed tools.

The [documentation index](./docs/README.md) covers guides and reference material. [Philosophy](./docs/PHILOSOPHY.md) explains the project's scope. To develop Hive, see [Contributing](./CONTRIBUTING.md).
