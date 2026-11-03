# Beads work, automation and retirement: recommended breaking target

**Mode:** design. **Producing run:** hv-yaodxg. **Report visit:** hv-txtfy0. **Request:** hv-0ednz1. **Author:** chocolate-grand-sparrow.

## 1. Decision and authority

Recommend a clean-generation cutover to a small set of explicit contracts:

1. **Keep meaningful work, not execution scaffolding.** Ordinary work—including workflow-generated work—retains its current WHAT, native acceptance criteria, consolidated WHY/findings/evidence and unresolved caveats. Creation by automation never makes a work task disposable.
2. **Put automation content in versioned system-description JSON.** One workflow system document owns Busy Bee state, original results, ownership and settlement. Each spawn document owns its captured request and latest published operational facts. Native status, identity, labels and typed links retain their respective roles.
3. **Use one successful completion path:** authored response when required → `complete` → `collect`. Remove direct `next`/`choice` submission and public save-only `record-result`; keep recoverable original-result persistence inside completion. Neither native closure alone nor a saved result proves successful workflow execution.
4. **Accept an explicit closure/evidence publication gap.** Extend Hive's Beads adapter to consume native revision-guarded close; do not build a cross-record transaction engine for this redesign. Closed-but-unconfirmed is a visible, non-successful state requiring inspection. This recommendation deliberately revises the current atomic structured-close-reason contract.
5. **Introduce execution retirement as a separate, irreversible capability boundary.** After verified knowledge compaction, stopped execution and resolved operational obligations, exact execution records can be retired. Retired IDs cannot be retried, collected or resumed. Native unfinished work remains unfinished and retained.
6. **Reclaim storage by coordinated generation reconstruction, not independent clone pruning.** A frozen exact manifest, verified retained export, new database and new tracker transport generation provide the deletion boundary. Soft tombstones communicate intent; they are not physical compaction. Old-generation writers and snapshots cannot enter the new generation.
7. **Do not make active workflow families ephemeral.** Keep shared native work and execution facts until retirement; the tested readiness, graph and rebuild losses make ephemerality the wrong shortcut.

These are **concrete recommendations**, not claims that the target already exists. The supplied assignment authorizes resolving ordinary design choices and proposing aggressive breaks. It does not authorize implementing, pruning, changing policy, resetting a daemon or replacing the tracker. **ct is the adoption and destructive-cutover decision-maker.** The task owner can turn this report into bounded implementation work after that authorization. No further architectural choice is needed merely to proceed with a reviewable proposal.

### Accepted intent versus decisions made here

The supplied brief establishes description = current scope, dedicated AC, notes = consolidated durable account, optional diary history, unused design/prerequisites, native label stewardship, draft-first ordinary work and verified acceptance before successful closure. It also establishes system-description JSON, latest rather than cumulative Colony observations, eventual execution/report retirement and retained useful work. Reported native gates remain excluded.

This report selects the remaining mechanisms: artifact exemptions, relation direction, response retention unit, joined lifecycle evidence, removal of alternate completion paths, conservative retention defaults, explicit retirement reads, generation-based purge and coordinated tool adoption. The initial workshop's broader “all beads start draft and need AC” wording must change for non-executable artifacts/system state; §3 makes that exception explicit rather than silently bypassing it.

## 2. Verified sources and limits

Canonical implementation was read at **020d38baddd4c82aefd70da9a7158b1c8ea55dcb**, `/Users/ct/dev/projects/hive`; its working tree was clean when inspected. Workshop/execution checkout is **186da413144705420e3da42f66d19680d111bb77**. Native source is **b77ae7094e9fde7cba304ba00d306ec483c6bdd2**, `/Users/ct/dev/projects/beads_rust`. The older workshop checkout was not mistaken for canonical implementation.

The consultation request is the full native brief of hv-yaodxg and its active visit, read with ancestor scope. The newer, specific authorization permits this design despite the ancestor workshop's earlier no-autonomous-policy restriction. Ancestors were not changed. **There is no implementation candidate or combined-candidate revision to approve.** This is not an integration approval.

Prior full native reports read:

- **hv-j43n80:** one workflow-system document; original-versus-transformed result distinction; closure publication gap; actual direct submission behavior; all affected Busy Bee consumers. This report continues that successful work, not a retry or supersession of its execution.
- **hv-shvp84:** approximately 40-second native unchanged merge, whole-population witness costs, 80 MB-class exports; physical VACUUM did not improve merge timing.
- **hv-iy8u3v:** native comment union, tombstone payload retention, stale resurrection after deletion knowledge is lost, lack of semantic compaction, cascade direction and separate native/Git merge paths.
- **hv-07n1lr:** ephemeral readiness exclusion, missing remote child gates/links, JSONL rebuild loss and exact-family deletion experiments.

Workshop evidence reviewed includes `BEADS-POLICY-NOTES.md:1`, `BEADS-AUTOMATION-WRITES.html:493` and the graph/relationship/pruning findings recorded there. Before delivery, parent comments 44577/44582 supplied completed evidence, read at `BEADS-POLICY-ENFORCEMENT-EVIDENCE.md:1` and `BEADS-AUTOMATION-WRITE-EVIDENCE.md:1`. Those are the parent's disposable tests, not experiments performed by this report. The measured figures below are prior/supplied observations, not benchmarks of this target. The source revision and installed br 0.7.6 version are distinguished: the parent's version string alone does not prove binary/source equivalence.

**Important source correction:** native close already has `--if-unchanged`; Hive's consumed `close` interface and Busy Bee call do not expose/use it. The comment saying native close lacks a revision condition is stale. See `/Users/ct/dev/projects/beads_rust/src/cli/commands/close.rs:41`, `:111`, `:1548`; `lib/beads/src/service.ts:28`; `lib/busybee/src/native.ts:270`. A guarded single-record close still does **not** atomically save another bead's result/evidence. Also, native `status_revision` currently derives from DB-local event IDs (`/Users/ct/dev/projects/beads_rust/src/storage/sqlite.rs:4623`); it is not a portable closure identity to put in shared receipts.

No new production experiments, code edits, workshop edits, migration, pruning, synchronization, commits, pushes or delegation were performed. Verification is source tracing and reconciliation of supplied evidence. No implementation test suite was run. No final-diff specialist review is claimed; there is no code/doc diff, and this assignment expressly requires one-agent investigation.

## 3. Record taxonomy, fields and gates

The categories below are semantic classes, not proposed new native CLI type names. Use existing native types plus registered, stewarded classification labels initially. Unrecognized/contradictory classification fails closed for automation and **defaults to retain** for compaction. Labels assist selection; a label alone never authorizes deletion or proves completion.

| Class | Native description | AC / notes / comments | Lifecycle and retention owner |
| --- | --- | --- | --- |
| Ordinary task, bug, feature, epic; meaningful auto/manual work | Current problem, scope, intended outcome and context | Native AC; notes contain consolidated conclusions, rationale, proof and remaining work. Optional diary for detailed history. Design/prerequisites unused. | Task owner verifies semantics. Retain indefinitely by default, including closed generated tasks. |
| Workflow run / grouping bead | Readable coordination scope, not checkpoint JSON | Native AC appropriate to actual scope; ordinary notes. No fake worker outcome. | Busy Bee owns normal group/run closure. Eligible containers may retire only after their useful contents are promoted; a run with substantive unique work is retained. |
| Workflow system bead | Entire versioned JSON document | No prose notes, comments, design, AC or machine close-reason grammar | Busy Bee owns content and short invocation ownership. Retain until execution retirement. |
| Spawn bead | Entire versioned request JSON, including latest observations and resolution facts | No accumulated native observation/acknowledgment comments; no AC | Bee/Colony own their explicitly scoped members. Retain through request settlement and family retirement. |
| Immutable response artifact | Versioned JSON envelope containing the **complete Markdown body**, author and provenance | No task AC, notes or progress comments | Bee owns publication/corrections; task owner owns semantic consolidation. Preserve every required correction head and predecessor until verified compaction. |
| Development diary artifact | Short prose identifying purpose and retained work anchor(s) | Authored timestamped working-history comments; optional small navigation notes, not a second final account | Task owner; disposable only after every important fact has a retained destination. |
| Retained specialist evidence / merge reference | Existing owned representation, with substantive decisions/reference meaning preserved | Their existing stewardship applies | Respective specialist/provider-reference owner. Not automatically execution garbage. |
| Retirement receipt / generation manifest | Small system JSON: exact inventory, revisions/digests, retained destinations and state of the retirement operation | No narrative log or copied report bodies | Beeswax coordinates; product owners supply eligibility. Keep until the next safely superseding generation/archive boundary. |

**Gates:** ordinary work, including runs/groups and all generated work, starts `draft`; native AC must exist before leaving draft. The worker verifies meaningful criteria, ticks the native field and supplies a readable reason before successful close. Busy Bee carries `acceptanceCriteria` through definition → rendered visit → native create. Frozen AC is creation provenance, not another editable authority. Never extract checklists from description with a regex or maintain duplicate checklists.

System records are not executable work: create them directly in their valid control state (`open`, or terminal artifact state when appropriate) with schema validation, not meaningless AC. Responses are immutable non-executable artifacts, not system work or successfully completed tasks; publish them closed with a readable publication reason and complete payload. Diaries/reference artifacts similarly have an explicitly non-executable lifecycle. They do not enter `ready` or acquire work claims. A human owner may remain accountable without an assignee.

The policy selector must distinguish these classes at both **creation and transition/close**. A global AC gate scanning descriptions, notes and design is incompatible with this target. Use native dedicated-field, class-scoped rules. **The parent's completed probe confirms a native extension is required:** current `required_fields` and close-reason rules have no label/type selector; initial `entry_routes` do not exempt subsequent system closure from global AC requirements. Omitted create status remains open, so producers must explicitly create draft. A response entry route can currently create closed without AC or reason; that is a creation-path gap, not evidence of equivalent closure enforcement. Implement coherent record-class-scoped initial, transition and closure rules, including checks against reclassification used to evade work gates. Supported current required-field keys are exact transitions or target statuses, not an invented wildcard. Do not work around the gap with dummy checked AC, `--force`, reported gates, or classifying actual work as system. Do not exempt every `docs` issue: documentation tasks are executable work; a response artifact is not.

**Failure/cancellation is not acceptance.** Unfinished work keeps unchecked AC and an unfinished native status. Settlement must not tick it to close a run. A coordinator may close a container only if its genuine coordination criteria are met and native child gates pass. Otherwise it remains retained ordinary work, recording that its execution ended and what remains. Execution retirement may end its workflow capabilities without pretending the native task is complete. This deliberately removes the assumption that every unsuccessful execution must close every generated work bead.

## 4. Identity, relationships and retention ownership

Identity is `(tracker identity, generation, native bead ID)` for execution/artifact references. Retained work keeps its native ID across reconstruction, with explicit retained-ID mapping; new IDs must never reuse purged identities. Invocation UUID, spawn request ID, attempt ID, friendly identity and session remain distinct. Attempt number starts at one; retry count is not its alias.

Use currently supported native edge types, not custom `diary`/`mail` types or unreadable relationship metadata. Direction is source → target:

| Edge | Meaning / authority | Retention consequence |
| --- | --- | --- |
| Child work → parent work, `parent-child` | Scope and native completion/readiness consequences | Never a deletion graph. Retained children must have an explicit surviving parent before a container is removed. |
| Dependent work → prerequisite work, `blocks` | Execution prerequisite | Never add it for an attachment. Preserve unresolved prerequisites, including outside a retiring family. |
| Run → workflow system, `related` | Discover the one matching system document; validate its declared run identity | Preserve while live. Delete this edge only under the exact retirement manifest. |
| Spawn → its one run/stage anchor, `related` | Captured assignment agreement; not arbitrary all-related-work membership | Replacement must retain the same assignment. A foreign or malformed anchor blocks admission. |
| Replacement spawn → predecessor, `supersedes` | Resolution lineage, not rewriting predecessor outcome | Retire the lineage together, or preserve all endpoints still needed by live readers. |
| Response → producing task, `replies-to`; response → request, `related` | Authored delivery and exact request lineage | Immutable while live. Cannot purge its required request anchor and still pretend current response decoding works. |
| Correcting response → each prior current head, `supersedes` | Explicit correction, no timestamp-selected winner | Compact the complete relevant lineage; unresolved competing heads block compaction. |
| Diary → retained work, `related` | Attachment with independent lifetime; classify diary with registered artifact label and readable title | One diary may inform multiple tasks. Every affected retained task must receive relevant knowledge before deletion. |
| Retained generated work → surviving source work, `parent-child`, after approved reparenting | Preserve meaningful scope when a purely structural run/group retires | Record former run/visit identity as historical provenance. Do not flatten substantial semantic grouping or alter unrelated parentage. |
| Retirement receipt → retained summary targets, `related` | Discovery of compaction provenance | Targets remain useful without this receipt; receipt is not a substitute for the summary. |

Use `related` consistently for these new attachment associations; leave existing merge-reference `relates-to` ownership unchanged. Native dependency/dependent headings include nonblocking links; readers must expose type, direction, count and completeness rather than interpreting every link as a prerequisite.

Register proposed diary/retirement classification vocabulary through the label steward during implementation. This report does not add labels. Machine validation uses class plus schema and exact identities; it must not use title parsing. Retention classification is a separate reviewed manifest decision, not inference from `busybee-workflow`, closed status or ancestry.

## 5. Proposed JSON examples and consumed interfaces

These are **illustrative proposed shapes**, not existing schemas, CLI input or complete XState snapshots. Common `kind`, `formatVersion` and `generation` make breaking interpretation explicit. Native owner/assignee/status/labels/links remain outside the document unless a specific integrity cross-check needs an identity copy.

### Workflow system description

```json
{
  "kind": "workflow-system",
  "formatVersion": 2,
  "generation": "g2",
  "runId": "work-run",
  "definition": {"name": "do-work", "version": "2.0.0", "hash": "sha256:..."},
  "lock": {"owner": "invocation-uuid", "host": "host-a", "pid": 123},
  "managedExecution": "managed",
  "publication": {"state": "stable"},
  "execution": {"state": "active"},
  "created": [{"bead": "work-visit", "scope": "visit", "node": "work", "path": [], "visit": 1}],
  "results": {
    "work-visit": {
      "original": {"choice": "next", "data": {}},
      "recordedBy": "bee-identity",
      "observedTaskRevision": "native-updated-at",
      "consumption": {"state": "unconsumed"}
    }
  },
  "closures": {
    "work-visit": {
      "state": "confirmed",
      "scope": "visit",
      "outcome": "succeeded",
      "closedAt": "2026-10-24T12:00:00.123456Z",
      "reason": "Verified the assigned acceptance criteria."
    }
  },
  "settlement": {"state": "none"},
  "snapshot": {"omittedFromExample": true}
}
```

A prepared closure additionally retains the exact pre-close native revision, invocation and intended readable reason. A confirmed entry binds the actual native `closed_at`, not an event ID. Results are keyed by **native visit ID**, not node, actor path or replacement request. Accepted history refers to the original and keeps consumed transformed data only where resume/inspection needs it; it does not replace the original.

### Spawn description

```json
{
  "kind": "spawn-request",
  "formatVersion": 2,
  "generation": "g2",
  "host": "host-a",
  "assignment": {"kind": "stage", "runId": "work-run", "stageId": "work-visit"},
  "recipe": {"kind": "worker", "roleText": "exact captured role", "direction": "Read the assigned native brief and completion protocol."},
  "latest": {
    "state": "executing",
    "attemptId": "attempt-uuid",
    "attemptNumber": 2,
    "retriesStarted": 1,
    "observedAt": "2026-10-24T12:00:00Z",
    "recordedAt": "2026-10-24T12:00:02Z",
    "actor": "sys-colony",
    "stdout": {"lastOutputAt": null}
  },
  "closure": {"state": "none"},
  "acknowledgment": {"state": "none"}
}
```

The recipe example omits harness options for brevity, not from the real contract. Capture exact role bytes once per request; eliminate the repeated full task brief in the dispatch prompt. Do not replace captured roles with mutable current files. Shared immutable role artifacts are deferred: they save measured duplication but add another availability/GC contract not needed for this cutover.

A terminal request's JSON closure uses prepared/confirmed variants and native closure binding, just like workflow evidence. Request outcome is no longer parsed from `close_reason` values such as `completed` or `blocked`. Acknowledgment records exact closure stamp, actor, time and explanation in JSON. Supersession still comes from native typed edges and takes precedence for resolution; failure outcome remains unchanged.

### Response description

```json
{
  "kind": "response",
  "formatVersion": 2,
  "generation": "g2",
  "taskId": "work-visit",
  "requestId": "spawn-id",
  "author": "bee-identity",
  "body": "# Complete authored answer\n\nThe entire Markdown answer is here, not a file link.",
  "supersedes": []
}
```

Keep response artifacts non-system. Their envelope is an explicit artifact representation, not a precedent for JSON ordinary task briefs. Exact reads return the named original while it is retained. Publication does not imply work acceptance; corrections preserve all original bodies until compaction.

### Interface ownership

- **Beads:** consumed native facts and guards, close CAS, projected/paged reads, generation-aware import/export and reconstruction capabilities. No Hive lifecycle policy.
- **Shared:** consumed workflow identity/control/evidence and spawn/response/retirement discriminated schemas; small definition-free joined readers. No scheduler, XState engine or UI presentation.
- **Busy Bee:** workflow document, publication owner, result/closure/settlement protocols, definition restore, collection, preview and retirement eligibility.
- **Colony/Bee:** request document mutations, admission/claims/attempts/process clearance, responses and their eligibility. Private SQLite owns recoverable attempt checkpoints and optional diagnostic history, not native work truth.
- **Beeswax:** coordinated freeze, manifest application and generation transport/rejoin. It invokes native storage operations and product clearance interfaces; it does not become a second record merger.
- **Hive UI/BV:** read-only projections; no repair, compaction, acceptance or completion authority.

A shared lifecycle read returns native status plus `pending`, `confirmed`, `unclassified`, `publication-pending`, `inconsistent` or `retired`, with observed endpoint/generation/stamps. Never load workflow definitions just to answer completion or admission. Keep snapshot/results engine-private and make exact result inspection opt-in.

## 6. Current-to-target writer and reader inventory

Paths in this section are relative to the canonical Git root at the verified revision.

| Surface and current evidence | Required target change |
| --- | --- |
| Run/frontier creation, `lib/busybee/src/runtime.ts:496`, `:1559`, `:1592`, `:1636`; `lib/busybee/src/definition.ts:16`; `.workflows/do-work/workflow.ts:22` | Add native AC carrier and draft creation/promotion. Keep readable briefs and concise completion pointers. Stop rendering AC into description. Generated work stays ordinary. |
| Checkpoint snapshot/inventory/history, `lib/busybee/src/runtime.ts:392`, `:1084`, `:1453` | New format; original results, ownership, settlement and confirmed lifecycle evidence in one system description. Preserve coherent prior checkpoint during partial publication. |
| Lock UUID/PID in checkpoint notes, `lib/busybee/src/runtime.ts:722`, `:769` | JSON lock member, whole-document CAS, fresh owned writes and owner-checked release. Preflight/Colony must stop treating empty notes as unlocked. |
| Original result in visit notes, `lib/busybee/src/runtime.ts:944`, `:1022`, `:1223` | Exact original in system ledger; prose notes released to agents. Remove alternate submission bypass. |
| Structured native closure and derived labels, `lib/busybee/src/native.ts:250`, `:270`, `:291`; `lib/shared/src/workflow-lifecycle.ts:29`, `:100` | Readable native reason plus joined confirmed JSON evidence. Consume close CAS. Labels remain indexes with explicit repair state. |
| Settlement run-note marker, `lib/busybee/src/settlement.ts:331`; Shared marker at `lib/shared/src/workflow-lifecycle.ts:124` | JSON settlement fence and partial-effects inventory. Preserve unsuccessful unfinished work rather than auto-satisfying its AC. |
| Dispatch copies full brief, `lib/busybee/src/runtime.ts:1666`; captured request, `lib/colony/src/producer.ts:161`, `:212` | Short assignment pointer, exact role capture, versioned request envelope. Record created visit before request dispatch so final admission can require saved membership. |
| Host/identity/anchor parsing and request close-reason grammar, `lib/shared/src/spawn-request.ts:172`, `:205`, `:284` | Versioned authoritative JSON decoding; native status remains requested/closed fact. Remove close-reason grammar and comment fallbacks together. |
| Observation/stdout comments, `lib/colony/src/observations.ts:188`, `:211`; manual launch provenance, `lib/colony/src/launch.ts:146` | CAS-update latest operational members, preserving exact host/attempt attribution; detailed history stays local. Update manual provenance too. |
| Acknowledgment comment, `lib/colony/src/requests.ts:202`; request-label publication `:302` | Closure-bound JSON acknowledgment; conflict-aware member replacement; derived label refresh. No comment union or historical-label inference. |
| Request state machine settlement, `lib/colony/src/request.ts:632`, `:743`, `:760`; private storage `lib/colony/src/store.ts:50` | Preserve verified process ownership, reserve-before-launch and claim release. Namespace private state/receipts by tracker generation. Clear local runtime obligations before retirement. |
| Anchor/claim/admission reads, `lib/colony/src/workflow-anchor.ts:25`, `:73`, `:85`; `claims.ts:14`, `launch.ts:485`, `:509`, `dispatch.ts:246` | Shared joined evidence and publication fence at every decision point, not just status CLI. Successful stage remains successful after later run cancellation. |
| Request attachment/clearance, `lib/colony/src/workflow-submission.ts:90`, `:205`; `execution-clearance.ts:62` | Stable frontier/recorded publishing state before requests; gate final launch on stable publication and no settlement/retirement intent. Preserve fresh owning-host clearance. |
| Immutable responses, `lib/colony/src/response-store.ts:18`, `:121`, `:351`, `:413`, `:456` | Versioned envelope, same exact provenance/correction checks while live; explicit compacted response lookup after retirement, not malformed dangling records. |
| UI checkpoint identity hydration, `lib/hive-ui/server/data.ts:483`; native outcome `server/api.ts:142` | Shared identity/evidence contract; current versus retired provenance; bounded indexed discovery without downloading all snapshots. |
| UI topology, `lib/hive-ui/server/topology.ts:32`; Shared BV `lib/shared/README.md:5` | Preserve selected JSONL versus SQLite authority and before/after freshness checks. Include generation in cache/source identity. |
| Normal exchange, `lib/beeswax/src/beads/publish.ts:132`, `:162`; standalone merge `lib/beeswax/src/git/merge-core.ts:195` | Generation admission before native reconciliation; no old/new common-base merge. Standalone driver must reject unsupported mixed generations, not invent different purge semantics. |
| Bundled tools, authoring/execution guidance, `lib/busybee/README.md:19`, `lib/colony/README.md:15`, `lib/beeswax/README.md:93` | Ship one coordinated breaking release, updated definitions and installed guidance. Remove notes-as-result and close-reason parsing instructions at every launch/completion source. |

Trusted authored workflow actions and arbitrary agent commands can write elsewhere. The inventory covers owned production paths, not permission to make all prose machine grammar. General progress guidance should direct detail to diary comments and durable findings to work notes; complete response bodies are not copied into every ancestor.

## 7. Completion, crashes and concurrency

### The selected close protocol

The minimal alternative retains structured native `close_reason`, preserving the current single-write closure/disposition coupling. It is the least code, but directly violates the selected ordinary-field target. A general native transaction could atomically assert task/system revisions, close and update evidence; it would require native transaction, receipt, export/recovery and adapter contracts, not just a flag. It still would not atomically execute XState effects, dispatch Bee or launch a process.

**Select the middle path:** native guarded close plus an explicit joined-evidence gap. It fits Hive's resumability-not-Temporal tenet and requires less new machinery. The cost is real: some interruptions require explicit recovery rather than automatic success. Do not add a transaction library, distributed lock or hidden reason-string token to conceal that cost. If production evidence later shows unacceptable frequency, the alternative is a bounded native assert-and-close/update transaction—not a Hive SQL bypass. That is a later capability decision, not a dependency of this proposal.

### Successful worker completion

1. Read the current native task/AC/reservations and exact generation/run/visit. Verify work and deliver any required complete response. The caller supplies the observed native revision for completion; a moved task requires rereading its scope/authority.
2. Under per-run ownership, validate the **original JSON input** against the frozen outcome contract and current permitted transition. Save it once in `results[visitId]`, with attribution and observed task revision. Equivalent structural JSON retries match; different data fails. Arrays, scalars and a data member named `choice` remain valid when the schema permits them.
3. A result save is not acceptance. Moving it off the task removes today's atomic task-CAS/result-write coupling. Read task authority again; later native close must compare the exact fresh revision. A changed brief/AC/reservation cannot be waved through because the original was saved. After a legitimate AC repair, an explicit identical completion may revalidate against the new task revision; it never silently changes the original result.
4. Persist prepared closure evidence under the same owner, then close through native policy **with `if-unchanged`** and a readable reason. No force or policy bypass.
5. On confirmed close, reread native closure and save confirmed evidence bound to run, scope, visit and precise `closed_at`; publish derived outcome labels. Return success only after required evidence is confirmed. Label failure is a separate, repairable projection failure, not loss of native closure.
6. Release only through a fresh owner-checked write. Do not advance; the driver collects.

Current native close timestamps are the closure identity used by this protocol. Ordinary later notes/labels edits do not invalidate it; reopen/reclose does. Keep original reason for provenance, but do not parse or require human prose to stay byte-identical for disposition. Unsupported manual manipulation of closure timestamps, concurrent exchange or old writers is outside this coordinated guarantee. A future portable closure token, if required, must be native and exported—not the current local event-derived status revision.

### Defined interruptions

| Interruption | Required behavior |
| --- | --- |
| Before original save | No result/closure success; normal retry after fresh checks. |
| Original saved, task still open | Return saved ID/evidence; identical completion can retry. Never discard the original on AC refusal. |
| Native close definitively refused | Clear only conclusively unperformed intent, release close ownership; keep result and actual refusal. |
| Close attempted, reply uncertain; or close succeeded but confirmation save failed | Retain prepared evidence and publication ownership; report `publication-pending`/uncertain effect. No automatic unlock, repeat close or success inference. |
| Confirmed close, label write failed | Read confirms native/evidence pair; repair only owned label namespaces without re-closing or changing the result. |
| Progression effects partly published | Keep operation/inventory and confirmed/uncertain IDs. Inspect them before resuming; do not recreate tasks/requests or replay external effects blindly. |

Recovery is explicit and bounded: inspect exact native task, prepared intent, original result, invocation/command receipts and process/publication ownership. Confirm only when the intended close is evidenced; a closed task plus matching readable reason alone is insufficient. If attribution remains ambiguous, leave it unclassified and route remaining work through an explicitly inspected continuation. Never reopen/reclose merely to manufacture matching evidence. Retirement refuses unresolved uncertainty.

### Collection and schemas

Collection uses only native-closed visits with matching confirmed **successful** evidence and saved original result. It validates the selected batch before advancement and consumes in stable frontier order. Validation at save can be a dry check; at consumption parse the original once for that consumption and retain the transformed value actually used. Never feed transformed output back into an input schema. Require deterministic/pure schema transforms; changing the saved contract is a breaking definition change.

The public `next`/`choice` bypass disappears. An ordinary external close with valid JSON does not automatically become a successful workflow visit. This intentionally changes the current discrepancy in which collection/direct navigation may accept an unclassified close while Colony refuses it. Do not retain a second “adopt closed work as success” shortcut. Explicit recovery can establish evidence from real receipts, or report that it cannot.

A collected visit's original stays until retirement, supporting identical completion retries. A loop creates a fresh native visit; untouched parallel visits retain theirs. A late result from a different request must still prove the same live anchor and authorized identity. Successful review execution choosing `changes` is distinct from successful feature acceptance.

### Publication and fences

All cooperating workflow mutations serialize on one short per-run JSON owner, acquired/released with native whole-record CAS. Do not expire/steal locks by PID. Refresh before each owned patch so results, lock and settlement cannot overwrite each other. All live writers of a run use one selected database; snapshot exchange is not a distributed lock.

Simplify initial dispatch's present exception: save a `publishing` frontier with the newly created visit IDs and any uncertain effects **before** calling Bee. Bee may create requests against recorded publishing visits while that authorized publisher holds ownership, but Colony may not launch until the frontier is `stable` and the lock is released. This removes the requirement to infer new stage membership only from ancestry before inventory exists. Initial run/checkpoint/link creation remains multi-write and reports every confirmed/uncertain identity.

For settlement, persist intent before requesting owning-host clearance under Colony's admission gate. Hold workflow ownership across fresh inventory/clearance and publication. A closed request is not stopped execution; sleep, removal and daemon exit do not stop detached supervisors. Unknown/foreign/unbound ownership refuses clearance. Preserve explicit unmanaged proof as the daemon-free path; missing provenance is not proof.

Unsuccessful settlement stops further progression/admission and records execution disposition. It preserves successful visits and completed native work. It does not invent results, mark incomplete AC done or force-close pending work. Any needed reparenting of unfinished useful work is an explicit reviewed scope-preserving step, never an automatic side effect of `settle`. Native container closure may therefore remain blocked while execution is terminal; readers must expose both facts.

This changes Colony's anchor mapping explicitly: **request success still requires a matching confirmed successful native anchor closure**. A stopped, deliberately cancelled/failed execution may instead settle its request unsuccessfully while that anchor remains unfinished. That classification comes from explicit execution settlement evidence, not from interpreting an open task as closed. Claims release only under existing identity/reservation rules. A retained unfinished former run is ordinary remaining work; starting its next execution is a separate, inspected action.

## 8. Bee, Colony and response behavior

Keep Colony's existing responsibility split rather than rewriting the daemon: request preparation/ranking, claims, immutable attempt reservation, supervisor handoff, process ownership checks, retries and terminal cleanup already encode important safety. Replace the persistence/read contracts at their seams.

- Only the captured host automatically dispatches, observes or reconciles a request. Generation becomes part of receipts, tokens and store authority checks. Losing private attempt history is not permission to launch again.
- Reserve an attempt before launch; persist verified supervisor handoff before granting execution. A stale finish report cannot affect another attempt or generation. Waiting drivers continue to consume ordinary quota.
- `latest` is the latest **recorded observation**, not daemon/process liveness. Include observed time, recorded time, host, actor, attempt ID/ordinal and distinct retry count. A new attempt resets stdout evidence to unknown. Never advance the observation timestamp merely because a poll found nothing changed.
- Recommendation: shared lifecycle/attempt/settlement changes immediately when observed; stdout updates at most once per **60 seconds** while changed, plus first and final observation. This is a chosen throttling policy, not an end-to-end freshness guarantee. Detailed samples/logs remain local; retain them until retirement and any incident hold clears, then remove with the exact local artifact manifest. No arbitrary historical telemetry guarantee.
- Bee stop, Colony settlement and acknowledgment update disjoint JSON members through fresh CAS. On conflict, reread and re-evaluate eligibility, preserving other members; do not concatenate observations or use last-writer-wins blindly. A prepared request closure carries an operation owner and fences competing terminal mutation; observation writers preserve that member and cannot confirm, clear or replace it. Uncertain request closure retains that fence for the same explicit recovery discipline as workflow closure. Acknowledgment binds the exact confirmed failed closure and preserves its first accepted local fact; cross-clone competing edits fail for deliberate resolution rather than comment-union selection.
- Native spawn status remains whether work is requested. Prepared/confirmed JSON explains terminal disposition; arbitrary native close becomes unclassified, not implicitly cancelled. Explicit Bee stop supplies cancellation intent/evidence. Outcome/resolution labels are derived and may lag.
- Automatic retries retain request/identity; explicit retry creates replacement → original supersession and retains the anchor. Successful replacement creation resolves predecessor attention, not its failure outcome. Uncertain create must return known IDs and prohibit duplicate replacement until inspected.
- Response publish remains immutable, exact-body and scope-aware. Current-head ambiguity requires a correction superseding every head. Native response availability is separate from request success. Publication/readback precedes successful completion where the assignment requires delivery.

An exact retained response continues to validate all live provenance links. Do not mutate its envelope to accommodate deleted anchors. Either retain its whole required lineage or compact and remove the artifact under §9, exposing a **different `compacted` result** pointing to self-contained retained knowledge. Never return a summary under the pretense that it is the original full answer.

## 9. Logical compaction and execution retirement

### What must remain useful

For each retained task, a reader who never opens the response or diary must understand:

- WHAT was requested and what was actually delivered (or remains undone);
- WHY the approach/decision was selected, including material alternatives rejected;
- acceptance outcomes and concrete verification: revision, commands/scenarios/results or other suitable evidence;
- important failures, corrections, uncertainty, limitations and follow-up ownership;
- attribution and provenance sufficient to distinguish user decisions, agent recommendations and established facts.

Write a **consolidated current account**, not append one summary per attempt. Keep description current; use notes for decisions/findings/proof. Do not duplicate the whole report there merely to claim compression. Some reports contain enough unique value that the right result is “retain report” or a dedicated retained knowledge/evidence bead, not forced shortening.

### Quality gate, not just a byte gate

The compactor produces an explicit coverage map: source response/diary sections and important facts → retained task/knowledge sections, plus consciously discarded diagnostics and rationale. Read every current response head and relevant correction, not just its title. A verifier checks the summary against the source and native acceptance, and tests that the key handoff questions above can be answered without following a soon-to-be-deleted link.

Recommendation: an independent agent verifies routine compaction; a human reviews changed/reserved decisions, disputed or safety-sensitive conclusions and the destructive manifest. In a one-agent operation, destructive application requires human verification rather than self-certification. Mere schema validity, all checked boxes, a successful classifier or a link to the full report is not semantic proof. This report itself is only a proposed design; no compaction verification or human approval is claimed.

Update retained summaries with source revision guards, reread, and record their hashes/revisions and verifier attribution in the manifest. Any relevant source/target change invalidates approval. Handle important facts in ordinary comments during the initial rebuild by consolidation too; future diaries avoid repeatedly filling retained tasks with disposable comments. No individual-comment deletion protocol is assumed.

### Eligibility and the retirement boundary

A family can retire only after:

1. Busy Bee inventory is complete; every successful saved visit is collected, or explicitly disposed as unconsumed under terminal execution. No pending closure/progression uncertainty or retained publication owner remains unexplained.
2. Every driver/stage/replacement request is terminal and operationally resolved; acknowledgments do not conceal unfinished work. No awaiting worker delivery or ambiguous response correction remains.
3. Owning-host Colony proves no live/unverified attempts, pending reservations, claim releases or finish reports remain. External/manual execution holds are resolved. No process can still publish into the family.
4. Every meaningful work bead is selected for retention; unresolved work/reservations, specialist evidence, merge references and incident holds are retained. No open execution obligation is confused with an open useful work task.
5. Knowledge coverage is verified, all required destinations survive, and outside references are accounted for. Retained responses with still-required anchors prevent removing those anchors.
6. Retained children of removable containers receive reviewed surviving parentage. Open ancestors need not finish, but source-task acceptance is not changed. Relationship modifications and summary writes are explicitly listed.
7. The exact manifest is approved, fenced and revision-checked immediately before application.

**Commit retirement before physical deletion:** publish a compact retirement receipt, verify it, and mark the workflow execution retired under its owner. After this boundary, retry/attach/complete/collect/settle/simulation on that execution returns `execution_retired`, never starts a replacement or recreates a checkpoint. Reads show retained summaries, execution outcome/provenance and whether original detail remains during the purge interval. Exact current-generation removed IDs resolve through the receipt; unknown IDs remain unknown, not inferred retired from absence.

Retirement may occur with retained unfinished ordinary tasks. Those tasks remain open/blocked with honest AC and a next action; a future execution must deliberately select remaining scope. A formerly workflow-generated task can remain useful ordinary history after its execution is gone. No label change is necessary to make that true.

### Exact manifest, never cascade

A manifest contains generation and operation ID; all source IDs, classification reasons and revisions/content digests; retained IDs and summary coverage; exact deletions; exact parent/link rewrites; current response heads and lineage closure; request/attempt clearance receipts; native closure/collection facts; preserved reservations/holds; archive disposition; actor/verifier/approval; and per-phase confirmed/uncertain effects.

Compute both inbound and outbound edges, including non-parent attachments. Scan known structured embedded references and inspect prose references in the candidate sources/retained summaries. Unknown incoming consumers block removal or require an explicit resolution. Do not recursively pull outsiders into deletion to satisfy the manifest. Native `--cascade` follows blocking dependents and can select an ancestor; it is categorically excluded.

Recheck the complete affected reference set, not just candidate row revisions: a newly linked outside task invalidates the plan. Under the maintenance freeze this can be a native snapshot digest plus explicit edge inventory; no live race is hidden behind an earlier dry-run. Success requires verified resulting records/edges/export, not just exit code zero—prior experiments observed successful previews without deletion.

## 10. Synchronized tombstones, purge and offline machines

**Recommended model: one maintenance coordinator, a finite registered writer fleet, and generation-based physical purge.** No per-host cron deletion and no tombstone TTL. Logical retirement can accumulate until a deliberate maintenance checkpoint; no arbitrary retention age is selected. Cost/volume triggers may request review but cannot authorize deletion.

### Why a new generation

Native soft deletion retains full payload; native receiving merges can reconstruct full tombstones; comments are unioned; missing rows can return after deletion knowledge is gone. “Tombstone, sync once, hard-delete locally” does not establish fleet compaction. Adding compact tombstones, comment-deletion markers and a new distributed merge algebra is a larger project than the authorized target needs.

Instead, physically reclaim the approved records only while constructing **G+1 from retained data**. Within G, retain retirement receipts/tombstones and reject retry, but do not independently hard-purge. At the generation boundary, neither G's snapshots nor its common bases participate in G+1 reconciliation. This also permits dropping selected old comments/audit payloads without inventing comment tombstone semantics inside one merge generation.

### Protocol

1. **Prepare:** enumerate every configured database, publisher, Colony daemon, detached supervisor, worktree, direct agent session, automation hook and backup/restore route. Fix a signed-off manifest and target policy/tool versions. Resolve tracker incidents first. Do not equate tracker alerts, a local qlock or sleeping Colony with a fleet freeze.
2. **Stop writers:** drain/settle executions where possible; prove owned processes stopped and publication locks resolved. Pause sessions, hooks, scheduled publishers and all import/export writers. Each enrolled online host acknowledges the exact freeze operation and snapshot digest. Any unavailable host is explicitly revoked from the next generation, not presumed acknowledged.
3. **Converge retained inputs:** deliberately reconcile outstanding same-generation work before destructive changes. Conflicts stop the operation. Unpublished work from offline hosts is handled on later rejoin, not silently lost or auto-merged. Capture and verify an immutable pre-mutation backup of the frozen database, export/base, relationships, policy and required private receipts before summary/reparent/tombstone application; this is the actual pre-activation rollback source.
4. **Communicate retirement:** publish the single approved retirement/tombstone set in G with fixed deletion provenance through native operations. Verify online participants received that same set. Do not let each host invent different deletion timestamps/reasons and then merge them. G remains a full-payload, read-only rollback source during preparation.
5. **Reconstruct G+1:** use native supported export/reconstruction tooling to create a fresh database from the verified retained projection. Omit exact approved records/comments/events; preserve retained identity, status, owner, assignment/reservation, AC, readable closure, meaningful dates, labels and surviving links. Keep unknown/uncompacted records in full. No routine hand editing of generated JSONL or direct SQL purge.
6. **Verify:** compare expected retained IDs/fields/edges, summary coverage, response retrieval where retained, unresolved work, current/retired projections and export/reimport results. Verify fresh-clone hydration from G+1. Keep writers disabled until checks pass.
7. **Commit generation:** atomically switch the accepted generation/transport descriptor and activate only version-matched endpoints. Create a **new tracker Git repository/history** for G+1 rather than merging old `tracker/state` ancestry. This is a proposed change to tracker transport; preserve the permanent local tracker checkout identity/path through controlled replacement, not accidental deletion.
8. **Rejoin:** every host verifies generation, manifest digest and minimum tool protocol before mutation/publication. Current hosts reseed G+1; revoked/offline hosts are quarantined and must export old unpublished changes for explicit salvage review. Reconstruct accepted still-relevant work in G+1; do not import their full snapshot, reopen retired requests or resume old attempts.
9. **Purge local old stores:** after verified cutover and rollback-window approval, remove only manifest-listed old DB/export/base/backup and Colony artifact families. Retain the agreed read-only archive separately. Verify no configured path, daemon registration, Git ref or automatic restore route points back to G as writable authority.

### Enforceable admission, not a marker alone

Generation is required in the database/export manifest, native import/merge contract, Hive invocation/receipt context and transport selection. Missing/mismatched generation refuses write/import; no “legacy means current” fallback. This needs native/Beeswax work: **current sync does not provide it**. The new generation's importer must reject naked old JSONL without an approved reconstruction operation.

Unmodified old tools will not obey a newly invented marker. Therefore cutover also removes old binaries from admitted runtime paths, retires old writable DB paths, revokes old publication credentials/targets and gives G+1 transport access only to enrolled upgraded publishers. Old tracker repositories become read-only archives. A stale laptop may continue editing its quarantined G copy, but cannot publish into G+1. A returning updated host must handshake before reconnecting its writer. A generation label in an ordinary bead or advisory session hook is not this enforcement.

This is a cooperating-tool/fleet operational guarantee, not a security boundary against the same OS user deliberately opening databases or using privileged credentials. If transport cannot restrict old publishers or an execution cannot be proved stopped, cutover does not proceed. Do not weaken that prerequisite to meet a date.

### Git history, archives and tombstone lifetime

A fresh DB does not erase old Git objects, clones, SQLite backups or logs. Recommendation: retain **one checksummed, read-only G archive** for rollback/provenance, not one archive per report; it is never a merge/import source for live G+1. Record its access and retention separately. Published G+1 has a new root and does not fetch G's history by default. Existing clones may retain G objects until explicit local cleanup; lossless packing is not erasure.

Current-generation retirement receipts provide exact-ID → retained-target lookup. At the next reconstruction, compact them into an archival generation index; keep that index available read-only with the archive, not every execution document online. Retained work carries readable provenance and its substantive account independently. A read of an old generation can explicitly report `generation_archived` and provide the index/archive location; if that archive is later deliberately discarded, report detail unavailable, never fabricate the old response. Permanent exact-preview and forensic-log retention are **not** promised.

Do not expire deletion knowledge within G. G+1's enforced rejection of G inputs is what allows G tombstones to disappear, including for offline clones. Secure historical erasure would require a separate fleet/provider/backup deletion operation and is not claimed here.

## 11. Breaking cutover and reconstruction details

Prefer a **single clean cutover**, not dual writers or automatic legacy format conversion. Keep native Beads and XState; rebuild the affected persistence protocols, not every product. Roll out the generation admission primitive before activating any destructive compaction.

### Retained-data export

The export is a reviewable native-produced projection, distinct from ordinary live JSONL:

- Every open/blocked/draft/HITL/reserved ordinary record, plus all meaningful completed work, is retained by default.
- Preserve work identity and original chronology; record migration actor/time separately. Preserve human assignments unless explicitly released by that human. Do not convert all imported records to new open work or claim them for the migrator.
- Consolidate accepted decisions, material report content and useful diary findings into retained work/evidence. Preserve complete reports when verification is incomplete. Retain unresolved corrections and dependencies in full.
- Preserve original native closure for accepted completed work and annotate execution provenance in notes. Where old workflow machine closure JSON exists, native reconstruction may materialize its readable reason and preserve disposition in a migration/retirement receipt. This is an explicit, verified transformation—not inference from saved `done` or labels.
- Reparent retained generated work only where an eliminated container was merely structural and the approved mapping preserves scope. Otherwise retain the container. Preserve relevant dependencies and references; list intentional link removals.
- Emit an exact source-to-retained mapping and a digest of the projection, plus all exclusions and uncertainties. Unknown record types are copied in full, not silently discarded.

A supported native reconstruction interface is required if ordinary import cannot preserve these fields while intentionally dropping selected comments/events and rewriting approved links. It must validate unique IDs, retained endpoints, policy/classification and output digest. It is a maintenance capability, not a hidden second merger or a permission for runtime code to write SQLite.

### Active and uncertain executions

Finish known active old-format work with matching tools before freeze when practical. Otherwise explicitly stop/quarantine it, preserve completed effects and all uncertainty, and retain its relevant records in the archive/retained projection. Do not translate an executable old XState checkpoint into a new live one automatically. New runs receive only reviewed remaining scope and evidence of effects already performed. Unknown process state or uncertain irreversible effects prevent activation for that scope; they are not reset to “not attempted.”

The generation migration may therefore retain an unresolved ordinary incident/work task while refusing to resume its old execution. There is no obligation to purge every old record to make the cutover successful.

### Rollback boundary

Before G+1 admits any writer/attempt/external effect, verification failure can discard the candidate and restore the frozen G endpoint and matching tools. After activation, **do not roll back by switching to G**: doing so would lose new work or replay effects. Stop G+1, preserve its changes and use a forward repair/reconstruction generation. Archive restore always enters quarantine and never automatically wakes Colony. Record the activation point and admitted writer/attempt receipts.

Coordinate installed `br`, Beeswax, Bee/Colony, Busy Bee, Shared/Beads consumers, Hive UI, BV source adapters, definitions, hooks, recipes and harness guidance. Verify actual executable provenance and daemon process version, not just checked-out source. Update frozen-role/launch instructions for new requests; no mixed-format daemon or old definition can start new-generation work. Read shipped changelogs/adoption guidance after upgrading. Existing worktrees must adopt endpoint/guidance changes before use.

## 12. Selective reads and write-amplification budget

Default work reads fetch bounded native summary fields and typed-link summaries, then hydrate the selected brief, response or diary. Do not attach all comments, captured recipes or checkpoint context to routine list/status output. Native `show` is a deliberate detail read, not the default bulk hydration primitive.

Proposed consumer defaults: 50 records per page, explicit continuation/completeness, 50 relationship summaries per direction and a documented byte budget (for example 128 KiB) that returns a continuation/resource-limit indication rather than truncating a body. Exact response retrieval preserves the full authored body regardless of summary-page budgets. Backing commands that currently lack paging must gain it or report their unbounded backend cost; caller-side `jq` is not a performance implementation.

Expose projected system headers/members through native selection or a focused public read, not a UI schema reaching into every private checkpoint. Busy Bee's compact show/status should return the active frontier and counts/cursors; full generated/history inventory is opt-in. Live admission loads only the run control and selected native anchors; retirement is the explicitly complete inventory operation. This requires adding indexed/projection support where the current native contract cannot read JSON members cheaply; do not claim reduced CLI output alone reduces SQLite/export cost.

**Search needs a deliberate change:** ordinary native search did not include notes in workshop tests. The default work-summary search must cover description and consolidated notes (native indexed search extension preferred); until then expose a clearly composed union of bounded searches with honest paging/deduplication, not a misleading ordinary keyword search. Compaction must not make durable WHY undiscoverable.

UI default work view includes meaningful generated work; hide system/artifact/coordination containers, not every `busybee-workflow` record indiscriminately. Current executions have workflow previews; retired work shows native status and a separate archived-execution badge/summary link. Retired execution has no live preview/simulation promise. Bee history shows full retained requests or explicit archived summaries, not invented liveness. BV viewer recipes need the same classification distinction; Colony readiness/ranking still uses native task eligibility, not viewer filters.

Preserve BV SQLite ranking versus exported JSONL topology as distinct sources. Generation and export digest participate in cache keys. Freshness checks bracket hierarchy hydration; stale exported topology must remain visible even if BV says its file loaded successfully. Never silently substitute stale graph data for authoritative native assignment/closure.

**Cost model:** a workflow document of size S rewritten W times costs roughly W×S serialized bytes before native export/storage overhead; moving lock/results into it increases that cost even if record count shrinks. A spawn of size R updated U times similarly costs U×R. A whole export may still scan N records on each mutation. Logical latest-only JSON bounds live history, not necessarily Git/WAL/backup write volume.

The parent's 20-update probe found no per-description-edit audit events: latest JSON left 2 events versus 22 with observation comments, no comments versus 20, and roughly 3.8 KB less final JSONL. At 16/256 KiB starting payloads, median write latency was approximately 47/55 ms and allocated SQLite size was unchanged between modes. This supports removing comment accumulation, **not** a claim that old JSON values are retained by native audit or that a large locked ledger is cheap. It included neither CAS ownership cycles nor contention. The earlier 73% automation/workflow volume is a classification measurement, not a safely deletable fraction.

Reduce W/U by batching compatible owner updates, making unchanged publications no-ops, dropping redundant full-brief dispatch copies and throttling stdout. Do not remove necessary pre-effect checkpoints or native witnesses. Keep original result plus consumed data only for demonstrated recovery/inspection needs; no response bodies in checkpoint context. Large/long-lived workflows must split at explicit execution retirement/continuation boundaries, not silently trim required originals. Do not introduce per-visit result beads or a role blob store without measured need.

Benchmarks must measure live JSONL bytes, logical rows/comments/events, per-run native calls/serialized bytes, lock latency, p50/p95 read and merge time, RSS and local/Git/archive growth. Prior measurements (roughly 46–63 ms graph reads versus seconds for 100 full details; about 124/824 ms UI hierarchy helpers at 1,000/5,000 nodes) support selective hydration, **not** a performance guarantee for this target. Native whole-state witness optimization remains a separate task; do not claim retention alone fixes the measured 40-second merge.

## 13. Bounded implementation packages and acceptance

These are proposed work packages, **not created tasks or an edited feature plan**. Each should remain a focused few-day slice; if a slice grows, split by its contract rather than building a generic persistence platform.

| Order / owner | Deliverable | Focused acceptance |
| --- | --- | --- |
| 1. Native Beads + Beads adapter | Class-scoped policy capability confirmation/extension; close CAS adapter; generation-aware storage/import contract; native reconstruction design | Ordinary/generated work cannot bypass draft/AC or reclassify to evade it; artifacts need no fake AC; closed creation requires its own coherent checks; close stale-revision refusal is atomic; old generation/missing envelope rejected before writes. Use the parent's completed policy probe as the baseline. |
| 2. Shared + Busy Bee | New workflow document, one completion path, explicit joined evidence and native AC creation | Original scalar/array/transformed inputs survive; different retry fails; native refusal preserves result; unclassified close cannot advance; ordinary notes never parsed or overwritten. |
| 3. Busy Bee + Colony | Publishing frontier, settlement/admission fence and revised terminal-execution versus unfinished-work semantics | No launch crosses publishing/settlement/retirement; known publication IDs survive failures; success preserved across later cancellation; incomplete AC remains incomplete/open. |
| 4. Colony/Bee + Shared | Versioned spawn JSON, latest observations, closure/ack evidence, response artifact contract, generation-bound private attempts | Observation/stop/ack races preserve members; foreign host/stale attempt refused; closed request is not process-stop proof; response heads/corrections retain exact bodies and provenance. |
| 5. Shared + Hive UI + Beeswax recipes | Bounded reads/search and current/retired projections | List bytes bounded; full selected body retrievable; notes searchable; dirty JSONL flagged; meaningful generated work remains visible; missing definition does not erase lifecycle evidence. |
| 6. Busy Bee/Colony eligibility + Beeswax coordinator + native maintenance | Plan-only retirement inventory, knowledge coverage, exact manifest and reconstruction | Useful auto/manual work retained; outside links and late edits invalidate plan; unresolved delivery/process uncertainty blocks retirement; no cascade. |
| 7. Beeswax/operator | Disposable fleet rehearsal, installation and approved generation cutover | Offline clone, old credentials/tool, old backup and mixed base cannot enter G+1; retained fresh-clone reads pass; interruption resumes only known phase; rollback boundary enforced. |
| 8. Bookworm + tool owners | Settled contracts, examples, skills/help, changelog/adoption instructions | Every launch/completion path teaches native AC, prose notes, one completion path and retired-read semantics; no old command/format guidance remains in installed bundles. |

### Required crash, authority and retention scenarios

1. Two parallel completes plus collect; CAS conflict cannot lose a result or erase another owner's fence. Loop revisit uses a different bead/result identity.
2. Interrupt before/after original save, prepared evidence, native close, confirmation, label publication and frontier save. Distinguish refused, confirmed and uncertain effects; never infer success from intent.
3. Modify task description/AC/assignment between result save and close. Native CAS prevents stale closure; revalidation does not rewrite original data. Reopen/reclose invalidates the old confirmation.
4. Fail request creation after visit creation and before/after request ID capture. Resume inspects exact published effects; no duplicate request or external action. Final launch waits for stable publication.
5. Cancel a run after successful review choosing changes. Prior successful stage/request remains successful; unfinished work remains honest; source work is neither force-closed nor reassigned.
6. Simultaneous stdout observation, stop and acknowledgment; restart with private history; stale/foreign finish report; missing ownership proof. No synthetic liveness, lost acknowledgment or replacement execution.
7. Response correction with two concurrent heads; retained response whose request is a purge candidate; report containing a significant caveat omitted from summary. All block compaction until resolved or retained.
8. A generated task with unique useful work, a manual open child, permanent specialist evidence and an outside blocking dependent. Exact manifest retains them; container reparent mapping is explicit and verified.
9. Add a diary comment or incoming link after plan review. Approval invalidates, even if the old candidate body is unchanged. A source can be deleted only after all its knowledge destinations verify.
10. Retire after successful closure but before collection, before driver cleanup, or while a supervisor survives daemon stop. Each must refuse retirement.
11. Freeze/apply crashes at every phase, partial local purge, tombstones received on only one host, an indefinitely offline clone and an old backup restore. No same-generation hard purge and no old-generation resurrection.
12. Fresh G+1 clone retains IDs, human reservations, AC/status/closure evidence, work summaries and required links; no retired execution is silently relaunched. Restoring G after activation is refused as normal rollback.
13. Exact response read returns original while retained, explicit `compacted` after retirement, and explicit archived/unavailable state after archive disposal. A summary is never passed off as the old answer.
14. Benchmark realistic large checkpoints/recipes, many completed executions and large diaries through real public boundaries. Compare total native write/export cost, not only returned JSON size.

## 14. Specialist handoff and settled direction

**To the task owner:** this report resolves the design to the target above and incorporates the parent's completed native-policy/storage evidence. The next action is to present the proposal and obtain implementation/cutover authorization. Package 1 requires native class-scoped policy support; the verified limitation does not justify fake AC or silently weakened gates. Keep this report as complete native evidence; do not treat its publication as approval to alter the parent workshop or prune anything.

**To Bookworm after adoption:** encode the selected contracts in `docs/architecture.md:1`, `lib/busybee/SPEC.md:1`, `docs/agents/spawn-requests.md:1`, `docs/agents/responses.md:1`, `docs/beads-meta.md:1`, `docs/beads-integration.md:1`, `docs/beads-labels.md:1`, relevant product READMEs, bundled authoring/execution guidance and CLI help. Add narrowly scoped decision records for joined lifecycle evidence and generation retirement if the repository adopts ADRs. Define execution retirement distinctly from workflow visit retirement/unsuccessful settlement; do not overload the glossary's existing meanings. Preserve fact/proposal/authorization distinctions.

**To native/storage owners:** prioritize close-CAS consumption, policy-class support, bounded projection/search and generation-safe reconstruction. Do not add a general transaction engine or independently convergent comment-GC protocol for this target. The DB-local status event number is not a portable closure token.

**To runtime owners:** preserve current process/claim safety and prior successful work; replace storage contracts in one coordinated breaking release. No fallback to comments/notes/old close-reason grammar, no dual writes, no auto-migrated executable snapshots, and no automatic replay of completed or uncertain effects.

**Outcome:** design proposal complete. The explicit trade-off is visible closed-but-unconfirmed recovery in exchange for ordinary prose fields and a small native seam; the explicit retention boundary is verified execution retirement followed by a fenced generation rebuild. Destructive adoption remains reserved to ct. No irreconcilable requirement prevents continuing toward this target.
