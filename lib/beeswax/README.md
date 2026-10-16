# Beeswax

Beeswax configures Beads trackers, snapshot publication, JSONL merging, Git hooks, executable installation and repository-local agent onboarding. Hive uses the same CLI as consuming repositories.

## Install

For Homebrew availability and installation, see [installation and releases](../../docs/releases.md#homebrew-installation). To build from a Hive checkout with dependencies installed:

```sh
bun run --filter @hive/beeswax build
bun run --filter @hive/beeswax install:bin
```

The standalone executable bundles Bun and the unmodified Husky 9.1.7 runner ([MIT license](assets/HUSKY-LICENSE)). Consuming repositories need Git and native `br`; tracker creation also needs Honeycomb. Mise is optional. Installing hooks requires no application dependencies; running application checks may require them.

## Orient an agent

With Hive's executables on `PATH`, run `beeswax prime` for the repository's Hive conventions and task-to-tool pointers. It works offline, inside or outside a repository, without setup or tracker access. The installed Beeswax version owns the text; agents fetch detailed instructions only when a task calls for them.

Use `beeswax prime --help` to discover the default set, available tools and output options. To add Colony and Beeswax to the default map while removing Bee and Busy Bee:

```sh
beeswax prime --include colony --include beeswax --exclude bee --exclude busybee
```

Use Beeswax to [load onboarding in your harness](#load-onboarding-in-your-harness). Where harness hooks are unavailable, add this instruction to your consuming repository's `AGENTS.md`:

```markdown
At session start, run `beeswax prime` and read its output before working.
```

Use the filtered command in that instruction if needed. Keep one loading route per harness to avoid duplicate context.

## Configure a repository

Run `beeswax setup` in the consuming repository. The interactive wizard handles tracker selection, permanent tracker prerequisites, Git integration and harness onboarding. Read `beeswax setup --help` for headless options and first-initialization prerequisites. Setup stays local; `beeswax beads sync` receives and publishes tracker changes.

## Load onboarding in your harness

Choose Claude Code, Codex, Pi or a combination during setup. For an existing Beeswax project, run `beeswax update` to choose harnesses, or pass explicit selections:

```sh
beeswax update --harness claude --harness codex --harness pi --include colony --yes
```

Beeswax generates the selected adapters in the consuming repository, preserving unrelated settings:

| Harness | Repository file | Context delivery |
| --- | --- | --- |
| Claude Code | `.claude/settings.json` | `SessionStart` runs `beeswax prime` |
| Codex | `.codex/hooks.json` | `SessionStart` runs `beeswax prime` |
| Pi | `.pi/extensions/beeswax.js` | Runs `beeswax prime` before each agent run and supplies a named system-prompt section |

The adapters call the separately installed `beeswax` executable on the harness's `PATH`; onboarding writes no global harness settings. Read `beeswax update --help` for selection and filtering options. Unspecified headless options retain saved choices.

Start a new session after setup. [Claude Code](https://code.claude.com/docs/en/hooks#sessionstart) and [Codex](https://learn.chatgpt.com/docs/hooks#sessionstart) add the command's output to model context. In Codex, trust the project and use `/hooks` to review and trust each new or changed hook definition. Pi loads project extensions after project trust is granted.

## Commit the project contract

Commit `.hive/beeswax/config.toml`, `.hive/beeswax/meta/lock.json` and the selected generated harness files. Configuration names the actual Git hook files, bootstrap adapter, selected harnesses and guidance filters. The lock records the accepted release, configuration digest and Git hook generation. Discover their schemas with `beeswax schema`.

Beeswax owns only the marked `tracker-validation` section in each configured hook, preserving surrounding bytes and file mode. It validates snapshot-only commits on `tracker/state`, then returns to the surrounding hook. Application checks, commit-message policy and any snapshot exemption remain application-owned.

The permanent tracker uses the same configured hook pair. Those files must already contain the exact validation section before setup binds the installed CLI and bootstraps the framework; setup leaves tracked tracker hooks unchanged.

`beeswax sync` reproduces the committed contract locally; `beeswax update` advances it after review. Each checkout gets a launcher and observation receipt in Git metadata. The committed contract is authoritative; receipts describe local outputs. Run sync in each checkout and after relocating a clone.

Setup, sync and update replace recognized versioned onboarding sections automatically, preserving unrelated JSON settings and code outside Pi's markers. `beeswax update --harness none --yes` removes recognized onboarding sections. Unfamiliar commands, execution options or ambiguous markers stop with the affected path, observed state, intended result and a `beeswax migrate setup` handoff for an agent to resolve with you.

Onboarding reaches an agent only when its actual checkout contains the generated files, the harness loads and trusts them, and the matching Beeswax release is on its `PATH`. This also applies to Bee executions; sharing a repository or tracker does not copy adapters between worktrees.

Ambiguous hooks or project metadata require interpretation: `beeswax migrate hooks` and `beeswax migrate setup` print agent tasks for resolving the reported conflict with you. These commands make no changes.

## Operate the tracker

Use `beeswax beads env --json` to inspect the selected tracker. For Hive's publication checkpoints and recovery, see [Beads integration](../../docs/beads-integration.md). Discover merge and staged-validation protocols with `beeswax git --help`.

Hive's [setup recipe](../../docs/repository-commands.md#setup-and-automation) coordinates installation and local configuration. [CLI artifacts](../tooling/README.md#cli-artifacts) covers build and installation. For release lock refreshes, read `beeswax lock --help`.

## Pack Git storage

Run Git packing explicitly when object storage needs consolidation. Setup, hooks, tracker publication and background scheduling do not invoke it. The standalone executable needs only Git for this command; no setup, `br` or application dependencies are required.

```nu
beeswax git pack --help
beeswax git pack --repo . --json
```

Read the focused help for the preservation contract, shared worktree scope, maintenance precondition and receipt fields.

## Bundled instructions

Agent setup decisions and conditional migration/publication guidance are available offline, including outside a repository:

```sh
beeswax skills list --json
beeswax skills get repository-setup
beeswax skills file repository-setup references/publication.md
```
