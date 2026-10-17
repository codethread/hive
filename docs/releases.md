# Install and release Hive

Hive releases source. Its Homebrew formula builds ten executables on the host with Bun: `beeswax`, `honeycomb`, `bee`, `colony`, `colony-runtime`, `colony-worker`, `colony-watchdog`, `busybee`, `qlock` and `hive-ui`. Waggle remains a development tool and is excluded from installation. Every workspace package, including Waggle, shares the suite version; each installed executable reports it with `--version`.

## Homebrew installation

The public `codethread/hive` repository also serves as the Homebrew tap. Once its formula is published, install with the explicit tap URL and fully qualified dependencies:

```sh
brew tap codethread/hive https://github.com/codethread/hive.git
brew install oven-sh/bun/bun dicklesworthstone/tap/br dicklesworthstone/tap/bv codethread/hive/hive
brew test codethread/hive/hive
```

Bun is a build-only dependency. Git, Beads (`br`) and Beads Viewer (`bv`) are required at runtime. Installation and formula tests create neither a tracker nor a service. Keep Colony's five executables together; coordinate active work before deliberately restarting an upgraded Colony daemon.

Machine installation is separate from project setup. Each project supplies its Beads database, Bee configuration, workflow catalogue and workflow module dependencies. Busy Bee embeds Bun but loads trusted workflow modules from the selected checkout. Install that checkout's dependencies before running its workflows. Hive's clone setup is in [Contributing](../CONTRIBUTING.md#set-up-a-source-checkout).

After upgrading, verify `beeswax --version` and run `beeswax update --yes` in each adopting project to refresh its saved contract and onboarding. `beeswax sync` reproduces the existing lock; it does not adopt the new version.

## Read tool changelogs

Run `<tool> changelog` for recorded improvements, breaking changes and adoption actions. This works offline without a source checkout, tracker, daemon or project setup. The command is available on Beeswax, Honeycomb, Busy Bee, Bee, Colony, qlock, Hive UI and the development-only Waggle. Bee and Colony have separate histories; Colony's history also covers its companion executables.

The default selects the latest recorded release at or below the executable's version. Use `<tool> changelog --help` for exclusive `--since` filtering, exact `--release` selection, pagination and JSON output. Recorded coverage begins at 0.6.0 with selected highlights, not an exhaustive backfill.

Beeswax's update receipt includes history commands only for known tool names found on `PATH`, including Waggle when present. It assumes upgraded Hive tools; name lookup does not check their versions or supported subcommands. The previous project version supplies the exclusive `--since` baseline; a same-version update still points to the current history.

Adoption actions are labelled **required** or **optional**. Read them against the consuming project's configuration before making changes. `beeswax update` installs no tool binaries; updating the lock does not apply or acknowledge adoption actions.

## Author tool changelog records

Declare each consumer-visible tool change in a top-level `changelog v1` fenced block in the commit body. Each block starts with a full Conventional Commit header scoped to exactly one public tool: `beeswax`, `honeycomb`, `busybee`, `bee`, `colony`, `qlock`, `hive-ui` or `waggle`. Follow the header with a blank line and ordinary Markdown describing the change and any **required** or **optional** adoption actions. Use a `!` header or `BREAKING CHANGE:` footer inside the block for breaking changes. `v1` versions this record format, independently of suite releases and workflow compatibility versions.

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

Start or resume ordinary [Land](../.workflows/land/workflow.ts) beneath the Release run with `completedTasks: []`. Land owns checks, review, integration and cleanup. Retain its exact integrated source commit, and verify the notes and histories cover that revision, including concurrent changes in its ancestry. Build from that source and check every public tool's embedded history outside a configured checkout before publication; `hive-ui changelog` must exit without starting the server. Defer final tracker publication until Release finishes.

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

The formula declares `oven-sh/bun/bun` as a build dependency, runs `bun install --frozen-lockfile --ignore-scripts`, then invokes the existing build scripts for Beeswax, Honeycomb, Colony, Busy Bee, qlock and Hive UI. Those six scripts compile the ten executables for the host; the formula installs their outputs together. It does not run repository setup or start services.

Check Ruby syntax, Homebrew style and audit, then perform an actual installation and `brew test` against the published source URL. Verify all ten executable versions, required dependencies and the absence of tracker or service creation. Record the tested host and dependency versions; use the tools' `--help` for invocation details.

Land the formula change through ordinary Land beneath the Release run with `completedTasks: []`, retaining the original source tag. Verify the integrated formula commit and the fully qualified install command above. Record the source commit, tag, release URL, source checksum, formula commit, installation/test results and cleanup on the Release run. Once it reports `done`, follow the run brief's caller completion instructions. Leave an unresolved operation open with its blocker and next action.
