# Beeswax

Beeswax configures Beads trackers, snapshot publication, JSONL merging, Git hooks, executable installation and repository-local harness integrations, including Scent identity. Hive uses the same CLI as consuming repositories.

Generated setup scripts, Git hooks and tracker-alert callbacks use the adapters listed by `beeswax system --help`. Identity callbacks use the separately installed `scent` runtime.

## Install

For Homebrew availability and installation, see [installation and releases](../../docs/releases.md#homebrew-installation). To build from a Hive checkout with dependencies installed:

```sh
bun run --filter @hive/beeswax build
bun run --filter @hive/beeswax install:bin
```

The standalone executable bundles Bun and the unmodified Husky 9.1.7 runner ([MIT license](assets/HUSKY-LICENSE)). Consuming repositories need Git and native `br`; tracker creation also needs Honeycomb. Mise is optional. Installing hooks requires no application dependencies; running application checks may require them.

## Orient an agent

With Hive's executables on `PATH`, run `beeswax prime` for shared task safety and a map of Beads, BV and Hive tools. It works offline, inside or outside a repository, without setup, tracker access or an installed skill. The installed Beeswax version owns the text; agents fetch detailed instructions only when a task calls for them.

Use `beeswax prime --help` to discover the default set, available tools and output options. To add Colony and Beeswax to the default map while removing Bee and Busy Bee:

```sh
beeswax prime --include colony --include beeswax --exclude bee --exclude busybee
```

Use Beeswax to [load onboarding in your harness](#load-onboarding-in-your-harness). Where harness hooks are unavailable, add this instruction to your consuming repository's `AGENTS.md`:

```markdown
At session start, run `beeswax prime` and read its output before working.
```

Use the filtered command in that instruction if needed. Filters affect tool rows only; shared safety guidance remains even when every tool is excluded. Keep one loading route per harness to avoid duplicate context.

For installed release provenance and source retrieval, use `beeswax info --help`. Binary installations do not include a source tree.

For Hive-owned CLI improvements, breaking changes and adoption actions, follow prime's `<tool> changelog` pointer. External `br` and `bv` are outside that release-history contract. See [tool changelogs](../../docs/releases.md#read-tool-changelogs) for offline histories, version selection and how `beeswax update` selects Hive history pointers from `PATH`.

## Configure a repository

Run `beeswax setup --environment mise` in the consuming repository for the recommended Mise path. The interactive wizard handles tracker selection, permanent tracker prerequisites, Git integration and harness onboarding. Read `beeswax setup --help` for headless options and first-initialization prerequisites. Setup stays local; `beeswax beads sync` receives and publishes tracker changes.

Use Mise as the project environment source, keeping your machine's tracker selection in ignored `mise.local.toml`. You manage shell startup and activation. Tracker environment configuration is separate from harness onboarding; use `beeswax beads setup --help` for local Mise configuration and `beeswax beads env --help` for endpoint selection precedence. Beeswax also supports standalone setup without Mise through `--environment none`.

Setup's readiness receipt separates configured artifacts from pending execution checks and reports effective [Honeycomb configuration](../honeycomb/README.md#config) for review. Preserve valid existing policy. For managed workers, continue with [Bee and Colony setup](../colony/README.md#install-and-try-it); repository plumbing alone does not establish runtime readiness.

## Install a customizable workflow

The optional `hive` skill supplies work conventions for routing requests, planning Beads tasks and coordinating completion. It is separate from prime's safety baseline and the installed tools' command manuals. Add `--install-workflow-skill` to an intended setup invocation, or choose the default-off wizard option. Read `beeswax setup --help` for prerequisites, harness selection, existing-content protection and failure handling.

For skill-only installation, run upstream directly from the consuming checkout, selecting the harnesses you use:

```sh
npx --yes skills@1.7.2 add https://github.com/codethread/hive/tree/main/lib/beeswax/skills/hive \
  --skill hive --agent claude-code codex pi --yes --json
```

The curated source selects only `hive`. It follows the public main branch independently of the installed Beeswax version. Upstream's default mode stores the editable copy at `.agents/skills/hive` and links Claude's `.claude/skills/hive` to it. Codex and Pi share the canonical directory, so selecting one does not promise exclusive visibility.

Review and customize the installed workflow for your repository, then commit its files, selected links and project installer metadata. Treat upstream replacements as deliberate, reviewed changes: direct upstream installation can replace existing content. Beeswax's install flag refuses existing destinations, and its normal updates leave the skill alone.

Verify discovery in the actual execution checkout after reviewing project trust and harness settings. The installer receipt confirms files, not that a harness has loaded them. See [harness onboarding](#load-onboarding-in-your-harness) for context delivery.

## Load onboarding in your harness

Choose Claude Code, Codex, Pi or a combination during setup. Each selection enables the primer, tracker alerts and [Scent identity](../scent/README.md). For an existing Beeswax project, run `beeswax update` to choose harnesses, or pass explicit selections:

```sh
beeswax update --harness claude --harness codex --harness pi --include colony --yes
```

Beeswax generates the selected adapters in the consuming repository, preserving unrelated settings:

| Harness | Repository files | Primer and tracker alerts | Identity |
| --- | --- | --- | --- |
| Claude Code | `.claude/settings.json` | Primer at `SessionStart`; alerts at `SessionStart`, `UserPromptSubmit`, `PostToolUse` | Installed Scent command at `SessionStart` and `SubagentStart` |
| Codex | `.codex/hooks.json` | Primer at `SessionStart`; alerts at `SessionStart`, `UserPromptSubmit`, `PostToolUse` | Installed Scent command at `SessionStart` and `SubagentStart` |
| Pi | `.pi/extensions/beeswax.js`, `.pi/extensions/scent.js` | Named primer section before each agent run; `context` observes alerts before a model request | Loader runs Scent's bundled extension inside Pi |

The adapters require `beeswax` and `scent` on the harness's `PATH`. Setup, sync and update check that `scent --version` matches Beeswax before writing selected harness adapters; a missing or mismatched runtime fails. Deselection needs no Scent executable. Identity delivery needs no Hive checkout, application dependencies or Bun runtime. Onboarding writes only repository-local settings.

Read `beeswax update --help` for selection and filtering options. Unspecified headless options retain saved choices. Include/exclude filters affect primer guidance only, including the optional Scent help pointer; they do not enable or disable identity.

Harness-discovered skill descriptions advertise when to load a skill; bodies and references enter context on demand. The primer's bundled-tool pointers work independently of harness skill discovery.

Alert callbacks read independent state for the selected tracker and deliver hold or clearance guidance. They are advisory: they neither prevent arbitrary native writes nor stop workers, and an idle session receives no immediate push. Existing sessions need the current adapter loaded; verify delivery in each supported harness before relying on it. A missing receipt or failed check cannot clear a hold already observed by a session.

Start a new session after setup. [Claude Code](https://code.claude.com/docs/en/hooks#sessionstart) and [Codex](https://learn.chatgpt.com/docs/hooks#sessionstart) add the command's output to model context. In Codex, trust the project and use `/hooks` to review and trust each new or changed hook definition. Pi loads project extensions after project trust is granted.

### Environment capability and guidance

Core integration covers the selected primer, tracker alerts and Scent identity described above. Startup environment delivery is a separate capability:

| Harness | Core integration | Startup environment capability | Additional agent guidance |
| --- | --- | --- | --- |
| Pi | Supported through the selected extensions | Hive's [Pi extension](../../.pi/extensions/beads.ts) resolves and sets `BEADS_DB` at session start. | Less environment guidance when the extension supplies the command environment. |
| Claude Code | Supported through native hooks | `beeswax system beads session-start` can export the selected endpoint through `CLAUDE_ENV_FILE` when configured, as in [Hive's settings](../../.claude/settings.json). | Less environment guidance when the hook supplies the command environment. |
| Codex CLI | Supported through native hooks | Can inherit the project environment from the user's launching shell. | Missing inherited `BEADS_DB` triggers Mise command guidance. |
| Codex GUI | Supported through the same native hooks | A GUI launch may lack the user's shell environment. | The same guidance keeps project commands usable through Mise. |

The Pi and Claude environment bridges above are configured separately in Hive. Selecting portable Beeswax onboarding alone does not install either bridge.

Codex hook commands invoke Beeswax directly, capturing inherited `BEADS_DB` before project lookup. Endpoint selection follows an explicit database flag, then the inherited value, the project's Mise environment and conventional tracker discovery. At `SessionStart`, absent or empty inherited `BEADS_DB` triggers guidance even if lookup resolves a tracker. A nonempty inherited value suppresses that guidance without proving the command tool inherited it. Hook output changes model context, not the command-tool environment.

When needed, run `mise exec -- <command>` from the project checkout. Preserve an explicit invocation or assignment using the command's database flag after `mise exec` (`br --db`, `beeswax --beads-db`); read `beeswax beads env --help` for selection checks.

For a future harness without startup environment injection, deliver these instructions through its available instruction channel. This approach needs no bespoke environment configuration branch; support still depends on that harness's implemented integration.

## Commit the project contract

Commit the shared project contract and keep machine-specific selections local:

| Content | Ownership and commit policy |
| --- | --- |
| Shared intent | Commit editable `.hive/beeswax/config.toml` and repository bootstrap tasks. Share actual Git hook choices, bootstrap adapter, harness selections and guidance filters. |
| Accepted contract | Commit `.hive/beeswax/lock.json`; it records the accepted release, configuration digest and component generations. Discover config and lock schemas with `beeswax schema`. |
| Personal machine settings | Keep `mise.local.toml` ignored and untracked. Absolute tracker paths belong here or in explicit process/invocation settings, not shared project configuration. |
| Native adapters and generated output | Commit selected thin harness adapters and Beeswax's generated `.gitignore` section. Regenerate the ignored Pi payload in each checkout; preserve user content outside owned sections. |

For Pi, `.pi/extensions/beeswax.js` is the tracked adapter; `.hive/beeswax/generated/pi-beeswax.js` is its ignored, reproducible payload. The adapter validates the checkout's accepted contract before loading that payload. Follow [per-checkout preparation](#prepare-each-checkout) before loading Pi; the separate `.pi/extensions/scent.js` loader obtains identity behavior from the installed Scent runtime.

Beeswax owns only the marked `tracker-validation` section in each configured hook, preserving surrounding bytes and file mode. It validates snapshot-only commits on `tracker/state`, then returns to the surrounding hook. Application checks, commit-message policy and any snapshot exemption remain application-owned.

The permanent tracker uses the same configured hook pair. Those files must already contain the exact validation section before setup binds the installed CLI and bootstraps the framework; setup leaves tracked tracker hooks unchanged.

Each checkout's `cli` launcher and `receipt.json` live in the directory reported by `git rev-parse --path-format=absolute --git-path beeswax`; the merge-driver receipt is shared at `<git-common-dir>/beeswax/merge-driver.local.json`. Resolve the common directory with `git rev-parse --path-format=absolute --git-common-dir`. These local observations stay outside the committed contract.

Setup, sync and update replace recognized owned sections, preserving surrounding hook content and modes, unrelated JSON settings and code outside Pi's markers. JSON ownership uses the recognized `statusMessage` version and exact supported command shape. Pi's primer adapter and Scent loader have separate versioned sections; Git configuration, attributes and ignore entries use versioned fences. The permanent tracker prerequisites above still apply. `beeswax update --harness none --yes` removes recognized primer, alert and identity adapters and the ignored Pi payload. Unfamiliar commands, edited payloads or ambiguous ownership stop for review through `beeswax migrate setup`.

Ambiguous hooks or project metadata require interpretation: `beeswax migrate hooks` and `beeswax migrate setup` print agent tasks for resolving the reported conflict with you. These commands make no changes.

### Prepare each checkout

Run `beeswax sync` in the actual execution checkout with the installed Beeswax release matching its accepted lock, before loading the harness. Repeat after branch changes, worktree reuse or clone relocation. Sync reproduces that checkout's accepted contract, including its Pi payload, and rejects changed configuration or release; `beeswax update` accepts reviewed changes. Hive's [source bootstrap](../../docs/repository-commands.md#setup-and-automation) builds matching CLIs before this step.

Bootstrap scripts can use `beeswax system prepare` to adopt an existing tracker selection before sync; read `beeswax system prepare --help` for endpoint precedence and source fallback. Preparation and harness trust apply to each Bee execution checkout too; sharing a repository or tracker does not prepare other worktrees.

## Operate the tracker

Use `beeswax beads env --json` to inspect the selected tracker and `beeswax beads sync --help` for explicit snapshot exchange. Each consuming repository sets its publication checkpoints; Hive's are in [Beads integration](../../docs/beads-integration.md). Discover merge and staged-validation protocols with `beeswax system git --help`.

Failed native reconciliation or Git publication raises a durable alert outside the tracker, keyed by the selected database path. Alert state is user-local and is not exchanged with other clones or hosts. Pause Beads workflows, ordinary tracker operations and merges involving that tracker; independent non-Beads work may continue.

Use `beeswax beads recover` for the non-mutating incident handoff and installed recovery instructions, available without Hive sources. Read `beeswax beads alert status --help` for inspection or `beeswax beads alert wait --help` for bounded waiting without opening SQLite. Recovery requires explicit user authorization; only successful recovery publication clears the current incident. Recovery automation through Bee is a future possibility, not part of this version.

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
