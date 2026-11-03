# Beads tracker growth and sync performance — full investigation report

- **Original research:** 22 October 2026, by `tan-watery-limpet`.
- **Archival conversion:** 23 October 2026, by `emerald-chilly-cobra` (Bookworm).
- **Original report:** `/Users/ct/.local/state/hive/investigations/beads-sync-performance-20261022/report-body.html:1`.

This is a complete Markdown conversion, not new research. Presentation-only navigation is omitted; collapsible evidence is expanded below. The report retains the original author's voice, findings and evidence limits. Recommendations and proposed work remain advice, not accepted policy or authorization. Source paths and line numbers are historical references and were not revalidated during this conversion; the findings are readable here without the original HTML.

**Main finding: this is predominantly a native merge cost, not an 80 MB network upload.**

On an isolated copy of this tracker, native reconciliation took **39.6–40.9 seconds**, including an unchanged repeat. The delay is reproducible without Git, network access or competing writers. Data growth is real, but routine backup cleanup is not the main performance fix.

Investigation: 22 October 2026. Installed br 0.7.6, commit `b77ae7094e9fde7cba304ba00d306ec483c6bdd2`; Beeswax 0.9.1. No production pruning, repair, configuration change or tracker publication was performed.

## 1. What cleanup APIs actually exist?

| API | What it removes or compacts | Important limit |
| --- | --- | --- |
| `br history prune --keep N --older-than DAYS --max-bytes BYTES` | Local JSONL backup generations in `.br_history`. | Reclaims disk, not the current snapshot or database records. Explicit pruning can remove protected recovery evidence; inspect before choosing a policy. |
| `br delete ID…`; `--from-file FILE`, `--dry-run` | Soft deletion: records deletion as a tombstone; removes dependency links but retains prose, comments, labels and existing events. | Not archival, summarization or immediate payload reclamation. Closing a bead does not invoke this cleanup. |
| `br delete --hard ID…` | Physically purges selected issues and associated data from SQLite, then excludes them from export. | Destructive: removes comments, audit history and other associated state. Coordinate other clones before removing deletion evidence. Do not substitute a bulk delete for an agreed retention policy. |
| `br delete --hard` with *no IDs* | Purges all existing tombstones. Supports `--dry-run`. | Verified in implementation, despite terse CLI help. It does **not** purge all closed issues. Only 50 tombstones were exported here: about 0.2 MB, so this is not the useful size target. |
| `br doctor --repair --unsafe-auto-fix --only fm-caches_indexes-db-bloat-vs-jsonl` | Native physical database compaction through a guarded VACUUM path; preview with `--dry-run`. | Finding-triggered, not an unconditional compact command. The detector requires database size above 10× JSONL size; this tracker is only about 3×. Compaction preserves records and does not shrink JSONL. |
| `beeswax git pack --repo . --json` | Consolidates Git objects, preserving reachable and unreachable recovery history. | Hive API, not br. Does not prune beads, shorten branch history or shrink the current JSONL. Shared Git object store; schedule separately from other maintenance. |

**No supported closed-issue archive/summarize/compact command was found in this build.** Existing `compaction_level` and related fields are not proof of such an API. No standalone age-based audit-event trimming API was found either.

Tombstone export retention also exists as `deletions_retention_days` in native workspace metadata, not a normal documented config-schema key. It is unset here; unset and zero both mean retain forever. This controls export eligibility of deleted records, not retention of closed work or physical database purging. It is not a recommendation to hand-edit metadata.

## 2. Where the time goes

| Operation measured | Wall time | Interpretation |
| --- | --- | --- |
| Native merge of copied database + accepted/base snapshots | 40.9 s | No Git or network involved. |
| Repeat against the same inputs, unchanged export | 40.8 s | Repeated reconciliation still pays nearly the full cost. |
| Another merge, with native phase logging | 39.6 s | Consistent reproduction. The actual three-way merge calculation was about 75 ms; surrounding loading, witnessing and publication dominate. |
| Forced full JSONL export on the copy | 5.7 s | All 10,828 exportable merged records. Normal clean export returned immediately in 0.37 s. |
| GitHub remote query / fetch dry run | 1.07 / 1.08 s | Network negotiation, not a complete transfer benchmark. |
| Construct thin Git pack for last local publication | 4.0 s; 27,449 bytes | CPU cost is meaningful; incremental transfer need not send the whole JSONL. |
| Read committed JSONL through Git | 0.15 s | Retrieving one local snapshot is comparatively cheap. |
| Physical compaction experiment, disposable copy only | 243 MB → 134 MB | Then merge still took **42.5 s**. Good disk saving; no speed improvement demonstrated. |

The repeat merge used about **38 seconds of user CPU** and **1.46 GB peak resident memory**. This was not a 40-second lock wait. On the live system, publisher contention, native lock waits and concurrent remote publication can add further delay; those were not needed to reproduce the problem.

**Why:** Beeswax always fetches and invokes native three-way reconciliation before publication. Native merge hydrates the complete issue set and repeatedly computes whole-database witnesses, including comments, relations and audit events. It updates only changed issue rows, but still runs the receipt/export/base-snapshot verification sequence on an unchanged repeat. Shrinking only the transmitted JSONL is therefore not equivalent to removing all reconciliation cost.

**Do not remove safety checks to make the benchmark faster.**

The promising optimization is a native, correctness-preserving unchanged/incremental path and less repeated full-state work. The current witnesses protect against concurrent writes and interrupted publication.

## 3. What is growing?

The initial local snapshot was **80.08 MB / 10,692 records**: 9,168 closed, 1,431 open, 50 tombstones and 43 in other statuses. SQLite held about 243 MB and 100,336 audit events. MB below means decimal MB.

| Snapshot content | Approximate bytes | Share |
| --- | --- | --- |
| Descriptions | 47.4 MB | 59% |
| Comments | 17.7 MB | 22% |
| Notes | 5.9 MB | 7% |
| Everything else | 9.1 MB | 11% |

**Automation dominates the volume:** system records occupied 25.7 MB and non-system workflow records 32.4 MB—about **73% combined**. Ordinary records occupied 22.0 MB. These are mutually exclusive categories; “ordinary” does not mean all of its contents are human-authored.

Published snapshot growth is substantial: **3.7 MB on 8 October → 20.6 MB on 14 October → 53.7 MB on 18 October → 79.9 MB on 22 October**. This is real payload growth, not merely SQLite free pages or Git pack overhead. The JSONL is already compact serialization; removing whitespace is not the opportunity.

After incorporating already-known incoming records in the benchmark copy, closed work occupied 71.9 MB of its 80.8 MB snapshot. But closed records at least 14 days old accounted for only **1.7 MB**; those at least seven days old accounted for 23.4 MB. Most of the volume is recent. A conservative “archive after 30 days” policy would not solve today’s size.

### Disk accumulation is a separate problem

- **Local JSONL history: roughly 1.1–1.2 GB.** It is already automatically bounded: 100 backups, 30 days, a five-second backup throttle, and a default 1 GiB ordinary-pair byte budget. Protected or unclassified evidence can sit outside that budget. This is not proof that cleanup is absent. `BR_HISTORY_MAX_BYTES` and `BR_HISTORY_MIN_INTERVAL_SECS` control the budget and throttle; lowering retained history sacrifices restore points.
- **Git objects: 783 MiB loose + 60 MiB packed** in the shared repository object store. Explicit packing is worth considering for storage, separately from the native merge bottleneck.
- **Database page slack is real.** Physical compaction on the disposable copy nearly halved its size while preserving identical exported JSONL and table counts, but did not speed merge.

## 4. Are we using Beads incorrectly?

**Not in the sense that a correctly invoked sync should be instant.** The prescribed sync route itself reproduces this cost. There are two distinct operations:

- `br sync` reconciles SQLite and JSONL locally; it never runs Git.
- `bun run beads:sync` invokes Beeswax to fetch, reconcile, validate, commit and push the shared tracker snapshot.

This checkout has `sync.auto_import: false` and `sync.auto_flush: true`. Ordinary mutations therefore export locally but do not publish to GitHub. Disabling auto-flush is a separate workflow change: JSONL readers and recovery assumptions need review first.

Hive already says to publish only for an explicit remote refresh, once after landing and final task updates, or a deliberate cross-clone handoff/checkpoint. Local startup, child completion, progress and local commits do not need publication. There were 27 snapshot-changing tracker commits on 22 October so far; that alone does not establish misuse, and it excludes no-change sync attempts.

## 5. Recommended order

1. **Fix or optimize native merge first.** The reproducible 40-second unchanged merge is the clearest performance target. Add phase timings and a benchmark at this tracker size; then evaluate incremental witnesses / a safe no-change path, preserving concurrency and recovery guarantees.
2. **Keep publication at the existing checkpoints.** Batch final task updates before the one landing publication. Avoid duplicate local handoff/startup syncs. This reduces frequency, not the cost of each legitimate sync; do not skip refresh/claim coordination when work crosses clones.
3. **Reduce new redundant automation prose and design explicit retention.** Descriptions, comments and notes are the volume. Review repeated full request/result/checkpoint payloads before deciding which information can be referenced once or archived. Protect active workflow dependencies and durable architectural evidence.
4. **Treat history pruning and Git packing as disk maintenance.** Useful, but neither is supported by these measurements as the main latency fix. Tombstone cleanup saves almost nothing here. Do not bulk-delete closed beads merely to improve this benchmark.

## Method, limitations and evidence

A read-only SQLite online backup captured a consistent local database. Mutating benchmarks ran only against disposable copies with explicit database paths and automatic import/export disabled; a full export was requested explicitly where measured. Git common-ancestor and already-present upstream snapshots supplied merge inputs. Incoming records increased the benchmark export from 10,692 to 10,828, so the initial census and benchmark population are intentionally distinguished.

Network tests were remote inspection and dry runs, not a real tracker exchange. A push dry run was rejected because the real remote had advanced; no real push was attempted. The 27 KB pack models the previous local publication with its parent available remotely, not an assertion about every future transfer. A compressed standalone snapshot was about 18 MB; cold clones and large divergent changes can cost more.

The compaction experiment used system SQLite only on a disposable copy. It demonstrates physical-size versus merge-time behavior; it is not verification of applying the native doctor fixer to the live endpoint. The compacted and original benchmark copies exported the same SHA-256 and retained matching issue, comment, relation, label and event counts.

No end-to-end live publication was timed, and individual sporadic minute-long incidents were not traced. The uncontended local reproduction already explains most of the reported scale. No application code was changed; no code test suite was required. Specialist research used ordinary local Bee workflow records.

The two disposable database/snapshot directories were removed after measurement, reclaiming about 1.3 GB. Only the small report, measurements and diagnostic evidence remain.

Retained measurement files:

- `/tmp/hive-sync-research-20261022/inventory.json:1`
- `/tmp/hive-sync-research-20261022/native-timings-canonical.json:1`
- `/tmp/hive-sync-research-20261022/profile-merge.stderr:1`
- `/tmp/hive-sync-research-20261022/git-local-timings.json:1`
- `/tmp/hive-sync-research-20261022/vacuum-timing.json:1`
- `/tmp/hive-sync-research-20261022/composition-merged.json:1`
- `/tmp/hive-sync-research-20261022/growth.json:1`

Independent native API/source research was delivered by Honeybee in response `hv-35zcfq`, with a focused source lookup in `hv-0ws556`. The full research response is retained at `/tmp/hive-sync-research-20261022/honeybee-result.json:1`.

Verified source pointers:

- Hive publication and unconditional native reconciliation: `/Users/ct/dev/projects/hive/lib/beeswax/src/beads/publish.ts:132`
- Publication checkpoints: `/Users/ct/dev/projects/hive/docs/beads-integration.md:23`
- Native merge loading, witnesses and changed-row selection: `/Users/ct/dev/projects/beads_rust/src/cli/commands/sync.rs:5536`
- Whole-database witness, including audit events: `/Users/ct/dev/projects/beads_rust/src/sync/mod.rs:6781`
- Delete / no-ID tombstone GC / hard purge dispatch: `/Users/ct/dev/projects/beads_rust/src/cli/commands/delete.rs:98` and `/Users/ct/dev/projects/beads_rust/src/cli/commands/delete.rs:302`
- Physical purge details: `/Users/ct/dev/projects/beads_rust/src/storage/sqlite.rs:8454`
- History defaults and byte-budget rotation: `/Users/ct/dev/projects/beads_rust/src/sync/history.rs:20` and `/Users/ct/dev/projects/beads_rust/src/sync/history.rs:758`
- Guarded compaction and detector threshold: `/Users/ct/dev/projects/beads_rust/src/cli/commands/doctor.rs:5608` and `/Users/ct/dev/projects/beads_rust/src/cli/commands/doctor.rs:5708`
