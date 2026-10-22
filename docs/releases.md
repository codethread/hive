# Install and release Hive

Hive releases source. Its Homebrew formula builds the installed executables on the host with Bun; the [post-tag formula stage](#land-the-homebrew-formula) aligns their inventory with the released source. Waggle remains a development tool and is excluded from installation. Every workspace package, including Waggle and Scent, shares the suite version; each installed executable reports it with `--version`.

## Homebrew installation

The public `codethread/hive` repository also serves as the Homebrew tap. The [formula](../Formula/hive.rb) builds Hive and its pinned native Beads fork from source. The same-version repair pins a Hive source commit without moving the `v0.9.0` tag; Hive and native `br` version numbers remain unchanged.

Once the reviewed formula is available in the tap, install with the explicit tap URL and fully qualified dependencies. If stock `br` is already installed, first run `brew unlink dicklesworthstone/tap/br` to avoid a link collision:

```sh
brew tap codethread/hive https://github.com/codethread/hive.git
brew install oven-sh/bun/bun dicklesworthstone/tap/bv codethread/hive/hive
brew test codethread/hive/hive
```

For an existing Hive `0.9.0` installation, use `brew reinstall codethread/hive/hive` after accepting the updated formula, then rerun `brew test`. An unchanged version does not trigger an ordinary upgrade.

Bun and Rust are build-only dependencies. Git and Beads Viewer (`bv`) are external runtime dependencies; the formula installs its own `br` beside Hive's executables. Installation and formula tests create neither a tracker nor a service. Keep Colony's five executables together; coordinate active work before deliberately restarting an upgraded Colony daemon.

Machine installation is separate from project setup. Each project supplies its Beads database, Bee configuration, workflow catalogue and workflow module dependencies. Busy Bee embeds Bun but loads trusted workflow modules from the selected checkout. Install that checkout's dependencies before running its workflows. Hive's clone setup is in [Contributing](../CONTRIBUTING.md#set-up-a-source-checkout).

After upgrading the full suite, read the affected tools' changelogs, verify matching `beeswax --version` and `scent --version`, and run `beeswax update --yes` in each adopting project to refresh its saved contract and onboarding. Review and commit the generated changes, then follow [harness loading and trust](../lib/beeswax/README.md#load-onboarding-in-your-harness). `beeswax sync` reproduces the existing lock; it does not adopt the new version.

### Native Beads dependency

[`Formula/hive.rb`](../Formula/hive.rb) owns the packaged [Beads fork](https://github.com/codethread/beads_rust) revision. Homebrew fetches the pinned Git source and builds with Rust, the committed `Cargo.lock`, locked/offline Cargo installation and default features disabled, including upstream `self_update`. Maintainers instead use the [persistent source checkout](../CONTRIBUTING.md#native-beads-checkout); keep the two recipes' native pins aligned.

Put the `bin` directory beneath the prefix printed by `brew --prefix codethread/hive/hive` before other `br` installations on `PATH`, including old manual copies in `~/.local/bin`. Formula caveats and `brew test` warn when the caller's `PATH` selects a different executable or none; a passing formula test does not clear that warning. Fix the execution environment before tracker operations. Colony inherits `PATH` at startup, so coordinate active work before restarting it to adopt a changed path.

Verify that the resolved `br` is the formula's executable: `br version --json` must report the pinned commit without `self_update`, and `br sync --help` must expose `--from` and `--base`. Stock and patched builds can both report `0.7.6`; the version alone is not capability proof.

Update packaged installations through Homebrew, not `br upgrade`. Follow [native dependency upkeep](../CONTRIBUTING.md#native-dependency-upkeep) when changing the fork pin, and run `brew test` for the packaged candidate as well as the native contracts before Homebrew adoption.

## Read tool changelogs

Run `<tool> changelog` for recorded improvements, breaking changes and adoption actions. This works offline without a source checkout, tracker, daemon or project setup. The command is available on Beeswax, Scent, Honeycomb, Busy Bee, Bee, Colony, qlock, Hive UI and the development-only Waggle. Bee and Colony have separate histories; Colony's history also covers its companion executables.

The default selects the latest recorded release at or below the executable's version. Use `<tool> changelog --help` for exclusive `--since` filtering, exact `--release` selection, pagination and JSON output. Existing histories begin at 0.6.0 with selected highlights, not an exhaustive backfill; Scent's history starts with its first installed-runtime release.

Beeswax's update receipt includes history commands only for known tool names found on `PATH`, including Waggle when present. It assumes upgraded Hive tools; name lookup does not check their versions or supported subcommands. The previous project version supplies the exclusive `--since` baseline; a same-version update still points to the current history.

Adoption actions are labelled **required** or **optional**. Read them against the consuming project's configuration before making changes. `beeswax update` installs no tool binaries; updating the lock does not apply or acknowledge adoption actions.

## Author tool changelog records

Declare each consumer-visible tool change in a top-level `changelog v1` fenced block in the commit body. Each block starts with a full Conventional Commit header scoped to exactly one public tool: `beeswax`, `scent`, `honeycomb`, `busybee`, `bee`, `colony`, `qlock`, `hive-ui` or `waggle`. Follow the header with a blank line and ordinary Markdown describing the change and any **required** or **optional** adoption actions. Use a `!` header or `BREAKING CHANGE:` footer inside the block for breaking changes. `v1` versions this record format, independently of suite releases and workflow compatibility versions.

Repeat blocks for separate changes or tools, including tools affected only through shared code. Tilde fences allow triple-backtick examples in the body; indented code is also preserved:

````text
~~~changelog v1
feat(busybee): show workflow release history offline

Read recorded changes and adoption guidance without opening a tracker.

Optional: inspect changes since the version your project last adopted:

```sh
busybee changelog --since 0.6.0
```
~~~

~~~changelog v1
feat(hive-ui): inspect release history without starting the server

Run `hive-ui changelog` to read the bundled history and exit.
~~~
````

The inner header routes the record; the outer commit heading and changed paths do not. Keep the outer heading a Conventional Commit and mark it breaking if any declared change breaks consumers. An unmarked commit contributes no per-tool candidate. Declared blocks must have a supported version, valid single-tool header and closing fence; malformed records fail preparation.

Review the exact source and final squash messages against the implementation: every affected tool needs its own records, and adoption guidance must survive integration. Put the authoritative blocks in the reviewed squash body supplied by the caller. Honeycomb preserves source messages as blockquotes for provenance; their nested blocks are excluded from generation. A source-message archive alone does not declare the final commit's changes.

## Prepare and land the source

Release is an explicitly invoked [Busy Bee workflow](../.workflows/release/workflow.ts), independent of Land. Discover its input contract and start it beneath the release task:

```sh
busybee input-schema release --json
busybee run release --parent TASK_ID --owner HUMAN --input-file release-input.json --json
```

Use `codethread/hive` as `releaseRepository`. Retain `canonicalRoot` and the permanent `beadsDb` through cleanup; the formula uses the same repository. The input schema owns all fields and constraints.

Before first publication, verify authorization covers public source and reachable history. Review that history and the selected source before changing visibility. Existing explicit authorization remains valid throughout the run.

Follow the run's active briefs with `busybee show` and `busybee discover`. On retry, resume the same run, inspect existing tags, releases and formula commits, then use `busybee collect` for saved closed-stage results. Follow focused `--help` for delivery and recovery. Busy Bee alone closes the run.

Fetch the release repository's tags, then use a clean nested Honeycomb worktree for preparation:

```sh
bun run release prepare 0.6.0
```

Choose the authorized version; see `bun run release --help` for prerequisites. Preparation updates all package versions, refreshes the lockfile without lifecycle hooks, and generates `releases/vVERSION.md` and new `lib/<package>/changelog.json` release records from history since the newest reachable stable suite tag. Bee is the file-name exception: `lib/colony/bee-changelog.json`; Colony uses `lib/colony/changelog.json`. With no prior tag, preparation uses all history. Per-tool candidates come from the [declared records](#author-tool-changelog-records) in all commits in that range, retaining their source hashes, summaries, Markdown bodies and breaking details. Suite notes remain an overview grouped by package paths.

Have bookworm review the generated records against the commits and implementation before Land. Check declared coverage for all affected tools, including shared and repository-level changes. Refine unpublished candidate summaries and Markdown bodies for clarity while preserving adoption guidance; reviewed structured adoption notes may supplement the body. Keep previous released records intact, including the selected 0.6.0 highlights. Review the suite notes into highlights while retaining every package section; unchanged sections say **No change.** The structured histories own per-tool detail.

Start or resume ordinary [Land](../.workflows/land/workflow.ts) beneath the Release run with `completedTasks: []`. Land owns completion, checks, independent review, integration and local tool update. Retain its exact integrated source commit, and verify the notes and histories cover that revision, including concurrent changes in its ancestry. Build from that source and check every public tool's embedded history outside a configured checkout before publication; `hive-ui changelog` must exit without starting the server. Release owns the final tracker publication checkpoint after both nested Land runs finish.

## Publish the source release

Create an annotated, immutable `vX.Y.Z` tag on the reviewed source commit. Set `release_version` and `release_revision` to the retained version and full commit, then publish from the canonical checkout:

```sh
git tag -a "v$release_version" "$release_revision" -m "Hive $release_version"
git push git@github.com:codethread/hive.git "refs/tags/v$release_version"
gh release create "v$release_version" --repo codethread/hive --verify-tag \
  --title "Hive $release_version" --notes-file "releases/v$release_version.md"
```

Upload no assets. GitHub supplies source downloads for the tag. Read back the remote tag's peeled commit and release notes, download the source tarball without authentication, and retain its SHA-256 for the formula. On retry, continue matching effects; a mismatched published tag or release requires reconciliation. Published tags remain fixed, including when the later formula commit lands.

## Land the Homebrew formula

After the tag exists, create or resume a nested Honeycomb worktree from the same repository's default branch, anchored at `canonicalRoot`. Update `Formula/hive.rb` with the tag's source URL, `https://github.com/codethread/hive/archive/refs/tags/vVERSION.tar.gz`, and the SHA-256 of the downloaded tarball. The formula commit follows the source tag because that checksum depends on the tagged source.

The formula declares Bun and Rust as build dependencies. It prepares workspace dependencies with `bun install --frozen-lockfile --ignore-scripts`, builds the [pinned native Beads resource](#native-beads-dependency), then invokes the package build scripts for installed tools, including Scent. Keep build targets, installed outputs and executable-version checks aligned with the released source; Colony produces several executables, while Waggle is development-only. Add newly released executables in this post-tag formula change. Preserve native capability and caller-`PATH` checks alongside Hive version tests. The formula installs their outputs together without running repository setup or starting services.

Check Ruby syntax, Homebrew style and audit, then perform an actual installation and `brew test` against the published source URL. Verify every installed executable's version, required dependencies and the absence of tracker or service creation. Record the tested host and dependency versions; use the tools' `--help` for invocation details.

Land the formula change through ordinary Land beneath the Release run with `completedTasks: []`, retaining the original source tag. Verify the integrated formula commit and the fully qualified install command above. Record the source commit, tag, release URL, source checksum, formula commit, installation/test results and cleanup on the Release run. Once it reports `done`, follow the run brief's caller completion instructions. Leave an unresolved operation open with its blocker and next action.
