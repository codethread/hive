# Install and release Hive

Hive distributes one versioned archive containing `beeswax`, `honeycomb`, `bee`, `colony`, `colony-runtime`, `colony-worker`, `colony-watchdog`, `busybee`, `qlock` and `hive-ui`. Waggle remains a development tool and is excluded from release archives. Every workspace package, including Waggle, shares the suite version. Each distributed executable reports its compiled package version with `--version`.

## Homebrew installation

Hive uses `codethread/hive` for public source, release assets and its Homebrew tap. Once the release and `Formula/hive.rb` are published, install through the explicit tap URL (Homebrew's short form assumes a `homebrew-` repository prefix):

```sh
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

Use `codethread/hive` for both repository inputs. `tapCheckout` identifies the repository in which a separate formula worktree will be created; it may equal `canonicalRoot`. Retain the permanent `beadsDb` and an absolute `artifactDirectory` outside disposable worktrees. The input schema owns the remaining fields and constraints.

Before first publication, verify recorded authorization covers public source and reachable history as well as assets. Review that history and the concrete release source before changing visibility. An explicit authorization remains valid throughout the run. Repository creation or a different disclosure destination requires its own authorization.

Follow `show` and `discover` on the returned run. On retry resume that same run, inspect existing effects, and collect saved results; do not repeat closed work. Build or native verification defects take the repair route through renewed Land and fresh archives. The candidate keeps its unpublished version; a published version is never replaced. The chart orders destination checks, preparation, Land, immutable builds, native verification, GitHub publication and the Homebrew update. Missing credentials or platform runners keep their visit open with the next action recorded.

Preparation runs in a clean nested worktree:

```sh
bun run release prepare 0.6.0
```

Choose the authorized version; the example is not a publication claim. It must exceed every current package and the newest reachable stable suite tag. Fetch the authoritative release repository's tags before preparation. The tool selects the highest stable `vX.Y.Z` tag merged into `HEAD`; unrelated package tags and prereleases are excluded. With no such tag, it explicitly uses all Git history for the initial release.

Preparation updates the root and every `lib/*/package.json`, refreshes `bun.lock` without lifecycle hooks, and writes `releases/vVERSION.md`. Each package's section lists commits touching its directory since the previous tag, or **No change.** These are package-local changes; a shared dependency can change runtime behavior without a package-local commit. The root section includes repository-wide history. Busy Bee's `busybee.toml` compatibility versions remain independent.

The Release visit then starts or resumes the ordinary [Land workflow](../.workflows/land/workflow.ts) with `completedTasks: []`. Land owns check, review, commit, integration, local tool update and cleanup. Retain its exact integrated source commit and verify the changelog still covers that revision if concurrent integration changed the base. Defer final tracker publication until the surrounding Release finishes.

## Build and verify one candidate

Land [release-verify.yml](../.github/workflows/release-verify.yml) on the default branch before manual dispatch. Set `release_revision` to the retained full source SHA, then invoke:

```sh
gh workflow run release-verify.yml --repo codethread/hive \
  --field revision="$release_revision"
```

Retain the returned run URL/ID and inspect it with `gh run view`; `gh run watch --help` covers waiting. Record the repository, workflow revision, requested source revision, run ID and attempt. The workflow builds all four archives once from the exact source commit using `bun run release build`, frozen dependencies and disabled lifecycle hooks. Its four native jobs consume that uploaded candidate by artifact ID. They do not rebuild it. Linux archives use glibc. The workflow has read-only repository permissions and performs no publication.

The candidate artifact is named `hive-candidate-<revision>-<run_id>-<run_attempt>`. Each platform produces `hive-native-proof-<platform>-<revision>-<run_id>-<run_attempt>` for `darwin-arm64`, `darwin-x64`, `linux-arm64` and `linux-x64`. The workflow owns runner labels, pinned Bun/dependency versions and artifact retention; download evidence before it expires.

Use `gh run download --help` to select that exact run and each artifact by name. Put the candidate in the retained `artifactDirectory` and each platform proof in a separate directory outside disposable worktrees. The candidate contains four archives, `manifest.json` and `SHA256SUMS`; each archive holds `release.json` and `bin/` with the ten executables. Each proof artifact contains `native.json` and `dependencies.json` when those steps reached output. Failure uploads can be partial and are not acceptance evidence.

Require all four native jobs to succeed. Check each `native.json` has `ok: true`, the requested source/platform and matching actual host OS/architecture. Match its `ci` repository, workflow ref/SHA, run ID/attempt and artifact ID/digest to the retained Actions records. Rehash the downloaded candidate and compare its files with every proof's `files`, its parsed `manifest` and `SHA256SUMS`. The artifact digest identifies the transport container; archive hashes identify the files that will be published. A rebuild from the same source SHA needs new native proof.

The [native verifier](../lib/tooling/src/release-verify-cli.ts) checks candidate/embedded metadata, exact companion placement, all executable versions, public help, qlock, an installed-dependency Busy Bee workflow and Hive UI HTTP assets using a disposable tracker. Run its `--help` for local invocation and prerequisites. Missing, skipped or failed platform jobs keep verification incomplete; cross-compilation and emulation do not establish native execution.

Generate the formula from the downloaded candidate with `bun run release formula`; its `--help` supplies arguments and `--schema` the manifest contract. Formula generation rehashes all four archives and rejects mismatched names/digests. Validate the generated Ruby with `ruby -c` and retain it as `hive.rb` beside the candidate. Local `release build` is available for investigation; its output is a separate candidate requiring its own native verification. Inspect partial output before retrying and preserve failed-candidate evidence.

## Complete checks outside CI

Verify Colony resolves companion executables beside its installed binary; the CI inventory/version checks alone do not prove runtime resolution. Keep smoke tests isolated from production services.

For a local Homebrew test, copy the generated formula into a disposable local tap and change only its download URLs to `file://` URLs for those exact archives. Run `brew install --build-from-source TAP/hive` and `brew test TAP/hive`, then remove that test installation/tap. Keep this local fixture separate from the published formula. Verify no `.beads` directory or service appears merely from installation. The formula's test checks all versions, help and a real qlock status operation.

Verify the consumed Beads contract with `bun run test:contracts` against the release dependency versions. `dependencies.json` identifies pinned download archives; `native.json.dependencies` records the versions and hashes of binaries actually executed. Check those versions against current upstream Homebrew formulae. The generated formula follows the dependency tap, so CI version checks do not establish the Homebrew dependency contract.

## Publish the verified bytes

Only perform this section after native verification and recorded publication authorization. Every release keeps an annotated `vX.Y.Z` tag on the exact versioned source commit in its manifest. Its GitHub assets and Homebrew formula must identify that same version and archive bytes. The later formula commit never changes the source tag.

From the canonical checkout, set `release_version`, `release_revision` and `artifact_directory` to the retained version, exact commit and candidate directory. Inspect existing tags/releases/assets first. Never force a tag or clobber an asset; after interruption, continue only effects whose identity and bytes match the retained manifest.

```sh
git tag -a "v$release_version" "$release_revision" -m "Hive $release_version"
git push git@github.com:codethread/hive.git "refs/tags/v$release_version"
gh release create "v$release_version" --repo codethread/hive --verify-tag --draft \
  --title "Hive $release_version" --notes-file "releases/v$release_version.md"
gh release upload "v$release_version" --repo codethread/hive \
  "$artifact_directory"/hive-*.tar.gz "$artifact_directory/manifest.json" \
  "$artifact_directory/SHA256SUMS" "$artifact_directory/hive.rb"
```

Read back the remote tag and compare its peeled commit with the manifest. Download the draft assets into a new directory with `gh release download`, compare hashes with the saved artifacts, and only then publish:

```sh
gh release edit "v$release_version" --repo codethread/hive --draft=false
```

Download the public URLs without authentication and verify hashes again. Use Honeycomb to create a clean nested worktree from the tap's default branch, using `tapCheckout` as its repository anchor. Copy the generated `hive.rb` to `Formula/hive.rb` there, then run `brew style`, `brew audit` and an actual installation/test against the published URLs. Installation must create neither a tracker nor a service.

For Hive's same-repository tap, start or resume ordinary Land beneath the Release run with `completedTasks: []`. This is a formula-only commit: the archive's checksum cannot be part of its own source revision. Leave canonical source edits to Land's integration step and retain the original tag. Defer tracker publication until Release finishes. A different tap follows its repository's review/commit/push policy. Record the actual integrated tap commit and verify the fully qualified install command. The previous valid formula remains until replacement assets are publicly available.

Record source/tag, release URL, archive hashes, platform test evidence, tap commit and installation results on the Release run. Busy Bee closes the run after all visits complete; the authorized caller then closes proven scope work and publishes final tracker evidence once. An unresolved external operation stays open with its specific blocker and required next action.
