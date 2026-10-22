# Tracker publication

Inspect the selected endpoint with `beeswax beads env --json`. `beeswax beads sync` receives and publishes its snapshot; ordinary Beads mutations and local worker handoffs stay local.

Publish at an authorized remote exchange checkpoint or after integration and final task/workflow updates. A code pull alone does not refresh the tracker.

## Before exchange

Check that the `br` resolved on the execution environment's `PATH` supports `--merge --from INCOMING --base BASE` in `br sync --help`; inspect commit/features with `br version --json`. Builds with and without the capability can report the same version.

Use Hive's [maintainer setup](https://github.com/codethread/hive/blob/main/CONTRIBUTING.md#native-beads-checkout) for a persistent local fork build, or its [Homebrew recipe](https://github.com/codethread/hive/blob/main/docs/releases.md#native-beads-dependency) for packaged installation. Follow the chosen route's `PATH` and update guidance, not `br upgrade`; stock Homebrew `br` alone lacks the patch. If the capability is unavailable, stop adoption rather than substituting a Git checkout merge or redirecting `BEADS_JSONL`.

Finish staged non-snapshot changes before running `beeswax beads sync`. Unstaged hook and recipe edits stay local; publication preserves accepted remote non-snapshot files without checking them out over the runtime.

## First publication

After authorized first initialization, retain the receipt's database and permanent checkout. Confirm that checkout is on `tracker/state` and that no accepted remote tracker branch already exists; existing remote history requires bootstrap or deliberate reconciliation.

With publication authorized, run the following from the permanent tracker checkout, using the selected `BEADS_DB` and supplied `BD_ACTOR`. Replace `REMOTE` with the reviewed remote:

```sh
br sync --flush-only --db "$BEADS_DB" --actor "$BD_ACTOR"
git status --short
git add -- .beads/issues.jsonl
git diff --cached -- .beads/issues.jsonl
git commit -m "chore(beads): establish tracker state"
git push --set-upstream REMOTE tracker/state
```

Review the snapshot and any other staged changes before committing. Once the snapshot is tracked and the upstream exists, use `beeswax beads sync` for subsequent exchange. Keep tracker history on `tracker/state`; it is not an application-branch merge.

## Publication contention

`tracker_busy` with `publication: "not_started"` means another local publisher held the publication lock before this invocation could acquire it. The checkpoint attempt was unsuccessful, but publication never began and no alert was created, cleared or replaced. Busy alone does not require pausing ordinary work or incident recovery; any existing hold still applies. You may retry the authorized checkpoint after the publisher finishes. Native lock-wait policy and automatic retries are unchanged.

## Recovery and cleanup

On conflicting claims, JSONL conflicts or synchronization failures other than pre-publication `tracker_busy`, stop tracker work and load `beeswax skills get tracker-recovery`. It owns waiting, authorization, writer quiescence and evidence-preserving recovery; `beeswax beads recover` prints the current incident handoff without changing it.

Retain `.beads/hive-sync-incoming.jsonl` and `.beads/hive-sync-base.jsonl` from the failed attempt alongside the live tracker state and diagnostics. These are the accepted remote and Git common-base inputs, not replacement live exports. Preserve audit history and native conflict safeguards; neither rerunning with force flags nor copying an input over the live export is routine recovery.

Keep the permanent tracker worktree outside feature cleanup. Publish completion and verification from a surviving checkout.
