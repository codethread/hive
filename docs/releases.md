# Install and release Hive

Hive distributes one versioned archive containing `beeswax`, `honeycomb`, `bee`, `colony`, `colony-runtime`, `colony-worker`, `colony-watchdog`, `busybee`, `qlock` and `hive-ui`. Waggle remains a development tool and is excluded from release archives. Every workspace package, including Waggle, shares the suite version. Each distributed executable reports its compiled package version with `--version`.

## Homebrew installation

The release tooling is ready to generate a formula from real archives. **No public Hive release or tap is established by this change.** The source repository is currently private. Before the first release, choose an existing public asset repository, a tap and the first version, and supply publication credentials. Do not use a private GitHub download URL in a formula intended for anonymous installs.

After a release has published its generated `Formula/hive.rb`, use the tap's fully qualified formula name. For a same-repository tap, Homebrew accepts an explicit repository URL (the short form assumes a `homebrew-` repository prefix):

```sh
# If codethread/hive is the chosen accessible tap:
brew tap codethread/hive https://github.com/codethread/hive.git
brew install codethread/hive/hive
brew test codethread/hive/hive
```

The formula requires `dicklesworthstone/tap/br`, `dicklesworthstone/tap/bv` and Git. Both Beads dependencies are mandatory. The formula installs binaries into its keg; it does not initialize a tracker, configure a repository or start any service. Keep Colony's five executables together. When upgrading a running Colony daemon, coordinate active work before deliberately restarting it; replacing binaries does not refresh a running process.

Machine installation is separate from project setup. Your project still supplies its Beads database, Bee configuration, workflow catalogue and any workflow module dependencies. Busy Bee embeds Bun but loads trusted workflow modules from the selected checkout; install that checkout's dependencies before running its workflows. Hive's own clone setup remains described in the [root README](../README.md).

## Start a release

Release is an explicitly invoked [Busy Bee workflow](../lib/busybee/README.md), independent of Land. Inspect its current input contract:

```sh
busybee input-schema release --json
busybee run release --parent TASK_ID --owner HUMAN --input-file release-input.json --json
```

The input requires `nextVersion` (stable `X.Y.Z`), the actual authorized `request`, `releaseRepository` and `tapRepository` (`owner/repository`), `tapCheckout`, `canonicalRoot`, permanent `beadsDb` and an absolute `artifactDirectory` outside the release worktree. Both repositories must already exist. This workflow does not create repositories or make private source public as a side effect.

Follow `show` and `discover` on the returned run. On retry resume that same run, inspect existing effects, and collect saved results; do not repeat closed work. Build or native verification defects take the repair route through renewed Land and fresh archives. The candidate keeps its unpublished version; a published version is never replaced. The chart orders destination checks, preparation, Land, immutable builds, native verification, GitHub publication and the Homebrew update. Missing credentials or platform runners keep their visit open with the next action recorded.

Preparation runs in a clean nested worktree:

```sh
bun run release prepare 0.6.0
```

The example version is illustrative, not a published version. It must exceed every current package and the newest reachable stable suite tag. Fetch the authoritative release repository's tags before preparation. The tool selects the highest stable `vX.Y.Z` tag merged into `HEAD`; unrelated package tags and prereleases are excluded. With no such tag, it explicitly uses all Git history for the initial release.

Preparation updates the root and every `lib/*/package.json`, refreshes `bun.lock` without lifecycle hooks, and writes `releases/vVERSION.md`. Each package's section lists commits touching its directory since the previous tag, or **No change.** These are package-local changes; a shared dependency can change runtime behavior without a package-local commit. The root section includes repository-wide history. Busy Bee's `busybee.toml` compatibility versions remain independent.

The Release visit then starts or resumes the ordinary [Land workflow](../.workflows/land/workflow.ts) with `completedTasks: []`. Land owns check, review, commit, integration, local tool update and cleanup. Retain its exact integrated source commit and verify the changelog still covers that revision if concurrent integration changed the base. Defer final tracker publication until the surrounding Release finishes.

## Build and inspect artifacts

From the surviving canonical checkout, supply the full integrated commit SHA:

```sh
bun run release build --revision FULL_COMMIT_SHA --output /absolute/new-artifact-directory
bun run release formula --artifacts /absolute/new-artifact-directory \
  --repository OWNER/REPOSITORY --output /absolute/new-artifact-directory/hive.rb
ruby -c /absolute/new-artifact-directory/hive.rb
```

The output directory must not exist; its parent must exist. A failed build retains partial output for inspection. Choose a fresh directory after diagnosing failure. `--target darwin-arm64` (or another supported platform) builds a single platform for investigation; formula generation requires all four. `bun run release --schema` prints the artifact manifest schema. Results and failures are single JSON documents.

Build extracts the exact Git commit into temporary source, installs frozen dependencies with lifecycle hooks disabled, and invokes existing package builders. It never packages dirty files or stale workspace `dist/` output. Builders accept `HIVE_BUILD_TARGET` for cross-compilation; ordinary builds still target the host. Busy Bee retains package/TypeScript configuration loading, and Hive UI retains its embedded HTML/Tailwind asset build.

The supported archive matrix is macOS and Linux, each on arm64 and x64, using Bun's `bun-darwin-arm64`, `bun-darwin-x64`, `bun-linux-arm64` and `bun-linux-x64` compiler targets. Linux artifacts use glibc. The release must verify native execution on all advertised platforms; compilation alone does not establish that.

Each archive contains only `bin/` with the ten executables and `release.json` (version, source commit, platform, Bun version and executable list). The output also includes `manifest.json` and `SHA256SUMS`. Formula generation rehashes each archive and rejects an incomplete platform set or a mismatched filename/digest. The generated formula is a real Ruby formula with immutable versioned URLs and actual checksums; no placeholder formula is committed before artifacts exist.

On each platform, verify checksums, extract outside a checkout, and check every executable's `--version`. Exercise public `--help`, `qlock status --lock` with a disposable lock, Busy Bee discovery/loading of a disposable workflow whose packages are installed, and Hive UI startup plus HTTP delivery of embedded assets using a disposable tracker. Verify Colony resolves the companion executables next to its installed binary. Do not launch the shared production daemon for smoke tests.

For a local Homebrew test, copy the generated formula into a disposable local tap and change only its download URLs to `file://` URLs for those exact archives. Run `brew install --build-from-source TAP/hive` and `brew test TAP/hive`, then remove that test installation/tap. Keep this local fixture separate from the published formula. Verify no `.beads` directory or service appears merely from installation. The formula's test checks all versions, help and a real qlock status operation.

Verify the consumed Beads contract with `bun run test:contracts` against the release dependency versions. The initial investigation verified upstream formulae and local `br 0.7.4` / `bv 0.25.2`; later releases must recheck the current dependency contract. Homebrew dependencies follow the tap, so that observation is not a pin.

## Publish the verified bytes

Only perform this section after the workflow's native verification and explicit publication authorization. Substitute the retained version, exact commit, public repository and artifact directory. Inspect existing tags/releases/assets first. Never force a tag or clobber an asset; after interruption, continue only effects whose identity and bytes match the retained manifest.

```sh
git tag -a vVERSION FULL_COMMIT_SHA -m 'Hive VERSION'
git push git@github.com:OWNER/REPOSITORY.git refs/tags/vVERSION
gh release create vVERSION --repo OWNER/REPOSITORY --verify-tag --draft \
  --title 'Hive VERSION' --notes-file releases/vVERSION.md
gh release upload vVERSION --repo OWNER/REPOSITORY \
  /absolute/artifacts/hive-*.tar.gz /absolute/artifacts/manifest.json \
  /absolute/artifacts/SHA256SUMS /absolute/artifacts/hive.rb
```

Read back the remote tag and compare its peeled commit with the manifest. Download the draft assets into a new directory with `gh release download`, compare hashes with the saved artifacts, and only then publish:

```sh
gh release edit vVERSION --repo OWNER/REPOSITORY --draft=false
```

Download the public URLs without authentication and verify hashes again. In the chosen clean tap checkout, copy the generated `hive.rb` to `Formula/hive.rb`, run `brew style`, `brew audit` and an actual installation/test against the published URLs, then follow that repository's review/commit/push policy. Record the actual tap commit and verify the fully qualified install command after publication.

A same-repository tap uses a later formula-only commit: its checksums cannot exist in the source revision being built. Land that update normally; do not move the release tag to chase a self-referential hash. The previous valid formula remains until replacement assets are publicly available.

Record source/tag, release URL, archive hashes, platform test evidence, tap commit and installation results on the Release run. Busy Bee closes the run after all visits complete; the authorized caller then closes proven scope work and publishes final tracker evidence once. An unresolved external operation stays open with its specific blocker and required next action.

## Tool choices and references

[git-cliff](https://git-cliff.org/docs/usage/monorepos/) supports path-filtered monorepo changelogs, and [release-please](https://github.com/googleapis/release-please) manages release PRs and version strategies. Hive needs an explicit user-selected suite version and a simple commit list per package, and already owns its Land and Release coordination. Native Git history plus the existing Bun compiler meet that scope without adding a second release coordinator or a changelog tool dependency.

The build follows [Bun's standalone executable documentation](https://bun.com/docs/bundler/executables). Formula rendering follows the [Homebrew cookbook](https://docs.brew.sh/Formula-Cookbook) and [tap contract](https://docs.brew.sh/Taps). Dependencies are the upstream [br formula](https://github.com/Dicklesworthstone/homebrew-tap/blob/main/Formula/br.rb) and [bv formula](https://github.com/Dicklesworthstone/homebrew-tap/blob/main/Formula/bv.rb). Publication uses [GitHub CLI's explicit tag verification](https://cli.github.com/manual/gh_release_create).
