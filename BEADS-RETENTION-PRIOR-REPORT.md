# Beads retention policy exploration — full report

- **Original research:** 22 October 2026, by `scarlet-vivacious-condor`.
- **Archival conversion:** 23 October 2026, by `emerald-chilly-cobra` (Bookworm).
- **Original report:** `/Users/ct/.local/state/hive/investigations/beads-retention-policy-20261022/report-body.html:1`.

This is a complete Markdown conversion, not new research. Presentation-only navigation is omitted; collapsible evidence is expanded below. The report retains the original author's voice, findings and evidence limits. Recommendations and proposed work remain advice, not accepted policy or authorization. Source paths and line numbers are historical references and were not revalidated during this conversion; the findings are readable here without the original HTML.

**Policy exploration · 22 October 2026**

**No production pruning**

Building on tan-watery-limpet’s investigation `hv-kog6al`, this report explores ways Hive could keep Beads history lean, grounded in `beads_rust`’s current behavior. **No retention policy or period has been selected.** “Keep description and notes; drop comments” was an illustrative question, not a requirement.

**Recommendation**

Reduce unnecessary data at creation first. Then consider archival of *bounded, settled execution families*, preserving durable answers and decisions. For substantial destructive compaction, improve native Beads’ retention contract rather than adding a second merger or editing generated JSONL.

## What changed our understanding

- **Comments are not a disposable log field.** Some resolve failed requests; others carry verification. Native merging treats comments as append-only. There is no comment-delete CLI.
- **Whole-record removal is simpler to agree on, but does not reliably stay removed.** A native merge can turn an incoming missing record into a full-payload local tombstone. Once deletion knowledge disappears, stale records can return.
- **Our normal publication does not use the standalone Git merge driver.** Native `br sync --merge --base … --from …` owns reconciliation. Changing only Hive’s Git driver would not change normal publication.
- **“Closed beads” is the wrong eligibility filter.** In the measured snapshot, none of the 1,455 checkpoint beads were closed, although 1,441 pointed to closed runs. Conversely, responses and architectural evidence are born closed.
- **Native `delete --cascade` is not descendant cleanup.** It follows blocked dependents. Our dry-run preview from a child selected its parent; the preview from the parent did not select that child.
- **There are concrete prevention opportunities.** Repeated captured role prompts occupied 6.33 MB of encoded values, versus 0.139 MB for their distinct values; stdout-activity comment text occupied 4.25 MB.

Evidence: 15 native-merge cases and 13 standalone-driver cases using installed executables and synthetic inputs; six native API probe groups; matching native source; current Hive consumers; and read-only composition measurements. These are merge-boundary tests, not a full networked or concurrent multi-host trial.

## 1. What is growing—and what shrinking it would accomplish

The prior investigation measured an approximately 80 MB export and a 243 MB database. A native no-change merge took about 40 seconds; the actual three-way calculation was about 75 milliseconds. Whole-state hydration, witnesses and publication dominated. VACUUM reduced the disposable database to about 134 MB but did not improve that merge timing. **Retention could reduce the work population, but no retention speedup has yet been measured.**

A read-only snapshot at 20:17 UTC contained **10,910 records / 81.26 MB**. The following label-based categories are mutually exclusive inventory buckets, not retention eligibility classes. MB means decimal megabytes; row sizes are compact reserialization estimates, not SQLite allocation.

| Category | Records | Record bytes | Interpretation |
| --- | --- | --- | --- |
| Workflow work / runs / visits | 4,528 | 32.80 MB | Largest category; includes useful briefs, results and repeated instructions—not all waste. |
| Spawn requests | 2,031 | 17.72 MB | Captured recipes plus substantial observation history. |
| Authored responses | 1,525 | 10.31 MB | Often the valuable answer we actually want to keep. |
| Other ordinary work | 1,277 | 9.82 MB | Task briefs, decisions, acceptance and progress. |
| Workflow checkpoints | 1,455 | 8.35 MB | Machine snapshots and visit/result history; 1,441 reference closed runs. |
| Architectural evidence | 94 | 2.25 MB | Curated knowledge, including append-only decision history. |

### Measured opportunities, not additive savings promises

- **Role capture:** 1,889 `system_prompt` values contained only 32 distinct strings. Exact-value sharing has roughly 6.19 MB of theoretical redundancy to remove, before reference/index overhead and outer JSON escaping. Current captured recipes are self-contained; replacing them needs an explicit representation change.
- **Telemetry:** stdout-activity comment text was 4.25 MB, lifecycle-observation text 0.484 MB, and acknowledgment text just 0.022 MB. Acknowledgments are small but semantically important.
- **Checkpoint internals:** encoded snapshots accounted for 4.85 MB and accepted-result history 1.76 MB. These measurements describe stored fields, not independent bytes that can all be deleted safely.
- **Hierarchy:** 569 closed records had a nonclosed ancestor. Waiting for every ancestor to close can retain completed work indefinitely, especially under permanent references.
- **Age alone:** the prior reconciled snapshot had about 23.37 MB of closed-record payload at least seven days old, but only 1.69 MB at least fourteen days old. Those overlapping age cohorts are not deletion eligibility sets.
- **Compression:** a later 81.29 MB export compressed to 18.40 MB with gzip level 6 in memory. This supports compressed cold storage as an option; it says nothing about native merge speed or incremental archive deduplication.

Sources: prior measurement comment on `hv-kog6al`; current `composition.json` and `compression.json` in the evidence bundle.

## 2. “History” spans several different stores

| Store | What it contains | Relevant control | What that does not solve |
| --- | --- | --- | --- |
| Current SQLite logical data | Issues, comments, relationships, audit events and native operational tables | Native updates / deletion; future native semantic retention | Physical packing alone leaves the same logical population to inspect. |
| Current JSONL / native base | Shared issue state, including comments and relationships | Native export and merge; tombstone export retention | JSONL is not a full audit-event backup. Closed records remain exported. |
| `.br_history` | Local JSONL backup generations and metadata | `br history prune`; automatic limits | Does not delete live comments, issue audit events, or Git history. |
| SQLite physical space / recovery files | Allocated/free pages and repair evidence | Native doctor’s guarded bloat repair; separate recovery-family retention | Does not summarize or forget logical records. |
| Git objects and tracker commits | Published snapshots over time | Lossless `beeswax git pack`; separate deliberate history-retirement policy | Deleting a current row does not erase reachable old commits; packing does not reduce live JSONL. |
| Colony logs / receipts / private history | Local attempt diagnostics and runtime evidence | Colony-owned lifecycle and local artifact policy | Cleaning Beads does not clean these files, and they are not interchangeable with shared task authority. |

Choose which cost matters: interactive context, merge latency, live record count, local disk, transfer size, or permanent historical erasure. They require different policies. The prior incremental Git pack was only about 27 KB despite the large export; that does not prove every network exchange is cheap, but it does undermine “the whole JSONL size must be sent every time.”

## 3. What native Beads actually offers today

Verified against `br 0.7.6`, commit `b77ae7094e9fde7cba304ba00d306ec483c6bdd2` on the Hive snapshot-sync fork. Do not infer this behavior from the version number alone.

| Surface | Actual effect | Policy fit / limitation |
| --- | --- | --- |
| `br update` text replacements | Can replace description, design, notes and other supported text. Clearing nonempty text or shrinking below half its character length requires `--force`. `--if-unchanged` checks the local revision transactionally. | Usable for deliberate ordinary-task summaries. Not a generic machine-payload summarizer; the revision check is local, not a distributed reservation. Our description-only shrink did not add audit events. |
| `br comments add/list` | No edit or delete CLI. Comment identity includes issue, author, timestamp and body; integer IDs are local. | “Delete all comments on close” is not currently a supported operation or merge protocol. |
| `br delete ID` | Removes incoming/outgoing links, marks a tombstone, retains prose, comments and existing audit events. | Propagates deletion intent but is not payload compaction. It can break retained readers’ link contracts. Ordinary updates to tombstones are refused. |
| `br delete ID --hard` | Physically removes the issue, comments, labels, relationships, events and related native bookkeeping; export then omits it. | Actually reduces logical data, but loses deletion protection and online history. No `--if-unchanged` option on delete in this build. |
| `br delete --hard` without IDs | Purges *all tombstones* in the workspace. | Not “purge old closed work.” Dangerous as a casual maintenance shortcut. |
| `delete --dry-run`, `--from-file`, `--cascade` | Can preview / name candidates; cascade follows blocked dependents, including reversed parent-child blocking direction. | Preview is useful evidence, not a reservation. Do not substitute cascade for explicit lifecycle inventory. |
| `deletions_retention_days` in workspace metadata | Expired tombstones are omitted from export, but remain in SQLite. Unset or zero retains indefinitely; expiry requires a known deletion time. | A dissemination horizon, not garbage collection or proof every clone saw deletion. Our TTL probe confirmed retained DB row/comment after export omission. |
| `br history prune` | Prunes local backup files by count, age and/or byte budget. Ordinary automatic backups already have a 1 GiB budget. | Useful disk housekeeping, unrelated to semantic issue retention. Explicit pruning can include protected backups. |
| Native doctor VACUUM repair | Guarded physical compaction through its bloat finding and repair path. | No removal of logical history; the prior experiment found no merge improvement. |
| `br create --ephemeral` | Creates DB-local records excluded from JSONL. | Suitable only for genuinely local scratch work. Our probe retained the DB row and event. Not an archive, automatic expiry, or supported conversion of existing durable records. |
| Semantic archive / compact / event-age prune | No supported command found in this build. Persisted `compaction_level`, `compacted_at` and related fields do not establish a working compaction API. | Would require native work, not invoking an undocumented magic flag. |

**Cascade selection, verified by dry run**

For `child → parent` containment and `consumer → parent` blocking: the parent’s cascade preview selected the blocked consumer, not the child. The child’s preview selected the parent and that consumer. A merely related record was excluded. These probes verified selection, not deletion effects. Native blocking semantics and archival containment are different graphs.

Native source anchors: `/Users/ct/dev/projects/beads_rust/src/cli/commands/update.rs:1728`; `/Users/ct/dev/projects/beads_rust/src/cli/commands/delete.rs:100`; `/Users/ct/dev/projects/beads_rust/src/cli/commands/delete.rs:283`; `/Users/ct/dev/projects/beads_rust/src/storage/sqlite.rs:7850`; `/Users/ct/dev/projects/beads_rust/src/storage/sqlite.rs:8348`; `/Users/ct/dev/projects/beads_rust/src/storage/sqlite.rs:8445`; `/Users/ct/dev/projects/beads_rust/src/storage/sqlite.rs:15055`. Broader API research: responses `hv-35zcfq` and `hv-6ibc5z`.

## 4. What the installed merge commands did

### Two distinct paths

```text
Normal tracker exchange:
Git common ancestor + fetched snapshot + live SQLite
    → native br sync --merge --base BASE --from INCOMING
    → canonical DB / JSONL / native base
    → Git publishes the resulting export

Separate Git merge adapter:
ancestor JSONL + current JSONL + other JSONL
    → beeswax system git merge
    → merged file or conflict markers
```

Normal publication performs no checkout merge and adds no Hive conflict override. Git transports and retains ancestry; native Beads decides records. The standalone adapter remains a separate interface, with different details.

| Synthetic scenario | Native publication merge | Standalone driver |
| --- | --- | --- |
| Record absent on both sides, present in ancestor | Stays absent. | Stays absent. |
| Incoming omits record; local copy unchanged from ancestor | **Local copy becomes a tombstone; old prose/comments remain and are exported.** | Not separately exercised; the reverse direction is below. |
| Local omits record; incoming copy unchanged from ancestor | Stays absent locally. | Line disappears. |
| One side removes record, other edits it | `DeleteVsModify` conflict; both directions tested. | Conflict; current-side removal tested. |
| Present ancestor contains no such ID; only incoming has stale record | Imports it as a record. | Keeps it as a record. |
| Local/current side removes comments; incoming/other side unchanged | Peer’s old comments return. | Removal survives the unchanged-side fast path. |
| Both remove all comments, with different update times | No comments remain. | **Ancestor comments return** through its fallback union. |
| Both remove all comments with otherwise identical records and update times | Not separately exercised. | No comments remain; identical-side fast path. |
| Comment removal versus new comment | Old and new comments retained. | Old and new comments retained. |
| Comment removal versus an independent notes edit | Not separately exercised. | Old comments return. |
| Identical prose summary, different update times | Converges. | Converges. |
| Different summaries, or summary versus independent notes edit | `BothModified` conflict: whole-issue scalar selection. | Conflict. |
| Both soft-delete with different provenance | `BothModified` conflict. | Conflict. |
| Local tombstone versus incoming live edit | Local tombstone protected. | Not separately exercised. |
| Incoming tombstone versus local live edit | Conflict; not globally symmetric delete-wins. | Not separately exercised. |

**Reading the matrix:** native “local/incoming” means SQLite/incoming JSONL; driver “current/other” means its two JSONL sides. The native cases used an explicit common ancestor. The table groups related cases and marks untested directions; it does not imply identical coverage of both implementations.

**Scope:** native SQLite and export state were inspected after each merge. An unrelated surviving record in the native fixtures avoided the entirely-empty-input guard. “Ancestor lacks ID” means a present, valid base—not a missing base file. No conflict-winner flags were used. Comment-removal states were constructed as experiment inputs, not through a supported comment-prune API. Native comment union preserves multiplicity by stable comment identity; it is not deduplication by local integer ID.

For comparison, native merge *without* the explicit common-ancestor input normally treats its base as a local export and preserves missing incoming rows. A missing base file and an entirely empty incoming file have additional safeguards. One cannot generalize a successful controlled merge into permission to hand-edit a production export.

### Implications for multiple pruning machines

1. **Whole-record deletion does avoid competing summary text when both sides agree.** But different soft-deletion metadata still conflicts, and one hard-pruned host cannot force every peer to hard-prune: the receiving peer may retain a full tombstone.
2. **Independent summaries are not commutative.** Two good summaries can conflict, as can a summary and an unrelated scalar edit. A deterministic transformation helps equal inputs, not stale or differing inputs.
3. **Absence cannot remember deletion indefinitely.** A fresh clone and a sufficiently old record can meet after the relevant deletion has disappeared from both base and local state. Our fixture reproduced reintroduction in that condition. Ordinary stale clones with a useful common ancestor may instead preserve deletion or conflict.
4. **A single maintenance publisher reduces races but does not solve stale rejoining clones.** Deletion knowledge must survive, or old writers must be rejected/reseeded under an explicit policy.
5. **Changing only the standalone driver is insufficient.** A future supported retention feature needs native semantics first. Then align the standalone adapter—or explicitly refuse unsupported compacted inputs—rather than silently giving it a second policy.

Hive publication: `/Users/ct/dev/projects/hive/lib/beeswax/src/beads/publish.ts:132`. Standalone selection / union: `/Users/ct/dev/projects/hive/lib/beeswax/src/git/merge-core.ts:195`. Native merge / comment union: `/Users/ct/dev/projects/beads_rust/src/sync/mod.rs:17603`, `/Users/ct/dev/projects/beads_rust/src/sync/mod.rs:17860`, `/Users/ct/dev/projects/beads_rust/src/sync/mod.rs:17957`. Native missing-record application: `/Users/ct/dev/projects/beads_rust/src/storage/sqlite.rs:21797`.

## 5. Policy must follow meaning, not column names

Field names alone do not identify retention value. Keeping descriptions and notes while dropping comments could protect bulky machine state while deleting small authoritative facts.

| Record / field | Current meaning | What must survive while existing readers remain supported |
| --- | --- | --- |
| Ordinary task description, design, acceptance | Intent, approach and delivery contract | A useful brief and proof-bearing outcome; not necessarily every repeated progress paragraph. |
| Task comments / notes | Progress, evidence, blockers and handoffs | Important reasoning and verification must be promoted or preserved before diagnostic history is discarded. |
| Spawn description | Captured recipe, host and run/stage assignment | Decodable execution provenance; current mutable kind files are not an equivalent substitute. |
| Acknowledgment comment / supersedes links | Resolution of an exact failed request closure | Removing them can make a resolved failure appear unresolved again. Labels do not replace this authority. |
| Observation / stdout comments | Historical diagnostics and latest-status inputs | A deliberate diagnostic contract; these are promising lower-value candidates, not interchangeable with acknowledgments. |
| Checkpoint description / notes | Workflow snapshot, visits, history / ownership lock | Resume and inspection requirements until the run is settled; terminal-run preview is also a current feature. |
| Stage notes / run notes / native closure | Original worker result / settlement fence / authoritative outcome | A closed visit may still await collection. A generic notes summarizer can break progression or recovery. |
| Response description and links | Immutable authored answer, producing task/request and correction lineage | Readers validate exact links and previous corrections. Deleting requests can remove links needed to read otherwise-retained responses. |
| Specialist evidence / merge reference | Curated decision history / provider reference and task associations | Closed does not mean dispensable. Keep their meaning and links unless their owners define a replacement retrieval contract. |

Sources: `/Users/ct/dev/projects/hive/lib/shared/src/spawn-request.ts:205`, `/Users/ct/dev/projects/hive/lib/shared/src/spawn-request.ts:239`; `/Users/ct/dev/projects/hive/lib/busybee/SPEC.md:13`, `/Users/ct/dev/projects/hive/lib/busybee/SPEC.md:70`; `/Users/ct/dev/projects/hive/lib/colony/src/response-store.ts:161`, `/Users/ct/dev/projects/hive/lib/colony/src/response-store.ts:351`; `/Users/ct/dev/projects/hive/docs/beads-meta.md:43`.

## 6. A menu of policies and implementation directions

These are alternatives and complementary directions, not an approved work plan. Prevention slows future growth; summaries and retirement shrink live data; archives and storage hygiene address storage costs. The menu distinguishes existing operations from proposed representation and retrieval changes.

### A. Prevent duplication before it becomes history

**Best initial direction**

- **One answer, referenced elsewhere.** File the response once; progress and closure refer to its ID plus concise verification. Do not paste the full report into the stage, parent, response and evidence record. Existing policy already encourages this.
- **Do not capture the same brief repeatedly without a consumer need.** Busy Bee currently embeds a stage’s full description in the dispatched prompt and then tells the worker to read that stage. The do-work definition also retains request prose in run brief, context and stage instructions. A smaller dispatch prompt could point to the native stage brief, which governs current work; preserve required delivery instructions and the checkpoint’s separate frozen visit rendering. Making frozen instructions override later scope corrections would be a new policy, not deduplication.
- **Keep result payloads bounded.** Workflow outcomes should contain what later transitions need, plus response/artifact references—not a second transcript. This is definition-specific, not a generic truncation rule.
- **Write useful updates, not heartbeat prose.** Avoid repeated “still working / all unchanged” comments. Keep source evidence in appropriate artifacts, with a concise interpretation and stable reference on the bead.

These changes reduce future shared bytes without deleting history. They still need normal ownership/review: frozen contracts and captured provenance cannot be replaced with pointers to changing content.

Direct duplication sites: `/Users/ct/dev/projects/hive/lib/busybee/src/runtime.ts:1665`; `/Users/ct/dev/projects/hive/.workflows/do-work/workflow.ts:22`.

### B. Publish less diagnostic telemetry

**Promising, measurable**

Colony already skips unchanged facts and throttles changed stdout activity to 30-second intervals, with initial/final exceptions. Consider a longer interval, transition/final-only publication, or keeping detailed samples local and exporting a bounded summary. Choose the freshness and debugging trade-off explicitly. Do not quietly move acknowledgments or scheduling authority into a lossy cache.

A “latest-only” representation could help, but simply overwriting a JSON field creates new whole-record scalar conflicts and does not itself prune native audit history. It is a protocol change, not a swap of storage columns. First measure bytes and events generated per completed request under each sampling policy.

`/Users/ct/dev/projects/hive/lib/colony/src/observations.ts:24`; `/Users/ct/dev/projects/hive/lib/colony/src/observations.ts:228`.

### C. Share immutable captured payloads

**Medium scope**

The measured 32 distinct role strings suggest storing immutable role content once and referring to its content hash/version. A verified Git object or deliberately shared artifact could preserve exact instructions without repeating them in every recipe. An immutable content record in Beads could also reduce repetition, but adds its own reference and garbage-collection requirements.

The crucial constraint is availability across clones and after source evolution. A hash without retrievable bytes, a worktree-local path, or “read today’s system prompt” is not equivalent to the captured recipe. Prefer smaller authored prompts first; introduce a payload store only if its measured benefit justifies the retrieval contract.

### D. Summarize selected ordinary records in place

**Possible now, narrowly**

Use supported text updates to retain the problem, final decision, acceptance proof, links and unresolved caveats, while replacing repetitive ordinary-task notes/descriptions. Preserve the original in an agreed archive if exact history matters. Native conditional updates can protect the local revision; a coordinated maintenance writer avoids competing summaries.

Limits: comments remain; machine JSON and immutable responses must not be summarized this way; independently edited scalar fields conflict. Severe shrinking requires explicit native overwrite authority. Our description-only update kept the same event count, but other field changes have their own audit behavior. It does not scrub backups, Git, other clones or existing events.

### E. Archive settled execution families

**Good policy unit; missing retrieval support**

Retain a compact online result and source task; move detailed run/visit/checkpoint/request diagnostics to a discoverable immutable archive. Preserve task/request/response lineage and enough metadata to answer “what happened, who ran it, which result was accepted, and where is the full evidence?”

Current readers expect native records and exact links. Arbitrary stubs or deleted checkpoints break those expectations. An initial policy can identify and measure candidate families without deleting them; an archive-aware read contract must precede removal. Exact terminal preview/replay becoming archive-only is a product decision, not merely housekeeping.

### F. Purge whole records after coordinated retirement

**Supported operation; strict operating conditions**

Native `br delete ID --hard` removes the issue, its comments and local audit events together. It suits explicitly dispensable, unreferenced data once all relevant clone state is accounted for. It is not safe as independent per-host cron based only on `closed_at`. Hard-purged data may come back, and native deletion removes relationships that retained readers may require.

A finite known fleet with a deliberate maintenance window can coordinate exact IDs and verify every endpoint. A fleet that permits arbitrarily stale clones/backups needs durable deletion knowledge or an enforced rejoin boundary. Merely choosing a long grace period does not prove either condition.

### G. Native compact tombstones / retention receipts

**High-leverage native enhancement**

Today tombstones keep the payload we want to shed, and ordinary updates refuse them. A native operation could retain a small deletion identity/provenance record while discarding eligible payload. Native merge/import would need to honor that compacted state so a peer’s old full tombstone or live record cannot rehydrate it.

This asks native Beads to own compaction semantics, local audit effects and relationship consistency—not Hive to rewrite SQL or manufacture JSONL. Plan/apply receipts with exact source revisions, affected IDs/bytes and explicit conflicts would make destructive maintenance reviewable. Existing legacy compaction fields are not that contract.

### H. Native comment retention and local event retention

**Separate enhancements**

For comments, intentional removals need a representation that survives append-only union: for example, native deletion markers keyed by stable comment identity, or a native sealed retention boundary. It must distinguish unseen comments from removed comments, preserve multiplicity, protect acknowledgment semantics, and handle late comments. Local integer IDs are insufficient across clones.

Audit events are a separate, DB-local store. A native event-age/count policy could reduce local witness cost without changing shared comment history, but would sacrifice forensic evidence and needs native ownership. Do not assume a future comment-prune API also prunes events—or that `history prune` already does either.

### I. Use ephemeral work only when it is truly local

**Existing API, limited fit**

For scratch calculations or disposable local work that never needs handoff, ephemeral creation avoids JSONL growth. It still consumes SQLite and does not automatically expire. Durable spawn requests, recovery state and shared answers cannot simply become ephemeral without changing Hive’s authority and observability contracts.

### J. Cold storage and storage hygiene

**Useful, different goals**

- **Compressed archives:** periodic immutable family/snapshot archives with manifests and verified retrieval. Avoid duplicating a full snapshot for every small task; choose incremental or bounded-family storage deliberately. Checksum, access and retention policy matter more than the file extension.
- **Git as an archive:** stable commit-plus-record pointers can retain published record history cheaply, but ordinary reads do not search old commits. Git JSONL snapshots omit DB-only audit events. They are not a complete lossless database archive.
- **Backup rotation and lossless Git packing:** useful for disk pressure now, without pretending to shrink the logical tracker.
- **VACUUM:** consider physical reclamation after logical cleanup when native diagnostics justify it; not as the primary retention policy.
- **Tracker epochs / year-by-year active trackers:** potentially bound the active population, but require archive-aware lookup, stable references, fleet cutover and rejoin rules. Hive currently shares one selected tracker per checkout configuration. This is a major authority change, not the first move.
- **JSONL sharding or Git history rewriting:** not drop-in policies. Current native exchange expects a complete snapshot; rewriting ancestry can remove the very common base deletion relies on. Neither is recommended as the initial solution.

### K. Improve native no-change / incremental merge work in parallel

The previous timings justify investigating native witness/population costs independently of retention. Better no-change performance preserves all history; retention controls long-term growth. They complement each other. Do not remove concurrency/recovery witnesses merely because they are expensive, and do not claim a retention speedup before an isolated before/after benchmark.

## 7. A proposed eligibility model

**Suggested unit: a bounded execution family rooted at one completed or explicitly settled run.** A parent groups work; it does not dictate that every descendant lives until the oldest ancestor closes. Conversely, a closed leaf is not automatically disposable.

1. **Classify:** identify the run, generated visits/groups, checkpoint, driver/stage requests, replacements and associated delivery. Do not classify with labels/status alone.
2. **Prove settlement:** verify native outcomes, collection/delivery completion, no unresolved request attention, no retained ownership/recovery uncertainty, and owning-host execution clearance. Closing a request is not proof that its process stopped.
3. **Check references:** examine typed inbound/outbound links, response correction chains and known embedded IDs. Preserve required endpoints; do not recursively expand deletion into the entire connected graph.
4. **Apply exclusions:** unresolved/HITL work, permanent references, incident holds, durable responses, specialist evidence and merge references remain excluded unless their owners explicitly define retention behavior.
5. **Wait the chosen grace period:** base it on meaningful settlement/late evidence, not blindly on every telemetry or maintenance update. Pick a rule only after deciding the desired debugging and rejoin window.
6. **Review a manifest:** exact IDs/revisions, original and proposed sizes, surviving references, archive locations, expected native effects and unresolved facts. A preview must not silently become authorization after the source changes.
7. **Archive / apply / verify:** verify retrieval before destructive effects, use native operations, then verify live consumers, exports and participating clones. Publish only through the normal explicit exchange policy.

This is an eligibility design, not an existing command. There is no need to close pinned `hv-1sylid`, reinterpret successful child outcomes, or alter records just to make them match a cleanup query.

## 8. Choose a cross-machine operating model explicitly

| Model | Benefit | Cost / unresolved requirement |
| --- | --- | --- |
| Prevention only; retain current history | Works with today’s merge rules; no deliberate history loss. | Existing population remains; growth slows rather than stops. |
| One coordinated maintenance writer, known clones | Simplest initial model for summaries and reviewed native retirement. | Must account for other writers, dormant clones and restoration sources. Local locks and one successful push are not fleet acknowledgment. |
| Independent host pruning under current APIs | Superficially easy automation. | Not recommended: conflicting tombstone provenance, whole-record edits, comment restoration, inconsistent hard purge and stale resurrection. |
| Native monotonic compaction with retained deletion knowledge | Potentially permits independent hosts to converge on compact state. | Requires native semantics and tests for old writers/data; eventually retiring deletion knowledge still needs a policy. |
| Epoch / minimum-generation rejoin boundary | Allows old deletion knowledge to be discarded after a defined cutover. | Must actually reject stale publication and deliberately reconcile/reseed unpublished work. No such fleet protocol is established here. |

**Do not choose a tombstone TTL until stale-host policy exists.** “We normally sync weekly” is an observation, not a guarantee that an old laptop or restored backup will never return. If rejoin is unbounded, current APIs cannot promise both permanent forgetting and prevention of resurrection.

## 9. Decisions worth making before implementation

1. **What should remain answerable?** Final intent/outcome and source evidence only? Full diagnostic timeline? Exact old workflow preview? Local audit events? Define required retrieval, not merely which fields survive.
2. **Where may history live?** Always online in Beads, retrievable from a shared archive, or intentionally discarded for selected diagnostics? A machine-local path is not a cross-host archive.
3. **Which stale-host guarantee do we want?** Accepting arbitrarily old clone state without resurrection requires retained deletion knowledge; bounded rejoin permits stronger garbage collection but needs enforcement.
4. **Who may retire records?** My initial preference is explicit, coordinated maintenance—not automatic cleanup triggered by every close. Busy Bee/Colony/response owners establish eligibility; native Beads applies storage semantics; Beeswax handles existing transport.
5. **What grace period and exceptions?** Select these after the above. Do not bake in seven/thirty/ninety days simply because a CLI accepts a number.

**Suggested sequence**

First reduce duplicated briefs and unnecessary telemetry. Measure new bytes/events per run. Next define archival retrieval and inventory bounded candidate families without deleting them. Then choose between coordinated existing-API retirement and narrowly scoped native compaction enhancements. Keep native merge-performance work separate but parallel.

### Acceptance evidence for a future implementation

- Dry-run manifests quantify eligible bytes and records without changing excluded work.
- Retained task, response, correction, acknowledgment and workflow readers still return the same authoritative outcomes.
- Archive retrieval succeeds by stable ID from another machine; DB-only audit requirements are explicitly covered or deliberately waived.
- Two independent pruners, concurrent late edits/comments, a stale clone, a fresh clone and restored old backups have defined, tested outcomes.
- Interrupted application/publication is inspectable and resumable without silent loss or forced conflict winners.
- Benchmark representative isolated snapshots: JSONL bytes, logical table counts, native merge time/RSS, disk and archive growth. No production speedup claim from a small synthetic fixture.

## Evidence, reproducibility and boundaries

**Prior investigation:** `hv-kog6al`, native API response `hv-35zcfq`, and its caller measurement addendum. Prior durable report: `/Users/ct/.local/state/hive/investigations/beads-sync-performance-20261022/report.html:1`.

**Specialist consultations:** native semantics response `hv-6ibc5z` (request `hv-cgmy0d`); architectural response `hv-keu7td` (request `hv-ofdj6a`), evidence thread `hv-hiykqo`. Final architectural review `hv-m745n4` reconciled the runtime results in that same evidence thread; prose review `hv-vp3od5` checked clarity and evidence boundaries. Both architectural corrections are incorporated: checkpoint “not closed” is not “open,” and current native briefs remain distinct from frozen checkpoint instructions. The caller independently performed the runtime experiments reported here.

**Current evidence bundle:** `/Users/ct/.local/state/hive/investigations/beads-retention-policy-20261022/versions.json:1`, `/Users/ct/.local/state/hive/investigations/beads-retention-policy-20261022/composition.json:1`, `/Users/ct/.local/state/hive/investigations/beads-retention-policy-20261022/compression.json:1`, `/Users/ct/.local/state/hive/investigations/beads-retention-policy-20261022/native-results.json:1`, `/Users/ct/.local/state/hive/investigations/beads-retention-policy-20261022/driver-results.json:1`, `/Users/ct/.local/state/hive/investigations/beads-retention-policy-20261022/api-results.json:1`. Companion scripts and native command transcripts are retained in the same directory.

**Experiment commands:** native merges used explicit synthetic trackers and `br --db … --no-auto-import --no-auto-flush sync --merge --base … --from … --json`; the driver used `beeswax system git merge ANCESTOR CURRENT OTHER`. All native experiment paths resolved beneath a throwaway directory, with inherited tracker overrides stripped. These merge/API probes used synthetic trackers, not a copy of the live database; the earlier performance investigation used a disposable copy. Direct SQLite access in the current probes was read-only inspection of synthetic results.

**Fixture limitations:** the experiments exercised public merge boundaries, not a full Git-network publication or simultaneous multi-process stress test. They did not implement an archive, simulate all policy gates, or benchmark retention performance. Synthetic imports establish otherwise-unavailable comment-removal states solely to observe reconciliation. An initial test-harness attempt hit macOS `/tmp` path canonicalization; rerunning with resolved paths exercised the intended native behavior. Expected conflicts returned native `CONFIG_ERROR` / exit 7 with explicit conflict types. An early cascade assumption was disproved and corrected using the native query and final runtime probes.

**Versions:** native source matched the installed full commit above. Hive source inspected at `3828a18476bf9fa6f1c78576c650b993669134fe`; installed standalone Beeswax reported 0.9.1. Its release-metadata lookup failed a version match, so its installed source revision is not asserted; executable SHA-256 and observed behavior are recorded instead.

**Scope discipline:** no repository code/config edits, live pruning, database repair, tracker exchange, application commits or pushes. Only research workflow/response/evidence bookkeeping was added locally. No full code suite was run because no application code changed. These findings establish policy constraints and options, not implementation completion or a demonstrated performance fix.
