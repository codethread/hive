# Busy Bee content ownership: one workflow system description

**Mode:** design — investigation and proposal only.  
**Report run:** hv-4xwxog; **report work:** hv-v89ttm; **request:** hv-y0jkkh.  
**Decision-maker:** ct. This report recommends a design; it does not adopt workshop policy, authorize implementation, or change examined work.

## Verdict

**Yes: one JSON description on the workflow system bead is sufficient for Busy Bee-owned persistence.** Original worker results, checkpoint state/history, lock ownership and settlement intent can live there. Workflow run beads and workflow auto beads can retain ordinary briefs, native acceptance criteria, durable prose notes and readable closure reasons. Workflow manual beads remain ordinary work and must not be enrolled in the engine merely because they are descendants.

**But this is not entirely a field relocation.** Today Busy Bee publishes structured execution disposition in the same native operation as task closure. Colony and Hive UI interpret that native `close_reason` independently of the checkpoint. Removing that JSON necessarily changes this established contract: native closure and workflow disposition evidence will occupy different records, with a possible interrupted-publication interval. The consumed Beads interface supplies no atomic cross-record close-and-checkpoint transaction.

I recommend the all-JSON target **with explicit approval of a joined evidence contract**: native Beads remains authoritative for whether work is closed; a confirmed record in the workflow system description explains that particular closure as succeeded, failed or cancelled. Neither a saved result, chart `done`, a prepared closure intent nor an outcome label proves native completion. Missing or inconsistent evidence must remain visible, never inferred success.

If ct requires both **all machine content in the system description** and **the existing single-native-operation disposition guarantee**, those requirements are incompatible with the inspected interface. The choices are to accept the explicit publication gap, retain a narrowly declared structured-close-reason exception, or separately authorize native transactional support. Do not disguise any of these as a storage-only refactor.

## 1. Evidence, authority and limits

Canonical implementation inspected read-only at `/Users/ct/dev/projects/hive`, revision **020d38baddd4c82aefd70da9a7158b1c8ea55dcb**, matching the supplied earlier reference; its working tree was clean. The execution checkout is the older workshop revision **186da413144705420e3da42f66d19680d111bb77**, not the source of current implementation findings. There is no implementation candidate, task-source delivery or combined-candidate revision to approve in this design assignment.

Research inputs were the workshop's local notes and two HTML reports, not accepted implementation specifications:

- `.worktrees/codex--beads-policy-workshop/BEADS-POLICY-NOTES.md:5` — latest ordinary-work direction and bounded authorization.
- `.worktrees/codex--beads-policy-workshop/BEADS-AUTOMATION-WRITES.html:1` — earlier write inventory at the same canonical revision.
- `.worktrees/codex--beads-policy-workshop/BEADS-GRAPH-PERFORMANCE.html:1` — disposable graph/hydration measurements and limits.

Relevant prior delivered research was retrieved as complete native responses:

- **hv-hb71ub**, producing run hv-9bmglb/request hv-mvh39c: durable pre-close handoff and original JSON have recorded rationale; no original human decision selecting notes over another result location was established.
- **hv-8focnc**, producing run hv-rjo2z4/request hv-xtw066: the separate machine checkpoint and conditional-update lock have recorded rationale; the notes-versus-description split was an implementation choice without a discovered alternatives analysis.

These reports support preserving the guarantees, not treating the existing field names as indispensable. Their bounded historical searches are not exhaustive proof about original intent.

**Accepted task intent:** ordinary descriptions contain briefs; acceptance belongs in its native field; notes are available for consolidated conclusions/rationale; a separately linked diary may hold working history; design is set aside. System content is intended to occupy one JSON description. Native title/status/labels/relationships remain valid. Generated work is not thereby system work. Final policy and rollout decisions remain ct's.

**Current governing contracts:** `docs/PHILOSOPHY.md:1`, `docs/architecture.md:1`, `GLOSSARY.md:73`, `lib/busybee/SPEC.md:1`, `docs/agents/spawn-requests.md:1` and `docs/agents/responses.md:1`. These distinguish XState progression, native work authority, managed execution and authored responses. The current architecture explicitly gives structured native closure authority; the proposal below revises that point openly.

Verification was source tracing, consumer searches, inspection of existing tests and prior reports. No production experiment, new workflow, implementation, migration, pruning, tracker sync, commit or full test suite was performed. One agent performed the investigation. No claim is made that the proposed protocol has been implemented or runtime-validated.

## 2. Complete affected write/consumer inventory

This inventory covers Busy Bee's production native-content writes, its delegated request publication, and the inspected bundled/default definition path. Trusted author code and arbitrary agent commands can perform additional effects; they are not implicit Busy Bee-owned storage.

| Current producer and content | Current home and consumers | Proposed treatment |
| --- | --- | --- |
| `createRun`: definition-authored title/brief | Ordinary workflow run description. Read by agents, Bee driver instructions and UI native detail. | Keep a readable brief. Add separately projected acceptance; do not hide the work in system JSON. |
| `entryCreation` / `taskDescription`: rendered work plus delivery, completion and discovery instructions | Workflow auto bead descriptions, including grouping beads. Frozen author instructions also live in checkpoint `active.meta`; dispatch copies a composed brief into the Bee prompt. | Keep ordinary task-specific prose and concise operational pointers. These are agent instructions, not engine-state storage. Native acceptance must be separate. |
| Default `do-work` acceptance checklist | Embedded in `meta.instructions`, hence description; neither `briefSchema`, `resolvedTaskSchema` nor Busy Bee `CreateTask` currently carries acceptance. | Introduce explicit acceptance through definition → frozen visit → native create. Do not regex-extract checklists or keep two editable copies. |
| Initialization, progression, result-save bookkeeping, driver handoff and managed-exposure stamping | Workflow system description: format, definition locator/version/hash, snapshot, active/frozen visits/context, generated identities, visit counters, accepted history and managed exposure. Runtime, preview, simulation, preflight, Colony provenance and UI identity readers consume portions. | Keep in the same JSON document. Preserve the coherent prior checkpoint when stamping exposure before managed effects. |
| `acquire`, `owned`, `updateOwned`, release | Workflow system **notes** contain `{owner,pid}`, then empty string. Runtime owns writes; Colony publication/admission/clearance and Busy Bee preflight read it. | Move to a typed lock member in the description. All writers preserve it until conditional owner-checked release. |
| `saveResultNotes` | Workflow auto bead **notes**, entire original `{choice,data}` JSON. `savedSubmission`, collection and completion retry read it. Existing nonempty prose conflicts; appended prose breaks parsing. | Move to a result entry indexed by exact native visit ID in the system description. Leave ordinary notes untouched. |
| `prepare` accepted submissions | System `history` stores bead, command, **validated/transformed** data and original dispatch request. | Retain accepted ordering and consumed data, but also retain the original outcome independently. Existing history alone is insufficient for original-input retry comparison. |
| `publishSettlement` | Appends `Busy Bee settlement:` plus intent JSON to **run notes**, then restores previous notes on success. Runtime and Colony admission parse it; partial failure retains it. | Move intent and bounded publication evidence to the system document. Do not restore or overwrite user notes as cleanup. |
| `closeObservedTask` / `closeTask`, called by completion, departed-group closure, final-run closure and settlement | JSON `close_reason` on ordinary run/visit/group, atomically with native closure. Shared decodes; Busy Bee verifies; Colony completion/claims/launch/reconciliation and UI outcome banner consume it. | Largest contract change: readable native reason plus separately confirmed system closure evidence. Update all readers together; no successful outcome inferred from a prepared record. |
| Outcome publication | `workflow-outcome:*` labels, after native closure and separately guarded by revision. Busy Bee collection, UI warnings and queries consume them. | Keep as a derived index of confirmed joined evidence, never outcome authority. Preserve unrelated labels and explicit projection failures. |
| Native identity and structure | Run/auto bead titles, status, owner/assignee; run → ordinary parent and run → system `related` link; generated parentage. Driver preparation clears its admitted unassigned run to `open`; Colony later claims. | Keep native authority. These are not prose payloads to relocate. Keep system classification only on the system bead. |
| `spawnBee` via `bee system dispatch-stage` | Bee captures the prompt, recipe, assignment and host in a separate **spawn bead** JSON description, with native task links. Busy Bee retains the published request ID. | Keep this cross-product interface. Busy Bee's one document does not absorb Colony-owned requests, attempts or process artifacts. |
| Design/comments/other ordinary content | No direct Busy Bee production writer of design, ordinary comments, prerequisites or agent-context content found. Guidance tells agents where to put narrative; response publication is separately owned by Bee. | No runtime payload to migrate here. Later approved agent guidance must release notes for prose without moving full response bodies into the checkpoint. |

Writer references:

- `lib/busybee/src/runtime.ts:392` — locked result persistence and checkpoint bookkeeping.
- `lib/busybee/src/runtime.ts:496` — run/system creation and nonblocking relationship.
- `lib/busybee/src/runtime.ts:721` — lock acquisition; `:769` ownership verification; `:831` publication failure boundary.
- `lib/busybee/src/runtime.ts:944` — original-result validation/retry; `:1022` conditional task-notes write; `:1223` whole-notes decode.
- `lib/busybee/src/runtime.ts:1082` — accepted transformed history; `:1453` checkpoint/final-run publication; `:1484` group closure.
- `lib/busybee/src/runtime.ts:1559` — visit and dispatch creation; `:1592` title/description/native placement; `:1636` generated operational prose; `:1723` managed exposure.
- `lib/busybee/src/settlement.ts:331` — run-note intent, bottom-up closure and cleanup.
- `lib/busybee/src/native.ts:116` — Busy Bee create shape; `:237` creation; `:250` closure/retry; `:271` native close; `:291` derived labels; `:335` CAS adapter call.
- `lib/busybee/src/definition.ts:16` and `.workflows/do-work/workflow.ts:22` — missing acceptance carrier and checklist-in-instructions source.
- `lib/colony/src/producer.ts:160` and `lib/busybee/src/runtime.ts:1666` — delegated request publication.

Additional consumers that a result-notes-only patch would miss:

- `lib/shared/src/workflow-lifecycle.ts:29` — closure schema; `:100` native decoder; `:124` settlement marker; `:138` labels; `:158` exposure header.
- `lib/colony/src/workflow-anchor.ts:25` — request-anchor completion mapping; `:51` pending child under terminal run check; `:73` admission; `:85` lock/exposure read.
- `lib/colony/src/claims.ts:14`, `lib/colony/src/launch.ts:485`, `lib/colony/src/launch.ts:509`, `lib/colony/src/dispatch.ts:246`, `lib/colony/src/request.ts:673` — terminal-anchor checks across claim, eligibility, final launch fencing, dispatch and reconciliation. Updating only one helper call signature without its pure eligibility/claim callers is insufficient.
- `lib/colony/src/producer.ts:173`, `lib/colony/src/workflow-submission.ts:90`, `lib/colony/src/execution-clearance.ts:62` — request creation, attachment and fresh clearance.
- `lib/busybee/src/preflight.ts:271` and `:323` — checkpoint scan and retained-lock diagnostics.
- `lib/hive-ui/server/data.ts:48` and `:483` — UI directly parses `id` and `created[].bead` from system descriptions, reusing identities by `updated_at`. This is a real consumer despite being a local minimal schema today.
- `lib/hive-ui/server/api.ts:142` and `lib/hive-ui/contracts.ts:386` — native outcome read independent of diagrams, and its consumed schema.
- `lib/busybee/src/preview.ts:9`, `lib/shared/src/workflow-preview.ts:6`, `lib/busybee/src/simulation.ts:37` — public checkpoint stamp, inspection and stateless replay freshness.

Bee's immutable response store, spawn observations/acknowledgments and Colony private persistence are adjacent systems, not Busy Bee content writes. Their wider system-description migration is separate work; this proposal does not silently relocate them.

## 3. What the current paths actually guarantee

### Creation, identity and repeated work

The engine validates an existing nonclosed, non-system parent before creating a run. It creates a separate related system bead and publishes only the current frontier. Initial publication is not a transaction: failures can leave confirmed or uncertain run/checkpoint/link/task/request effects. Reported IDs must survive recovery.

A visit is a native bead identity, not merely an XState node. Parallel untouched work retains its bead and frozen metadata; an accepted result retires its visit even if a loop returns to the same node. Child actors also need actor path identity. A new result index must therefore use **bead ID**, checked against generated inventory and run membership—not node name, title, actor path alone, assignee or request ID. A replacement Bee request still works the same visit.

The UI already uses checkpoint provenance rather than the `busybee-workflow` label or native ancestry alone to distinguish generated work. Preserve that distinction. Manual descendants remain outside generated inventory; settlement refuses unfinished manual work.

### Save, complete, collect and direct outcomes

`record-result` and the save phase of `complete` **already acquire the per-run checkpoint lock**. Saving a result is not an unsynchronized parallel write that would newly require workflow-level serialization. Today the result write also has a task `updated_at` CAS; a successful save is followed by a checkpoint write and conditional lock release.

`complete` then reacquires ownership in a separate short close phase, checks retirement and attempts ordinary native closure. A closure refusal preserves the result and releases that close-phase lock. Result persistence, closure, outcome labels and progression are separate effects.

The saved envelope preserves original JSON, including arrays/scalars and keys named `choice`. Validation may transform it; accepted history stores the transformed result. Collection must parse the original at consumption, not feed transformed history back through the input schema. Equality retries compare original values structurally, not serialized object-key order. Identical completion can acknowledge a collected successful visit; different or malformed evidence must fail rather than replace it.

Collection validates closed results in stable frontier order before publishing progression. Completed work can be consumed despite an unsuccessful execution request; an unfinished dispatched visit with a terminal request and no pending replacement fails visibly. Supersession follows the request lineage and checks that it still names this run/visit.

**Important edge, verified in code rather than inferred from the high-level wording:** current direct `next`/`choice` does not read saved notes, and current collection/direct validation does not reject every unclassified native closure. `assertSuccessfulVisit` rejects a *classified* failed/cancelled closure; an unmarked closed task with valid result and current labels can advance. The existing array-result test closes with ordinary native `close`, then collects successfully. Colony, by contrast, refuses an unclassified anchor as execution success. Preserve this distinction or explicitly change it; do not accidentally impose “all closure must go through complete” while presenting the change as storage-only. References: `lib/busybee/src/runtime.ts:1208`, `:1243`, `:1273`; `lib/busybee/tests/integration/driver.test.ts:432`; `lib/colony/src/workflow-anchor.ts:35`.

### Closure, retirement and admission

The current structured native close reason provides a single-record closure/disposition fact. Outcome labels are a later projection and may lag. A review outcome of `changes` can still be successful execution. A later cancelled run must not change successful descendant facts or the successful worker requests anchored to them.

Settlement reads saved inventory without importing the definition, checks full native ancestry and reservations, and closes pending generated work bottom-up. It preserves completed work and does not manufacture author outcomes or change the saved chart to `done`.

Explicit unmanaged provenance, complete inventory and no contradictory requests allow daemon-free settlement. Managed/unknown exposure needs fresh owning-host Colony clearance. The existing checkpoint lock fences final launch admission; run-note intent fences publication/retirement. Clearance is observed under Colony's admission gate, not a process-stop operation or distributed lease. Failed/uncertain settlement retains ownership, intent and effect evidence for explicit recovery.

One subtle publication requirement must survive: initial Bee-dispatched request creation occurs while Busy Bee holds the checkpoint lock and **before the new frontier is saved**. Current submission uses native ancestry at that point; stage-request creation permits that publication lock, whereas driver publication/final execution admission has stricter fencing. A blanket “reject all locked checkpoint reads” or “require every new request target already in saved created[]” would break initial dispatch. References: `lib/colony/src/workflow-submission.ts:205`, `lib/colony/src/producer.ts:173`, `lib/colony/src/launch.ts:509`.

## 4. Recommended ownership and representation

### One versioned document, one Busy Bee writer owner

Use a new explicit engine format. Retain a single workflow system bead, discovered by the existing native related link and system/checkpoint labels. Its description contains:

| Member | Responsibility |
| --- | --- |
| Identity, format, definition locator/hash/version | Existing provenance and restoration rules. |
| Snapshot, active visits, visit counters | Existing engine-private progression state and frozen work contracts. |
| Generated inventory | Exact native bead IDs, parent/path/node/visit/request provenance; record visit/group scope explicitly for new entries. |
| `results[beadId]` | Original `{choice,data}`, recorded attribution/time if needed, and linkage to accepted history. Never replace it with transformed output. |
| Accepted history | Ordered accepted events with transformed/consumed data and original result reference. No second editable result authority. |
| Lock | Invocation UUID and diagnostic PID, or explicit unlocked state. |
| Managed exposure | Monotonic unmanaged → managed provenance; unknown is never unmanaged proof. |
| Settlement | Explicit absent or active intent, owner, reason, inspected inventory/revisions and retained partial-publication evidence. |
| Closures | Per-native-bead prepared/confirmed evidence, scoped to this run and the exact native closure. Confirmed entries retain outcome, readable reason and observed `closed_at`. |

This is a proposal for a small domain document, not a new general event store. Do not copy task notes, full responses, diary contents, Colony attempts or logs into it. Keep original and transformed result representations only because they serve different demonstrated contracts. Pending saved results from later-cancelled work are retained as **unconsumed**, not converted into successful history.

### Keep native work authoritative

- Description: current ordinary work brief, not a machine envelope.
- Acceptance: native `acceptance_criteria`, independently editable and verified by the worker.
- Notes: durable prose conclusions/rationale under the approved policy; Busy Bee never parses or overwrites it for outcomes.
- Design: no new use.
- Comments/optional diary: authored progress/history, not workflow transport.
- Close reason: readable explanation, not JSON, encoded tags or a string grammar secretly used as outcome authority.
- Native status, assignment, owner, parentage and labels: retain their current roles. A result cannot close a task; a system ledger cannot make an open task complete.

Frozen acceptance in checkpoint metadata is publication provenance, not an independently authoritative checklist. Native edits remain authoritative for actual acceptance and closure. The same distinction already applies to frozen instructions versus the current native brief.

### Shared interfaces, not shared engine internals

Busy Bee owns mutation, statechart restoration, projection and serialization. Shared should own only consumed schemas and small typed reads/decoders for **workflow identity, publication control and joined closure evidence**, because Colony and UI genuinely need them. Keep snapshot/context/result internals out of those interfaces.

Use the injected Beads service for definition-free native reads, following the current Colony workflow-anchor pattern. Consumers must not import Busy Bee internals or invoke `show`/`discover` merely to decide completion; those restore/start actors and can execute author code. Keep the UI outcome route usable when definitions cannot load.

A focused public read should return the observed native status and either confirmed disposition, unclassified closure, publication pending, or explicit inconsistent/malformed evidence. It should include run/checkpoint identity and observation stamps, not raw engine context. Bracket a joined read with fresh checkpoint/native closure checks where a concurrent publication would otherwise yield mixed evidence; fail or report changed/pending rather than fabricate an atomic snapshot.

Move the UI's minimal `id`/`created` schema into the actual shared consumed identity contract when revising the format. Retain public Busy Bee preview/simulation commands and their allowlists. No Colony scheduling logic moves to Shared.

## 5. Proposed command and publication flow

### Lock discipline

Acquire by reading the current system description, verifying it is unlocked, setting its lock member and CAS-writing **the whole description** against native `updated_at`. After acquisition, read fresh state. Each subsequent owned write verifies the token and native revision; release patches only the lock in the fresh document. Never serialize an old `Run` object over a newer lock/result/settlement member.

Keep bounded contention waits, no automatic expiry or stealing, and the existing distinction between pre-publication failure and uncertain attempted publication. A PID remains diagnostic. All writers must share the selected live database; tracker exchange is not a distributed writer lock.

This does not add a new per-run serialization bottleneck in principle: it already exists. It does increase the bytes rewritten for acquisition/release and joins additional data to one record's retention boundary. Measure that cost rather than inventing an unverified concurrency problem.

### `record-result`

1. Acquire the existing run ownership; verify run/visit eligibility, reservations, saved membership, outcome schema and transition availability.
2. Save the original outcome in `results[beadId]` if absent; require equality if present. Save compatible definition bookkeeping in the same document write.
3. Release without closing or advancing. Return the same compact run/visit/choice receipt. An explicit exact-result read can expose the saved original for recovery; do not expand default run views with the ledger.

**Guard difference to acknowledge:** moving the write removes today's atomic CAS on the *task* that stores the result. A CAS on the system bead does not atomically verify a task revision. Re-read native eligibility around recording and again before closure; a detected change must stop consumption/closure and retain clear evidence. Under cooperating Busy Bee writers the run lock coordinates the machine state, while native acceptance/reservation checks still govern work. If exact atomic task-revision-and-result persistence is required, it needs native cross-record support, not a purported equivalent two-read check. Saving an unconsumed result is never proof the task remained eligible or completed.

### `complete`

1. Persist/match the original outcome, then release result-save ownership as today.
2. Reacquire a short close owner; check native reservations, current run/settlement state and the exact visit's original result.
3. Persist a **prepared closure** entry; then call ordinary native close with a readable reason. No force-close, no acceptance ticking by the engine.
4. On confirmed native closure, reread it and persist **confirmed closure evidence** bound to bead/run/scope and `closed_at`, retaining the reason used/observed. Then publish derived outcome labels.
5. Release and return success only after the required evidence/index publication is confirmed. Do not advance.

A known native refusal leaves the original result available and the task open; clear only the conclusively unperformed closure intent and release so the same original completion can be retried after repairs. A matching confirmed closure can be acknowledged, including after collection, without rerunning progression. A label-only failure after confirmed evidence is inspectable and repairable without replacing the outcome.

If native close may have happened but the confirming system write failed, **do not assume a prepared intent proves success**. Retain ownership and prepared/partial evidence, return confirmed/uncertain IDs, and require explicit inspection/recovery. This is a real additional failure interval compared with the current single-record native lifecycle fact. It must be documented and tested, not hidden by automatically unlocking or replaying uncertain closure.

The evidence join must reject changed/reopened native closures, mismatched scope/run or contradictory receipts. Compare closure identity, not the task's entire `updated_at`, because later legitimate notes and label updates should not invalidate a completed outcome. Arbitrary edits/old writers/concurrent tracker exchange remain outside the coordinated guarantees; a reason comparison is an integrity check, not a machine grammar for prose.

### `collect`, direct `next`/`choice`, parallel work and loops

Collection reads closed active visits' original results from the system document, validates the complete selected batch, advances in current stable order and publishes the accepted history/new snapshot/frontier under the same owner. Result entries are not deleted on collection: identical completion retries and historical explanations still need them.

Direct submissions remain limited to active closed driver-handled visits, use caller-supplied original data, and never bypass native closure. Persist that original as part of accepting the direct submission; a different previously saved original should fail explicitly rather than create two competing results. **That conflict check is a proposed tightening**: current direct submission bypasses saved notes. State it in adoption guidance, rather than claiming it is unchanged behavior.

Retain the current allowance for an unclassified ordinary closed visit to supply an authored navigation outcome, unless ct deliberately removes it. Record the provenance as externally/unclassified closed; do not invent a successful execution receipt. Colony still must not map that absence to successful request completion. Classified failed/cancelled visits never advance. This preserves ordinary native closure without silently redefining managed execution success.

A loop allocates a fresh bead/result entry; parallel untouched visits keep their original identities and frozen metadata. A repeated collection after successful publication cannot reaccept an old result because it is no longer active. Partial task/request effects still require inspection rather than blind replay.

### Successful containers and unsuccessful settlement

Use the same prepared → native close → confirmed evidence mechanism for departed groups and the final run. Preserve bottom-up closure and reject new children under closed native parents. Publish chart state as before; `done` still cannot substitute for failed/refused native run closure.

For settlement, hold ownership from inventory inspection through fresh clearance and publication. Persist settlement intent in the same system document before closing pending generated scope. Colony publication/admission must read this new location; ownership must remain visible to the admission gate before clearance. Keep the stage-publication exception described above without permitting publication through settlement intent.

Keep complete ancestry/request agreement, human/HITL/other-agent reservations, unmanaged proof requirements, owning-host/process verification and the ban on automatic replay. Confirm and retain each known closure; preserve earlier successful visits/results and the saved chart. Clear settlement intent only after all required native closures and evidence/index writes are confirmed. Partial failure retains intent, owner and diagnostic effect IDs. Native run notes are never involved.

### Inspection and simulation

`show` remains compact; `show --instructions` continues to expose frozen text. Discovery keeps outcome schemas. Preview and simulation read the new document but expose neither result ledgers nor locks/raw context by default. Preflight must inspect the new lock member, not empty notes.

Keep `savedAt` as the system bead's native update time, including bookkeeping. Lock/result/closure writes can invalidate simulation baselines and refresh UI identities without advancing the chart; that is already the timestamp's meaning, although payload size changes. Do not introduce a second progress clock unless measurements establish a concrete need.

## 6. Alternatives and trade-offs

| Alternative | Assessment |
| --- | --- |
| Move only result notes | Useful but incomplete: lock notes, settlement run notes, lifecycle JSON, acceptance projection and consumers remain. Does not satisfy this assignment's full target. |
| Keep lifecycle JSON in native close reason, consolidate everything else | Smallest implementation and preserves atomic disposition evidence and checkpoint-independent terminal reads. A genuine policy exception, not the all-JSON answer. |
| One system document with explicit confirmed evidence | Recommended if ct accepts the changed outcome-publication contract. Frees ordinary content fields and keeps existing ownership structure; introduces a visible closure/evidence gap and stronger checkpoint retention dependency. |
| Make outcome labels authoritative | Reject. Labels are separately written query projections; doing so silently changes native completion semantics and keeps another machine authority outside the document. |
| Parse a special readable close-reason phrase | Reject as a hidden machine-content convention. Changing JSON syntax does not remove the contract. |
| Separate result beads or per-visit system beads | Adds identities, links, discovery/retention work and diverges from the requested one-document target. No measured need justifies it here. |
| Put results in Colony's private store | Reject. Driver-handled/unmanaged Busy Bee must not depend on a Colony outbox; the prior research supports this separation. |
| Native multi-record transaction | Could preserve stronger atomicity but is a separate backend capability/change, not available through the inspected service and not justified as a prerequisite without ct selecting that guarantee. |

One document simplifies ownership, not total storage size. Existing snapshots/context, frozen briefs, dispatch prompts and accepted history already duplicate some content. Retaining originals adds data to the checkpoint while removing it from task notes. Whole-record export/write behavior and the UI's checkpoint-description hydration can make a large document expensive. The earlier graph report measured graph-versus-body hydration, **not** this proposed lock-write workload; its timings cannot establish acceptable ledger size or concurrency throughput.

Retention is more coupled: currently structured native outcomes remain interpretable if the system bead is missing; the proposed classification cannot. Do not purge a workflow system bead while supported retry, collection, request reconciliation, workflow provenance or outcome inspection still depends on it. Preserve authored response/durable conclusions separately before any independently authorized family retirement. A diary may have its own retention boundary; original workflow result evidence is not automatically disposable diary history.

## 7. Ownership and implementation boundaries after approval

1. **Busy Bee owner:** new checkpoint format and owned-document updates; result ledger; closure publication; settlement; definition acceptance carriers; compact exact-result inspection; preflight and preview/simulation adaptation. Keep process/native effects injected through the existing services.
2. **Shared owner:** versioned consumed identity/control/evidence schemas and joined decoding/read contract, with explicit pending/unclassified/inconsistent semantics. No scheduler or XState internals.
3. **Colony owner:** change workflow-anchor reads and all claim/eligibility/publication/admission/clearance/reconciliation callers. Keep request-specific outcomes, host authority, process checks and private attempt records in Colony. Do not copy the workflow ledger into the daemon store as another authority.
4. **Hive UI owner:** adopt the shared identity/evidence contract, update outcome wire schema/banner and freshness joins; retain definition-independent outcome inspection and read-only behavior.
5. **Definition authors:** add explicit run/visit/group acceptance as appropriate and project through the existing Beads `acceptanceCriteria` support. `lib/beads/src/service.ts:148` and `lib/beads/src/native.ts:361` already carry the native field; Busy Bee's narrower shape is the missing seam. Workers verify/tick native criteria; the engine must not auto-satisfy them just because a result validates. Draft-first and system/group gate requirements are separate workshop policy to resolve, not silently bypass.
6. **Bookworm, only after ct settles intent:** encode the decision in `docs/architecture.md:1`, `lib/busybee/SPEC.md:1`, `docs/agents/responses.md:1`, `docs/agents/spawn-requests.md:1`, Busy Bee/Colony/UI guides, bundled execution/authoring guidance and CLI help. Remove notes-as-result instructions everywhere they are composed. Keep glossary provenance terms unchanged. No documentation edits or extra delegation are authorized by this report.

Keep the work bounded to these seams. Do not turn it into a scheduler replacement, generalized persistence platform, diary implementation, automatic compactor, response redesign or broad workflow rewrite.

## 8. Reserved decisions and rollout

**ct must decide:**

1. Is the explicit joined native-closure/system-disposition contract acceptable, including a possible closed-but-unconfirmed interval and loss of checkpoint-independent classification? If not, select the close-reason exception or separately authorized native capability work.
2. What retention promise applies to the system document and original results after run retirement and Colony reconciliation? No duration or purge procedure is established here.
3. How do the workshop's acceptance/draft/close-reason rules apply to generated runs/groups and system records? Ordinary work must not evade those gates by being relabelled system.

The task owner can then implement the ordinary seam choices described above under a newly authorized task. The report itself is complete without choosing policy for ct.

Use an explicit new checkpoint format and coordinated Busy Bee/Shared/Colony/UI release; do not add automatic legacy fallback, dual writes or saved-snapshot migration by default. Old tools reading empty system notes would incorrectly see an unlocked workflow; therefore mixed-version writers are unsafe. Catalogue SemVer is separate from engine format. Update definitions and release/adoption notes accordingly.

Before rollout, deliberately account for unfinished and terminal retained runs, pending requests, installed daemon versions and UI readers. Prefer draining old live runs with matching old tools before switching; incompatible saved runs retain evidence and need an explicit continuation/disposition plan. Do not let “start a fresh run” duplicate completed or uncertain effects, erase old outcomes, or implicitly close the old run. An operator-approved archival/read strategy may be needed for old terminal data; this report authorizes neither conversion nor deletion and does not propose a compatibility shim as the default solution.

## 9. Focused future validation

These are acceptance scenarios for future implementation, not tests run in this report. Use existing injected memory Beads and promise barriers for workflow behavior; small native disposable tests should verify field projection and actual closure/CAS semantics. Do not resurrect removed slow lifecycle cohorts indiscriminately.

1. **Field ownership:** create run, driver-handled visit, dispatched visit and group; assert ordinary prose descriptions, dedicated native acceptance, untouched notes/design/comments, readable reasons and no machine content outside system description. Manual descendants remain manual.
2. **Original data:** object key reorder, arrays/scalars, a payload's own `choice`, schema transforms and conflicting/malformed results. Confirm collection validates original once for consumption and completion retries use the original after collection.
3. **Interruption ordering:** before/after result CAS, release, native refusal, native close, confirmation write, label write and progression save. Verify known/uncertain effect IDs, no premature success, preserved results and documented release-versus-retain behavior.
4. **Native guards:** acceptance refusal, unfinished children, HITL/human/other-agent reservations, task edits around result saving, reopened/changed native closure and missing checkpoint. System evidence never closes work or bypasses native gates.
5. **Concurrency:** two independent result submissions and collector under the existing run lock; conditional acquisition/release conflict; stale whole-document write; update while another owner holds the lock. No dropped result, lost fence or accidental unlock. Measure bytes/latency for large histories rather than assume a new logical race.
6. **Identity/progression:** parallel untouched tasks, loop revisit at the same node, nested actors with matching node names, duplicate collection, closed parent and partial initial publication. Index by native visit identity and preserve frozen contracts.
7. **Direct submissions:** unclassified ordinary native closure plus valid driver result remains navigable if retained policy says so; dispatched direct submission fails; classified failed/cancelled closure fails; contradictory previously saved original fails under the proposed tightening. Colony never treats an unclassified anchor as successful execution.
8. **Settlement:** unmanaged without daemon; managed/unknown with owning-host clearance; missing/foreign/live/unverified attempts; unfinished manual descendants; changed ancestry/inventory; partial bottom-up closure; intent cleanup failure. Previously successful descendants and request outcomes remain unchanged.
9. **Admission race:** pause settlement around clearance, intent persistence and each close; attempt request creation and final launch. Prove no launch crosses the fence, while legitimate initial stage publication under Busy Bee ownership still works before frontier persistence.
10. **Consumers:** driver versus worker anchors, successful review choosing changes, later run cancellation, replacement request lineage, completion without launch, post-finish reconciliation and label-repair diagnostics. Exercise public command/consumer contracts, not only storage helpers.
11. **Inspection:** UI identity map and native outcome with missing/incompatible definition; lock-aware preflight; compact show; exact original-result read; preview exclusions; frozen/native acceptance distinction; simulation staleness after bookkeeping writes. No inspection path advances work.
12. **Rollout/retention:** unsupported format fails loudly, old writer cannot be admitted as safely coordinated, missing/ambiguous system relationship is explicit, and approved retention never removes evidence still required by execution or supported reads.

Existing relevant test evidence inspected includes `lib/busybee/tests/integration/completion.test.ts:17` (transforming input), `:69` (publication barriers), `:101` (equivalent original retry), and `lib/busybee/tests/integration/driver.test.ts:402` (conflicts/closed writes). Those are useful starting points, not proof of this proposed design.

## Handoff

**Recommendation to ct:** approve one workflow system JSON document for Busy Bee-owned content, with the explicit joined-evidence trade-off above; otherwise retain structured native closure as a declared exception. Result/lock/settlement placement alone has no demonstrated semantic necessity tying it to notes.

**To the task owner:** retain this full report as workshop evidence. Do not implement, migrate, prune, modify the parent workshop or treat the proposal as adopted policy. The next action is ct's decision on lifecycle evidence and retention, followed by separately authorized scoped work. The current report uses the existing Busy Bee notes/closure protocol for its own completion, not the proposed one.
