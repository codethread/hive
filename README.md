# Hive

Tools for running coding agents, managing Git worktrees and coordinating Beads work.

## Set up the Hive stack

For a Hive source checkout, follow the [source prerequisites](./docs/beads-integration.md#bootstrap-a-clone), then use Mise's bootstrap in the checkout you will use, before starting your harness:

```sh
mise run
```

This installs matching tools and prepares the checkout through Beeswax sync. See [source bootstrap](./docs/repository-commands.md#setup-and-automation) for the recipe and [per-checkout preparation](./lib/beeswax/README.md#prepare-each-checkout) for later syncs. Keep [shared project intent and personal settings](./lib/beeswax/README.md#commit-the-project-contract) separate.

To use packaged executables in another repository, install with Homebrew:

```sh
brew tap codethread/hive https://github.com/codethread/hive.git
brew install mise oven-sh/bun/bun dicklesworthstone/tap/br dicklesworthstone/tap/bv codethread/hive/hive
```

Then, from the repository you want to configure:

```sh
beeswax setup --environment mise
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

[Hive plugins](./plugins/README.md) provide Git worktree and merge queue guidance for Claude Code, Codex and Pi.

The [documentation index](./docs/README.md) covers guides and reference material. [Philosophy](./docs/PHILOSOPHY.md) explains the project's scope. To develop Hive, see [Contributing](./CONTRIBUTING.md).
