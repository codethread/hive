# Beeswax

Beeswax configures Beads trackers, Hive's BV viewer recipes, snapshot publication, JSONL merging, Git hooks, executable installation and repository-local harness integrations, including Scent identity. Hive uses the same CLI as consuming repositories.

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

For Hive-owned CLI improvements, breaking changes and adoption actions, run `<tool> changelog`. External `br` and `bv` are outside that release-history contract. See [tool changelogs](../../docs/releases.md#read-tool-changelogs) for offline histories, version selection and how `beeswax update` selects Hive history pointers from `PATH`.

## Configure a repository

Run `beeswax setup` in the consuming repository. The interactive wizard handles tracker selection, permanent tracker prerequisites, Git integration and harness onboarding. Read `beeswax setup --help` for headless options and first-initialization prerequisites. Setup stays local; `beeswax beads sync` receives and publishes tracker changes.

Setup's readiness receipt separates configured artifacts from pending execution checks and reports effective [Honeycomb configuration](../honeycomb/README.md#config) for review. Preserve valid existing policy. For managed workers, continue with [Bee and Colony setup](../colony/README.md#install-and-try-it); repository plumbing alone does not establish runtime readiness.

## Install a customizable workflow

The optional `hive` skill supplies work conventions for routing requests, planning Beads tasks and coordinating completion. Add `--install-workflow-skill` to an intended setup invocation, or choose the default-off wizard option. Read `beeswax setup --help` for prerequisites, harness selection, existing-content protection and failure handling.

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

Start a new session after setup. [Claude Code](https://code.claude.com/docs/en/hooks#sessionstart) and [Codex](https://learn.chatgpt.com/docs/hooks#sessionstart) add the command's output to model context. In Codex, trust the project and use `/hooks` to review and trust each new or changed hook definition. Pi loads project extensions after project trust is granted.

## Commit the project contract

Commit `.hive/beeswax/config.toml`, `.hive/beeswax/meta/lock.json`, `.bv/recipes.yaml` and the selected generated harness files. Configuration names the actual Git hook files, bootstrap adapter, selected harnesses and guidance filters. The lock records the accepted release, configuration digest and managed component generations. Discover their schemas with `beeswax schema`.

Beeswax owns only the marked `tracker-validation` section in each configured hook, preserving surrounding bytes and file mode. It validates snapshot-only commits on `tracker/state`, then returns to the surrounding hook. Application checks, commit-message policy and any snapshot exemption remain application-owned.

The permanent tracker uses the same configured hook pair. Those files must already contain the exact validation section before setup binds the installed CLI and bootstraps the framework; setup leaves tracked tracker hooks unchanged.

`beeswax sync` reproduces the committed contract locally; `beeswax update` advances it after review. Each checkout gets a launcher and observation receipt in Git metadata. The committed contract is authoritative; receipts describe local outputs. Run sync in each checkout and after relocating a clone.

Setup, sync and update replace recognized versioned hook and onboarding sections automatically, preserving surrounding hook content, unrelated JSON settings and code outside Pi's markers. Beeswax owns identity command entries marked `Beeswax identity v1` and the versioned identity section in Pi's Scent loader. The permanent tracker prerequisites above still apply. `beeswax update --harness none --yes` removes recognized primer, alert and identity adapters. Unfamiliar commands, execution options or ambiguous markers stop with the affected path, observed state, intended result and guidance for an agent to resolve with you.

Integration reaches an agent only when its actual checkout contains the generated files, the harness loads and trusts them, and the matching Beeswax and Scent releases are on its `PATH`. This also applies to Bee executions; sharing a repository or tracker does not copy adapters between worktrees.

Ambiguous hooks or project metadata require interpretation: `beeswax migrate hooks` and `beeswax migrate setup` print agent tasks for resolving the reported conflict with you. These commands make no changes.

### Native tracker waiting

To opt into a five-minute native lock-acquisition budget, add this optional policy to `.hive/beeswax/config.toml`:

```toml
[beads]
lock_timeout = 300000 # milliseconds
```

Accept the configuration change with `beeswax update`, or with `beeswax setup` for initial configuration. The existing configuration digest records acceptance; no release change is required. Setup, update and sync apply the policy only to the selected tracker's `.beads/config.yaml`. Each clone must adopt the contract locally; worktrees sharing that tracker share its policy.

Explicit setup/update may replace a conflicting local value. `beeswax sync` and `beeswax beads bootstrap` instead stop on a conflict and direct you to `beeswax update`. Bootstrap applies the policy before importing records; new tracker initialization applies it immediately after `br init`, before the first flush.

An absent policy leaves native configuration alone, including a previously installed value. A matching value needs no rewrite. Native configuration writes preserve unrelated values, not YAML comments or layout. Native CLI and environment precedence remains unchanged. This is a lock-wait budget, not a workflow deadline; routine session hooks and tracker publication (`beeswax beads sync`) do not install it.

## BV viewer recipes

Setup, update and sync maintain a Beeswax-marked YAML section in `.bv/recipes.yaml` in the caller's checkout and the selected permanent tracker checkout, when available. These required views belong to Beeswax, independently of Bee's attention-query preset:

| Recipe            | Filter                                  |
| ----------------- | --------------------------------------- |
| `_hive_work`      | Exclude `system` and `busybee-workflow` |
| `_hive_system`    | Select `system`                         |
| `_hive_workflows` | Select `busybee-workflow`               |

An existing lock without the BV component requires `beeswax update`, even at the same suite version; ordinary sync does not adopt it.

Use these names in Hive-based prompts. The `_hive_` prefix makes ownership explicit; it does not hide recipes from BV discovery. Personal recipes, including generic `work`, `system` and `workflows`, remain user-owned. Beeswax preserves content and comments outside its managed section and regenerates its own definitions. Ambiguous ownership fails with the affected path for review.

BV uses the selected `BEADS_DB`, but discovers project recipes in the checkout where it runs. Verify `bv --robot-recipes` in both checkouts. These are advisory views, not task authority or Colony scheduling filters.

## Operate the tracker

Use `beeswax beads env --json` to inspect the selected tracker and `beeswax beads sync --help` for explicit snapshot exchange. Each consuming repository sets its publication checkpoints; Hive's are in [Beads integration](../../docs/beads-integration.md). Discover merge and staged-validation protocols with `beeswax system git --help`.

Pre-publication `tracker_busy` means the checkpoint did not start; it neither establishes an incident nor changes an existing alert.

Failed native reconciliation or Git publication raises a durable alert outside the tracker, keyed by the selected database path. Alert state is user-local and is not exchanged with other clones or hosts. Alerts are advisory: they do not prevent native writes or stop running workers.

Use `beeswax beads recover` for the non-mutating incident handoff and recovery instructions, available without Hive sources. Read `beeswax beads alert status --help` for inspection or `beeswax beads alert wait --help` for bounded waiting without opening SQLite. Recovery requires explicit user authorization; only successful recovery publication clears the current incident.

Incident/clearance receipts, per-harness session receipts and their locks use only `${XDG_STATE_HOME:-$HOME/.local/state}/hive/beeswax/tracker-alerts/` (default `~/.local/state/hive/beeswax/tracker-alerts/`). An empty or relative `XDG_STATE_HOME` uses the default.

Tracker creation also uses a generated `tracker-bootstrap-*` directory under the same `hive/beeswax` state root. Its temporary `XDG_CONFIG_HOME` contains `hive/honeycomb.toml`; it does not change your global configuration. The generated directory is removed on success or error; abrupt process termination can leave it behind.

Hive's [setup recipe](../../docs/repository-commands.md#setup-and-automation) coordinates installation and local configuration. [CLI artifacts](../tooling/README.md#cli-artifacts) covers build and installation. For release lock refreshes, read `beeswax lock --help`.

### Snapshot exchange

Snapshot exchange requires native `br sync --merge` with `--from` and `--base`, provided by the published Beads fork. Follow [maintainer setup](../../CONTRIBUTING.md#native-beads-checkout) for the persistent local build, or [Homebrew installation](../../docs/releases.md#native-beads-dependency) for the packaged build. Those routes cover adoption and `PATH` verification; stock Homebrew `br` alone does not supply the patch. Check `br version --json` for commit/features and `br sync --help` for capability, not the version number alone.

For each receive attempt, Beeswax fetches the accepted remote snapshot and the snapshot at the Git common ancestor into separate inputs, then invokes one native merge. Native `br` owns reconciliation of task records, comments and relations, plus canonical database/export/base writeback under its locking and recovery safeguards. Hive adds no semantic merge or conflict override to this path, and routine publication neither copies the database nor redirects `BEADS_JSONL`.

Git publishes a blob of the live native export through a private index. The commit retains local and accepted remote history, taking every non-snapshot path from the accepted remote tree. It updates the tracker branch and index without checking files out over the live database or export. Unstaged hook and recipe edits remain local; staged non-snapshot changes must be finished first. The separate `beeswax system git merge` protocol is not used by this publication path.

Independent work is reconciled by native semantics; a true conflicting edit stops publication with an alert and retains the incoming/common-base inputs for authorized recovery. Neither Git history nor a successful exchange grants authority to overwrite a disputed record or competing claim. Use the [recovery handoff](#operate-the-tracker), preserving audit history and native safeguards rather than forcing a winner.

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
