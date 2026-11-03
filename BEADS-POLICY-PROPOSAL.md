# Beads policy and breaking migration proposal

## Implementation status — 25 October 2026

The original 24 October status and “does not change policy” statement describe publication of the proposal itself. Subsequently, ct approved a bounded guidance implementation: [PR #13](https://github.com/codethread/hive/pull/13), merged as `a56f8c5a5d30df95b175ce4acf4b23b22619c160`, delivers **section 2's agent-guidance slice** through `hv-7q3odu`, not the whole proposal.

Implemented guidance covers the current brief, native acceptance as the sole checklist, consolidated current notes, selective comments and optional linked diary history. New ordinary work leaves `design` and `prerequisites` unused; tracked prerequisites use blocking links. Agent-authored work starts explicitly in draft, with meaningful acceptance before leaving draft and verified acceptance/required children before closure. Useful historical content and governing instructions remain protected. Removing references to already-injected startup context is supporting guidance hygiene, not a new delivery mechanism.

The authoritative repository policy is [Authoring and handing off work](https://github.com/codethread/hive/blob/a56f8c5a5d30df95b175ce4acf4b23b22619c160/docs/beads-meta.md#authoring-and-handing-off-work), with concise local pointers and self-contained portable Hive defaults. Existing customized workflow copies require deliberate, reviewed adoption; normal Beeswax updates do not replace them.

**Limits:** PR #13 preserves existing engine-owned fields and completion contracts, including Busy Bee result notes, settlement intent and structured close reasons. It delivers no native class enforcement, runtime storage/completion redesign, retention/deletion or migration, and establishes no general workflow-producer compliance. The separate native acceptance-carrier work `hv-tdd0r1`, delivered by PR #14, is not part of PR #13. Broader recommendations remain separately scoped; this annotation neither rewrites them nor authorizes their implementation or destructive adoption.

**Status: proposal for ct's review, 24 October 2026.** This document separates agreed workshop direction, recommended architecture and verified current behavior. It does not change policy, code, configuration or existing work, and does not authorize deletion or a database reset.

## 1. Executive decision

Retain meaningful work; stop treating its fields as workflow transport. An ordinary task should explain its purpose, acceptance and durable conclusions without requiring a reader to reconstruct an execution transcript. Put machine coordination in system-description JSON. Keep working history separately, then deliberately compact and retire it only after its important content survives on retained work.

The ordinary field policy below is agreed direction. The architecture, retention protocol and rollout are recommendations requiring approval and implementation, not capabilities already installed. The complete Architect report, **`hv-puh37j`** (request `hv-0ednz1`, run `hv-yaodxg`), supplies the recommended target.

| Decision | Recommendation | Deliberate cost or break |
| --- | --- | --- |
| Ordinary work | Prose brief, native AC, consolidated notes; retain meaningful auto/manual work indefinitely by default. | Generated work cannot be swept away as automation waste. |
| Runtime content | One versioned workflow-system document; one versioned spawn document per request. | Whole-document writes need coordinated ownership/CAS; fewer fields does not mean cheaper writes. |
| Completion | Required authored response → `complete` → `collect`; original result stays in system JSON. | Remove public save-only `record-result` and direct `next`/`choice`; unclassified native closure cannot advance. |
| Lifecycle evidence | Native guarded close plus confirmed system evidence tied to the exact closure. | Accept an explicit closed-but-unconfirmed interval; no inference of success or hidden prose grammar. |
| Failed/cancelled execution | End execution honestly while preserving unfinished native work and unchecked AC. | Settlement no longer assumes every generated task must close. |
| Retention | Reviewed knowledge compaction, then explicit execution retirement, then exact physical purge at a generation rebuild. | Full reports and diagnostics may intentionally be lost; compaction is not lossless summarization. |
| Cutover | New database **containing retained work**, new tracker transport generation, coordinated upgraded writers. | No mixed-version writers, old snapshot merge, automatic executable-checkpoint conversion or blank reset. |

Keep native Beads, XState and Colony's process-safety machinery; rebuild the affected persistence contracts rather than replacing every product. Do not use ephemeral active families as a shortcut. Destructive adoption remains ct's decision. No retention age or automatic cleanup cron is proposed.

## 2. Accepted ordinary-work policy

This applies to work regardless of who creates or performs it: an agent's task, a workflow auto bead or a workflow manual bead. **Auto/manual describes creation provenance, not system classification or dispatch.** A driver-handled visit and a Bee-dispatched visit follow the same work policy.

| Surface | Authoritative content and behavior |
| --- | --- |
| `description` | Current problem, intended outcome, scope and context. Keep the brief meaningful after completion. Update changed intent deliberately; preserve consequential rationale in notes. |
| `acceptance_criteria` | Concrete, verifiable completion outcomes, normally Markdown checkboxes. This is the only acceptance checklist; do not duplicate it in description. |
| `notes` | A compact, current account of what was done, why it matters, decisions and rationale, verification, limitations and handoff. Include unresolved work and next actions while unfinished. |
| Linked diary comments | Optional working history, experiments and intermediate reasoning. Promote important conclusions to the task before handoff or retirement. |
| Task comments | Selective useful conversation capture and short delivery/progress evidence where needed. Distinguish quotations, paraphrases and accepted decisions. No automatic transcript requirement. |
| `design`, `prerequisites` | Leave unused under the new policy. Preserve useful historical contents during migration by moving their meaning to the appropriate retained brief or notes. Model prerequisite work as separate tasks and blocking links. |
| `close_reason` | A readable, proof-bearing explanation of why this work can close, not a machine result or a replacement for the durable account. Nonempty is the agreed native requirement; no substantive minimum length or pattern is selected. |
| Status, owner, assignee, labels | Preserve native authority and existing stewardship. Owner means human accountability; assignee means who is doing the work. Preserve HITL and human reservations. |

### Ordinary lifecycle

1. Create work explicitly in `draft`; configuration can reject another initial status but does not change the CLI's default to draft.
2. Supply meaningful native acceptance before leaving draft. Apply the presence requirement to every permitted departure, not only one convenient transition.
3. Claim only available authorized scope. Parent-child links group work and have native completion/readiness consequences; blocking links express prerequisites. A diary is not unfinished child work.
4. Keep notes current at consequential decisions, handoffs, interruptions and completion. Append convenience does not justify an endless sequence of competing summaries: notes is one mutable string, with no native latest-summary selector or per-entry attribution.
5. Verify the outcomes, then tick only the criteria actually satisfied. Close with evidence when acceptance and required child work are complete. Leave unfinished work open with its blocker or next action.

Native checks can establish presence and recognize unchecked boxes; they cannot establish that criteria are meaningful or true. A nonempty paragraph without checkboxes passed the tested completion predicate. Agents remain responsible for verification. The reported-gate protocol is excluded: its gate results did not travel through JSONL in the experiment.

**Why leave design unused?** The agreed brief/notes split already gives intent and durable rationale a home. Requiring a separate final design account would duplicate notes or make readers guess which is current. This is a field-use policy, not deletion of valuable historical design material.

## 3. Target records and relationships

These are semantic classes, **not new CLI type names or already-registered labels**. Existing label stewardship remains; implementation must register any diary/retirement vocabulary. A `docs` task can be executable work, so its type alone must not exempt it from work gates.

| Record | Content home | Lifecycle / retention |
| --- | --- | --- |
| Meaningful ordinary task, including workflow auto/manual work | Prose description; native AC; durable notes; optional diary | Draft-first work gates. Retain by default, including completed generated tasks. |
| Run or grouping bead | Readable coordination scope, genuine native AC and notes | Driver verifies actual coordination acceptance; Busy Bee owns normal closure. Retain substantive work; a container is eligible only when its useful content survives elsewhere. |
| Workflow system bead | Entire content payload in one versioned description JSON: checkpoint, exact inventory, originals, ownership, settlement, closure evidence | Valid control state, no fake work AC or payload in notes/comments/close reason. Keep until execution retirement. |
| Spawn bead | Versioned description JSON: captured request, latest observations, terminal and resolution evidence | Native status records requested/closed; Bee/Colony own scoped JSON mutations. Keep through settlement and retirement. |
| Response artifact | JSON envelope with complete Markdown body, author, producing task/request and corrections | Non-system, non-executable; immutable while retained. Publish closed with a readable publication reason, not task AC. |
| Development diary artifact | Short prose purpose/anchor description; authored timestamped comments | Non-executable, independently linked history. No work claim/readiness or fake AC. Retire only after its important content is independently retained. |
| Specialist evidence and merge reference | Existing steward-owned representation | Retain unless its owner explicitly defines a safe replacement. Closed does not mean disposable. |
| Retirement receipt / generation manifest | Small system JSON with exact IDs, digests, retained targets and operation state | Product owners establish eligibility; Beeswax coordinates. Retain until a safely superseding generation/archive index. |

**Explicit policy qualification:** draft/AC rules apply to executable work, including generated work and substantive coordination scope, not to system state or non-executable artifacts. This is the Architect's recommended clarification of the workshop's early all-beads wording, not a silent exception already present in policy. Native class-scoped enforcement is required (§8). Unknown classification defaults to retention; contradictory classification fails automation validation.

### Typed relationships

Direction below is source → target. Use supported native types; edge metadata alone is insufficient for discovery because the tested show/list interfaces did not expose it.

| Relationship | Meaning and retention consequence |
| --- | --- |
| Child → parent, `parent-child` | Work scope with native gates, not a deletion graph. Reparent retained children explicitly before removing a container. |
| Dependent → prerequisite, `blocks` | Real execution prerequisite, never an attachment link. Preserve unresolved outside dependencies. |
| Run → workflow system, `related` | Discover exactly one matching live system document; validate run identity. |
| Spawn → assigned run/stage, `related` | Exact captured execution anchor, not all related work. Replacement preserves the assignment. |
| Replacement request → predecessor, `supersedes` | Resolution lineage; predecessor outcome remains historical fact. |
| Response → producing task, `replies-to`; response → request, `related` | Delivery provenance. Retain required endpoints while the exact response reader depends on them. |
| Correction → every previous current response head, `supersedes` | Explicit correction, not newest-timestamp-wins. Ambiguous heads block compaction. |
| Diary → work, `related` | Nonblocking attachment. A diary informing several tasks needs verified knowledge destinations for all of them. |
| Retirement receipt → retained summaries, `related` | Discover compaction provenance; summaries must remain useful without the receipt. |

Use `related` for these new attachment associations while preserving existing merge-reference `relates-to` conventions. Titles make diaries readable; validated class/schema, not title parsing, identifies them. Execution/artifact identity includes tracker identity, generation and native ID. Retained work preserves its native ID with an explicit mapping across reconstruction; purged identities are not reused.

## 4. Busy Bee: current writes to target flow

### What changes

| Current write / reader | Target |
| --- | --- |
| Stage notes hold the original `{choice,data}`; collection parses the entire field. | `results[visitId]` in the system document; ordinary notes are never workflow transport. |
| Checkpoint notes hold invocation ownership. | Typed lock member, acquired and released through whole-document compare-and-set (CAS) against native revision. |
| Run notes temporarily hold settlement intent. | System settlement member plus confirmed/uncertain effect IDs; no prose-note cleanup overwrite. |
| Native close reason holds structured lifecycle JSON. | Readable reason plus joined native closure/system confirmation. Outcome labels remain derived indexes. |
| Default definition renders AC into instructions; creation lacks an AC carrier. | Explicit acceptance through definition → frozen visit → native field; explicit draft creation/promotion. Frozen AC is provenance, not a second editable checklist. |
| Dispatch copies the rendered brief and also tells the worker to read it. | Short assignment/endpoint pointer, preserving delivery/navigation boundaries and exact captured role. |
| New stage dispatch can precede saved inventory. | Persist a `publishing` frontier with created IDs before request creation; admit execution only after stable publication and ownership release. |

Busy Bee still owns XState progression, projection, generated inventory and its system document. Shared owns only the consumed identity/control/evidence schemas and definition-free readers. Colony and UI must use those readers at **all** claim, admission, final-launch, completion and display boundaries. They must not restore a workflow definition merely to determine native completion. Missing or incompatible definitions must not hide lifecycle evidence.

### Illustrative proposed workflow JSON

This is a partial design example, **not an installed schema, accepted command payload or complete snapshot**. Native metadata remains outside it. Actual validation must reject contradictory variants.

```json
{
  "kind": "workflow-system",
  "formatVersion": 2,
  "generation": "g2",
  "runId": "work-run",
  "lock": {"owner": "invocation-uuid", "host": "host-a", "pid": 123},
  "managedExecution": "managed",
  "publication": {"state": "stable"},
  "execution": {"state": "active"},
  "created": [{"bead": "work-visit", "scope": "visit", "node": "work", "visit": 1}],
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
      "closedAt": "2026-10-24T12:00:00.123456Z"
    }
  },
  "settlement": {"state": "none"}
}
```

The real document also retains definition locator/version/hash, actor paths, frozen contracts, snapshot and accepted history. Index originals by **native visit ID**, not node name or request: a loop creates another visit, while an explicit request replacement can target the same visit. Keep original input separate from transformed data actually consumed; no full answers, diary logs or Colony attempt history belong in this ledger.

### Successful completion and collection

1. The worker reads current native scope, AC, identity/reservations and revision; verifies acceptance and files any required authored response.
2. Under per-run ownership, completion validates the original JSON against the frozen outcome contract and permitted transition, saves it once and records the inspected task revision. Equivalent structural JSON retries match; conflicting originals fail. Arrays/scalars and a payload member named `choice` remain valid where the schema allows them.
3. Recheck task authority. Moving the result off the task removes the existing atomic task-CAS/result-write coupling; a system CAS does not replace it. Persist prepared closure evidence, then invoke **native guarded close** against the freshly inspected task revision with a readable reason. A changed scope/AC/assignment requires rereading and revalidation, not blind acceptance of the saved result.
4. Reread successful native closure; persist confirmation bound to run, scope, visit and exact native `closed_at`. Publish derived outcome labels, release through a fresh owner-checked write, and return confirmed effects. Completion does not advance the chart.
5. The driver collects only native-closed visits with matching successful confirmation and original result. Validate the batch before advancing in stable frontier order; consume the original through deterministic schema transformation, never reparse transformed history as input. Keep originals until retirement for retry and explanation.

**Verified correction from the broad Architect report:** installed `br close --help` already exposes `--if-unchanged`. Hive's Beads close interface and Busy Bee call do not consume it; their comment saying native close has no revision condition is stale. The required change is adapter consumption, not invention of native close CAS. It still does not make two records atomic. DB-local event-derived `status_revision` is not a portable closure token.

The target removes public `record-result` and direct `next`/`choice` submission, retaining internal save-before-close recovery. Current code can navigate from some ordinary unclassified closes while Colony refuses them as successful anchors; the target deliberately removes that discrepancy. An external close does not become successful execution merely because a result exists. This is a behavioral break selected by the broad report, not preservation of the first report's narrower compatibility option.

### Uncertain effects and recovery

| Observed point of failure | Required target behavior |
| --- | --- |
| Before original save | No saved-result or completion success; retry after fresh checks. |
| Original saved; native close definitely refused | Preserve original and refusal. Clear only conclusively unperformed intent, release ownership, repair acceptance/authority and retry the identical original explicitly. |
| Native close attempted but reply uncertain, or close succeeded before confirmation failed | Retain prepared evidence and ownership; expose `publication-pending` and exact known/uncertain IDs. No automatic unlock, re-close or success inference. |
| Closure confirmed; label write failed | Repair only the derived namespace; do not repeat closure, replace the result or rewrite unrelated labels. |
| Frontier/tasks/requests partly published | Inspect retained operation IDs and actual effects before resuming. Do not recreate a request or replay external effects from a failed command receipt alone. |

Recovery inspects original result, native closure, prepared intent, command/invocation receipts and ownership. A closed task plus matching readable wording is insufficient proof that the intended operation closed it. If attribution remains ambiguous, leave it unclassified and explicitly plan remaining work; never reopen/reclose to manufacture evidence. Later notes/labels do not invalidate confirmation, but reopen/reclose does. Retain the reason as provenance, not as a required byte-identical machine grammar.

Per-run ownership serializes cooperating writers on one selected database. Refresh the whole document before every owned patch; never overwrite a newer result or fence with a stale snapshot. PID is diagnostic, not permission to expire or steal ownership. Snapshot exchange is not a distributed writer lock. The joined read reports native state plus pending, confirmed, unclassified, publication-pending, inconsistent or retired evidence, with observation stamps—not fabricated atomicity.

### Failed/cancelled execution is not completed work

Persist settlement intent before fresh owning-host execution clearance; hold publication ownership through inventory/clearance/publication. Only explicit unmanaged provenance permits daemon-free settlement. Sleeping Colony, closing a request or exiting the daemon does not prove detached workers stopped. Foreign, unbound or uncertain execution ownership refuses clearance.

Settlement stops progression/admission and records execution disposition. Preserve successful visits and their requests, even if a review chose `changes` or the run later fails. **Leave incomplete native work open/blocked with unchecked AC.** No invented outcome, blanket ticking or force-close. A container closes only when its real coordination acceptance and child gates pass; otherwise it remains retained work even after its execution ends. Reparenting useful unfinished work is separately reviewed, not an automatic settlement side effect.

Consequently Colony's target mapping distinguishes two facts: request success requires a confirmed successful native anchor closure; explicitly failed/cancelled execution can settle its request unsuccessfully while its native anchor remains unfinished. UI and status output must show both, not label an open task completed.

## 5. Bee and Colony: current values, execution and answers

Preserve Colony's existing scheduling, claim/release, reserve-before-launch, supervisor handoff, process ownership and retry mechanisms. Replace storage contracts at their seams; private SQLite still owns attempt checkpoints and useful local diagnostics, not native task truth.

| Current source | Target source and invariant |
| --- | --- |
| Spawn JSON captures recipe/host/assignment. | Versioned generation-bound request JSON retains those facts; exact captured role is not a pointer to today's mutable role file. |
| Colony observation/stdout and manual-attempt comments accumulate. | Latest required JSON members preserve attribution, owning host, observation/recording times and attempt identity. Useful detail remains local. |
| Acknowledgment comment resolves an exact failed closure. | Closure-bound JSON acknowledgment records actor/time/reason; do not migrate it as disposable telemetry. |
| Request close-reason tokens define outcome. | Prepared/confirmed JSON evidence plus native closure; arbitrary external close becomes unclassified, not implicit cancellation. |
| Outcome/resolution labels project facts. | Keep them as indexes, preserving other stewards' labels; missing/stale projection is visible and repairable. |
| Native response envelope and exact links hold the answer. | Keep complete immutable response artifacts while live; add explicit compacted/archived reads after reviewed retirement. |

### Illustrative proposed spawn and response JSON

Partial shapes only; these are not installed input formats.

```json
{
  "kind": "spawn-request",
  "formatVersion": 2,
  "generation": "g2",
  "host": "host-a",
  "assignment": {"kind": "stage", "runId": "work-run", "stageId": "work-visit"},
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

```json
{
  "kind": "response",
  "formatVersion": 2,
  "generation": "g2",
  "taskId": "work-visit",
  "requestId": "spawn-id",
  "author": "bee-identity",
  "body": "# Complete answer\n\nThe authored report is here, not merely a file link.",
  "supersedes": []
}
```

The real spawn retains the captured recipe, identity and execution options omitted from the illustration. A new attempt resets stdout evidence to unknown. Attempt ordinal and retries started are separate. Latest means **latest recorded**, not alive now; a poll with no new observation must not manufacture freshness.

The Architect recommends immediate publication of observed lifecycle/attempt/settlement changes, and changed stdout activity at most once per **60 seconds**, plus first/final observations. This is a proposed throttle, not measured freshness or existing behavior. Detailed local history survives until retirement and incident holds clear, then follows an exact local-artifact manifest; it has no unbounded cross-machine-history promise.

Observation, stop and acknowledgment writers use fresh CAS and preserve each other's members. A prepared terminal mutation has an operation owner/fence; an observation writer cannot confirm or clear it. Uncertain request closure follows the workflow recovery discipline. Competing cross-clone acknowledgment edits require deliberate resolution rather than the current comment-union winner selection.

Only the captured host automatically executes/reconciles. Bind private store authority, receipts and finish reports to generation as well as request/attempt; losing local history is not permission to relaunch. Automatic retries retain request and friendly identity. Explicit retry creates a replacement with a `supersedes` link, preserving the anchor and predecessor's failed outcome; successful replacement creation resolves attention, not history. Uncertain creation returns known IDs and blocks duplicate submission until inspected.

Response availability is independent of acceptance and request success. Correction supersedes every current head; ambiguous heads cannot be compacted by picking the latest timestamp. While retained, exact reads return the actual original and validate provenance. Either preserve all required anchors/lineage or compact the response as a unit. After retirement, return an explicit **compacted** result with retained summary destinations—not a summary pretending to be the old full answer.

## 6. Compaction and retention

### Preserve meaning before removing its sources

Retain meaningful task briefs for the foreseeable future. Before a diary, response, runtime container or system record can go, its important outcomes, decisions, rationale, verification, corrections, failures and unresolved limitations must survive independently on retained work or curated evidence. A link to a soon-to-be-deleted report is not a summary.

Use one consolidated current account, not one summary per attempt. Some reports have enough unique value that the right compaction result is **retain the complete report** or preserve a dedicated knowledge/evidence bead. Smaller is not automatically better. Selective manual conversation capture remains allowed; a speculative quotation does not become an accepted decision merely because it was copied.

The proposed compaction gate is:

1. Read every relevant response head/correction and diary source. Map important facts/sections to named retained destinations; list deliberately discarded detail and why it is dispensable.
2. Write the current brief/notes with revision guards, preserving attribution and fact/recommendation/user-decision distinctions. Record verification precisely enough to understand its scope and limitations after source removal.
3. Have an independent agent verify routine compaction against sources and native acceptance. Human review covers reserved/disputed/safety-sensitive decisions and the destructive manifest; a one-agent operation needs human verification rather than self-certification.
4. Verify the retained account answers what was requested, delivered, chosen and tested, why, what failed, what remains uncertain and who/what is needed next—**without opening a deletion candidate**.
5. Record source/target revisions and content digests, coverage, verifier and approval. Any relevant source, destination or incoming-reference change invalidates approval.

This knowingly permits loss of raw wording, intermediate reasoning or logs after reviewed compaction. It does not claim that summarization is lossless. Native individual-comment deletion is unavailable today; separating future diaries avoids repeatedly filling retained work with independently disposable history. Initial reconstruction can drop selected old comments only through the approved native maintenance projection, not ad hoc editing.

### Worked examples

The IDs, revisions and results in these examples are **illustrative**, not new verification claims.

**1. Ongoing work.** `TASK-CACHE` implements cache invalidation. After the first experiment, notes say: “Content hash chosen over mtime because equal-timestamp replacements reproduced stale reads. Parser unit cases passed at `REV-A`; watcher restart and recovery cases are untested. Next: add restart tests; do not close.” Diary `DIARY-CACHE` holds the attempted timings and rejected prototype. No completion is implied, and no retirement is allowed while those facts remain needed for the active execution.

**2. Interrupted handoff.** Before yielding, the worker adds: “Implementation is in worktree X at `REV-B`; the restart case fails after interrupted rename. No deployment occurred. AC 1–2 verified, AC 3 unchecked; next owner must reproduce the failure before changing recovery.” The successor reads current native scope/AC/notes, discovers the diary through its typed link and opens only the relevant experiment. Completion-only summarization would have lost this handoff; updating notes at the interruption preserves it.

**3. Historical reading before and after purge.** After successful delivery and independent compaction review, retain this substantive account on `TASK-CACHE` **before** deleting any attachments:

> **Outcome:** content-hash invalidation replaced mtime-only invalidation at `REV-C`. Scope was the local file cache; remote cache coherence was excluded.
>
> **Why:** equal-timestamp content replacement could otherwise serve stale data. A watcher-only solution was rejected because missed events still needed recovery.
>
> **Verification:** the focused cache suite passed all 12 cases at `REV-C`, including equal-mtime replacement and interrupted-restart recovery; package typecheck passed. No network-filesystem benchmark was run.
>
> **Correction and limitation:** the first report overstated cross-filesystem coverage; the corrected conclusion is local-filesystem behavior only. Notes retain that correction, not the discarded claim.
>
> **Remaining work:** `TASK-NETFS` is still open for network-filesystem validation; this task's closed acceptance did not include it.
>
> **Provenance:** implementation and corrected report authored by worker A; compaction checked by verifier B on date D. Execution G1/run R was retired after collection and owning-host clearance. Original diagnostic detail may no longer be available.

| Surface | Before physical purge | After physical purge |
| --- | --- | --- |
| Retained task description | Meaningful original/current scope | Same scope retained. |
| Native AC/status/close reason | Verified completed scope; readable reason | Preserved; no new success inferred from deletion. |
| Notes | Complete account above, verified against sources | **The same substantive text**, independently useful; no dead-link-only proof. |
| Diary and corrected response lineage | Exact originals still readable | Removed only if named in the approved manifest. Exact reads say compacted and identify retained destinations. |
| Follow-up `TASK-NETFS` | Open with its own AC/dependency context | Still open; neither summary nor purge closes it. |

A historian can answer why content hashing was chosen and what was not tested from the retained task. They cannot recover every discarded timestamp or original sentence, and the reader says so. If exact wording is important, retain the report instead of approving this deletion.

**4. Failed/cancelled run.** Run R produced a successful design review, then its implementation visit failed before migration. Keep the review outcome and its caveats; keep implementation AC unchecked and notes explaining the failure, known effects and next action. Resolve request attention explicitly, prove workers stopped and collect or deliberately dispose saved results as unconsumed. Execution retirement may then remove R's machinery while retaining the unfinished task under reviewed surviving scope. If an external migration effect remains uncertain, retirement is refused until that uncertainty is resolved—not reset to “not attempted.”

### The coherent retirement boundary

Execution retirement is distinct from a workflow visit leaving the active frontier, unsuccessful settlement, task closure and physical deletion. It ends the execution's retry/attach/complete/collect/settle/simulation capabilities. A future attempt at unfinished work requires a deliberately inspected new execution, not resurrection of the retired one.

Before retirement, require all of the following:

- Complete generated inventory and known effects; every saved result collected or explicitly retained as unconsumed under terminal execution. No unresolved closure/progression uncertainty or unexplained publication owner.
- Terminal, operationally resolved driver/stage/replacement requests, no pending delivery and no ambiguous response corrections. Acknowledging a failure does not satisfy its unfinished task.
- Fresh owning-host proof of no live/unverified attempt, pending reservation, finish report or claim-release obligation; all manual/incident holds resolved.
- Retention of meaningful auto/manual work, unresolved tasks, human reservations, specialist evidence and merge references. Open ancestors need not finish merely to permit a settled family to retire.
- Verified knowledge coverage and all outside references accounted for. A retained exact response pins its required lineage; do not leave it malformed by deleting an anchor.
- Reviewed parent/link rewrites for retained children of removable structural containers; preserve meaningful grouping rather than flattening it for convenience. Apply the governing-context check below before any container removal or reparenting.

**Governing-context check.** Inventory effective native `agent_context` and applicable ancestor prose instructions for every affected retained child, with source IDs and authority attribution. Preserve still-applicable instructions in a surviving governing home or retain the container; historical notes alone do not keep a restriction governing. Verify the resulting ancestor chain for both lost and newly inherited constraints. An unresolved conflict, authority change or instruction loss blocks the rewrite/removal pending its proper decision-maker.

Current `docs/beads-meta.md:104` guidance distinguishes emission from scope: when enabled, native inherited-context emission selects the root ancestor (preferring the topmost epic) and immediate parent, not every intermediate ancestor. Hive currently disables emission; agents still explicitly read applicable ancestor instructions. Preserve native governing metadata where it applies, without repurposing workflow-system JSON or changing the selected ordinary-field policy.

Publish and verify the retirement receipt and system retired state **before** deletion. Reads distinguish current, retired-with-detail, compacted and archived/unavailable records; known removed IDs resolve through exact receipt/index entries. Absence alone never proves retirement. Native tasks can remain unfinished after their execution retires.

### Exact manifest, never cascade

The manifest is the reviewed operation, not a query like “all closed workflow beads.” It contains:

- tracker/generation/operation identity; exact source IDs, class reasons, revisions and digests;
- retained destinations, knowledge coverage, source-to-retained mapping and summary digests;
- exact deletions and parent/link rewrites, including inbound/outbound typed edges and known embedded references;
- before/after governing-context mapping: affected children, ancestor chains, source IDs/revisions and authority attribution, native `agent_context` and applicable prose instructions, surviving governing homes and verified effective constraints;
- response heads/lineage, native closure/collection facts, request/attempt clearance and preserved reservations/holds;
- archive disposition, actor/verifier/approval and phase-by-phase confirmed/uncertain effects.

For the cache example, an approved manifest might retain `TASK-CACHE` and `TASK-NETFS`, reparent a useful visit to a surviving feature, and delete exactly its reviewed diary, response lineage, run/group shells, workflow system record and resolved request lineage. It must not recursively add an outside dependent merely because that would make deletion easier.

Recheck the affected reference set, not only row revisions: a newly added incoming link invalidates the plan. During the maintenance freeze, verify snapshot/edge digests immediately before applying. Native `--cascade` follows blocking dependents and can select ancestors; it is not containment cleanup and is excluded. Verify resulting records, edges and export, not only a successful command exit.

## 7. Breaking cutover and clean-reset implications

### Recommended path: rebuild from retained data

Use one maintenance coordinator, a finite enrolled writer fleet and a **new tracker generation built from a verified retained projection**. Keep deletion knowledge within the current generation; do physical reclamation at the next coordinated reconstruction. No independent host hard-purge, tombstone TTL or automatic cleanup-on-close.

Why this boundary: soft deletion retains payload; plain import of an absent record need not delete the receiver's copy; native merge can recreate a full tombstone; sufficiently stale data can return after deletion knowledge disappears. In the workshop fixture, tombstone-first import preserved the receiver's comments, a subsequent no-op flush did not re-export them, and a later merge refused `DeleteVsModify`. These are different sequences, not proof of a working purge protocol.

A new generation rejects old snapshots and common bases instead of trying to invent convergent comment-pruning semantics. This is an explicit transport/storage capability to build and validate—not something one successful tracker sync establishes today.

### Cutover sequence and stop conditions

1. **Prepare and inventory.** Enumerate selected databases, publishers, direct agent sessions, hooks, worktrees, Colony registrations/daemons, detached supervisors and backup/restore routes. Resolve tracker incidents. Approve exact manifest, policy, tool versions and retained projection. A local lock or sleeping Colony is not a fleet freeze.
2. **Drain and freeze.** Finish old live work with matching old tools where practical. Otherwise stop/quarantine explicitly and preserve completed/uncertain effects. Pause all writers/importers/publishers; verify process ownership and termination. Every online enrolled host acknowledges the same freeze/digest; unavailable hosts are revoked from the next generation, not presumed acknowledged.
3. **Reconcile and back up.** Reconcile outstanding same-generation work with native conflict handling; stop on conflicts. Capture and verify an immutable **pre-mutation** backup of database, export/base, links, policy and required private receipts before summary/reparent/tombstone changes. This is the pre-activation rollback source. Offline unpublished work is deferred to reviewed salvage, not silently lost.
4. **Compact and communicate retirement.** Verify summaries/coverage, then publish the approved retirement/tombstone set with one fixed provenance through native operations. Confirm online participants received that exact set. G remains full-payload read-only evidence; hosts do not invent competing deletion timestamps.
5. **Construct G+1.** Use supported native reconstruction tooling, to be implemented where ordinary import is insufficient. Preserve retained IDs, scope, AC, state, owner, human assignment/reservations, meaningful dates, labels, closure meaning and surviving links. Preserve native `agent_context` and applicable ancestor instructions in the manifest's surviving governing homes. Apply only approved summary, governing-context, parent/link and content-retention transformations. Unknown/uncompacted records stay in full. No hand-edited live JSONL or runtime SQL purge.
6. **Verify before activation.** Compare exact retained IDs/fields/edges and summary digests; test retained response retrieval and explicit retirement reads, unfinished work, native gates, export/reimport and fresh-clone hydration. Verify the before/after governing-context mapping against reconstructed native metadata and full ancestor chains, checking lost and newly inherited constraints. Keep writers disabled until verification passes.
7. **Activate once.** Switch the accepted generation/transport descriptor with coordinated compatible tools. Use a **new tracker Git repository/history**, not an old/new `tracker/state` merge. Preserve the permanent local tracker checkout identity/path through a controlled migration; do not casually delete it. Record the activation point and admitted writers/attempts.
8. **Rejoin and reclaim.** Upgraded hosts verify generation, manifest digest and minimum protocol, then reseed. Returning stale hosts export unpublished old work into quarantine for explicit salvage; accepted remaining work is reconstructed deliberately, never imported as a whole old snapshot. After approved rollback-window/archive review, remove only manifest-listed old DB/base/export/backup and local Colony artifact families. Verify no active registration or restore route points to G as writable authority.

### Generation enforcement must be real

Require generation in database/export manifests, native import/merge admission, Hive invocation/receipts and transport selection. Missing/mismatched generation rejects mutation/import before effects; no “legacy means current” fallback. The standalone Git merge adapter must also reject incompatible generations rather than implement a different deletion policy.

A new marker cannot make old binaries obey. Retire old writable paths and runtime binaries, revoke old publication credentials/targets, and grant G+1 transport only to enrolled upgraded publishers. Archive old tracker repositories read-only. If old publishers cannot be fenced or execution cannot be proved stopped, **do not activate**. This is an operational guarantee for cooperating tools/hosts, not a security boundary against a privileged same-OS-user bypass.

### What a clean reset does—and does not—mean

A clean database is recommended; a blank loss-of-history reset is not. Retain every unresolved ordinary record and meaningful completed work by default. Preserve human assignments unless that human authorizes release. Native reconstruction needs explicit identity/chronology preservation and validated source mapping, not recreation of everything as newly open work.

Legacy workflow close JSON may be converted to its readable reason only with verified migration/retirement evidence preserving its disposition. Do not infer success from chart `done` or labels. Retain useful generated visits and reparent only under the approved scope mapping. Keep exact response lineages whose knowledge is not safely compacted.

Do not automatically convert executable old checkpoints into new live snapshots. New runs receive only inspected remaining scope and evidence of already-performed effects. Unknown processes or uncertain irreversible effects block activation for that scope; there is no requirement to purge every old record for cutover to count as successful.

Keep one checksummed read-only G archive for rollback/provenance, separately governed and never a live merge source. New G+1 clones need not fetch G's history. Current-generation retirement receipts support exact-ID lookup; later reconstruction can move them into a read-only generation index. If the archive is subsequently deliberately discarded, exact old-detail reads must say unavailable. Permanent forensic logs or old workflow previews are not promised.

A fresh DB does not erase Git objects, remote clones, backups or logs. Lossless packing is not erasure. Secure historical erasure requires a separate authorized fleet/provider/backup operation.

### Rollback and coordinated adoption

Before G+1 admits any writer, attempt or external effect, discard a failed candidate and restore frozen G with matching tools. **After activation, switching back to G is not rollback:** it can lose new work and replay effects. Stop G+1, preserve its changes and repair forward, potentially into another generation. Archive restoration always enters quarantine and never automatically wakes Colony.

Ship native policy/reconstruction support, Beads/Shared contracts, Busy Bee, Bee/Colony, UI, Beeswax/BV adapters, definitions, hooks and installed guidance together. Verify actual executable provenance and daemon versions, not only checkout revisions. No dual writes, old-comment/notes fallback, mixed-format admission or automatic legacy snapshot conversion. Read shipped changelog/adoption actions after upgrading. Cross-clone destructive authorization and rehearsal remain prerequisites, not completed work in this proposal.

## 8. Native YAML: supported today versus required extension

The ordinary-work predicates exist, but **the combined work/system/artifact policy cannot be installed faithfully with today's YAML**. The disposable enforcement experiment used installed `br 0.7.6`; source comparison was the Hive snapshot-sync fork at `b77ae70`.

| Requirement | Verified current capability | Required action |
| --- | --- | --- |
| Draft-first work | Strict `workflow.transitions.initial: [draft]` rejects implicit open creation. | Change every work producer to pass draft; scope this policy to work in the native extension. |
| AC before leaving draft | `workflow.required_fields` accepts exact `from -> to` keys or a bare target status; `acceptance_criteria_present` tests the dedicated field. | Cover every allowed departure. Do not invent wildcard transition syntax. |
| Completed AC before closure | Target `closed: [acceptance_criteria]` checks the dedicated field. | Prefer this over the older closure checklist gate that also scans description/design/notes. Agents verify truth. |
| Nonempty close reason | `close_policy.require_close_reason` with `enabled: true`, `min_length: 1`. | Scope the requirement to applicable prose records; system payload stays in description. One character expresses presence, not a new quality rule. |
| Work versus machine/artifact behavior | No class/label selector on these required-field or close-reason gates. | Add a small native record-class policy extension; do not put fake AC on system records. |
| Special creation routes | `entry_routes` admitted system/open and response/closed in the fixture. | Creation exceptions do not exempt later closes: the admitted system record still failed global closed-AC requirements. |
| Born-closed artifact validation | An admitted response was created closed without AC or a close reason. | Validate initial/terminal creation coherently in the new class contract; ordinary close checks cannot be assumed to run during creation. |
| Keep design/prerequisites unused | No native field-prohibition setting found. | Guidance and owned writers enforce this; do not add a prerequisite-completion requirement. |
| Label stewardship | Existing taxonomy and tool ownership remain in force. | Classification needs validation, not an informal new label that bypasses work gates. |

Do not substitute conditional reported gates: they are a different feature and were rejected for this policy. Additive class transitions also do not supply field/closure scope. The extension must reject ambiguous classification and attempts to evade gates by reclassifying executable work, and test create, update, claim and close together. This document intentionally supplies no invented installable YAML for that extension.

## 9. Graph, read, write and storage costs

### Read topology first; hydrate selected content

The experiments support linked history at the tested scales, not unlimited attachment traversal. Discover typed neighbors and relevant families first, deduplicate IDs, then request only needed bodies. An attachment reader needs width and byte budgets, explicit continuation and freshness, not merely a depth limit. Graph timings below are three-sample local observations after fixture creation warmed storage, not latency guarantees; setup and browser rendering are excluded.

| Measured case | Observation | Boundary |
| --- | --- | --- |
| 5,000 thin records | BV full JSONL graph about 46 ms median; native full show of 100 records about 3.7 s. | Different work, not an equivalent-operation speed contest. |
| 1,000 records with 40.7 MB of bodies/notes/comments | BV graph about 63 ms; show of 100 about 6 s. | Topology output avoids delivering all text, but BV still reads its selected whole file. Root/depth limits bound output, not that input read. |
| Dense 100-node, 4,950-edge graph | Depth-ten tree emitted 9,046 occurrences / 1.26 MB. | Tree can repeat nodes; its `parent_id` is a traversal predecessor, not proof of containment. Depth one cannot bound a broad star. |
| Rooted 1,000-node blocking chain | Native rooted graph timed out at 12 s in all three samples; all-graph/BV paths took about 23–31 ms. | A focused endpoint finding, not a claim that every native graph operation is slow. |
| Actual UI hierarchy helpers | About 124 ms for 1,000 parent-child nodes; 824 ms for 5,000, hydrating summaries in batches of 500. | Browser rendering and full board decoration were not measured. Related diaries are outside this hierarchy. |
| Brief/notes projection fixture | Historical full show: 3,544 compact JSON bytes; selected historical fields: 659 bytes. | Output reduction, not storage reclamation or a substitute for full pickup authority/context. |

`br graph` omits `related` and `replies-to`, and interprets parent-child for execution order; it is not an attachment index. Native dependency lists expose typed direct neighbors. Tree omits edge types. BV includes the tested relationship types, but a newly linked, unexported diary was missing from its older JSONL while present in native reads/BV SQLite. Preserve the UI's before/after native freshness checks; BV's own loaded/not-stale report did not establish export coverage.

Full `br show --json` includes all attached comments and has no field selector. Exact-ID native list projection can omit comment bodies; comment-list filtering happens after retrieving the whole array. Therefore a separate diary improves ordinary pickup context even before deletion. Discovery also changes after compaction: ordinary search found comment text but not notes-only text in the fixture. Retained-summary search must explicitly cover notes, not promise unchanged keyword search after deleting a diary.

### Latest-only writes reduce accumulation, not necessarily write cost

Twenty sequential small observations on disposable trackers produced these results:

| Initial payload | Append comments | Replace latest JSON member | Median write time |
| --- | --- | --- | --- |
| 16 KiB | 20,616-byte JSONL; 20 comments | 16,838 bytes; no comments | 48.0 ms versus 46.7 ms |
| 256 KiB | 266,377 bytes; 20 comments | 262,599 bytes; no comments | 54.8 ms in both modes |

The probe saved roughly 3.8 KB of comment/record overhead, with no per-description-edit audit rows observed. Paired SQLite allocations were identical. It included native auto-export and subprocess capture, but no lock/CAS cycle, contention, production ledger, network or physical reclamation test. Retain no-op suppression and coalescing; benchmark the proposed whole-document ownership/result workload separately.

### Keep cost layers separate

The 22 October census attributed about 73% of snapshot bytes to **system plus non-system workflow buckets**, not deletable waste. Workflow briefs and authored responses contain valuable evidence. Another census found 1,889 captured role prompts with 32 distinct values: roughly 6.19 MB of theoretical exact-value redundancy before reference overhead. This motivates prompt review, not replacing captured instructions with mutable files.

On a disposable copy, native reconciliation took 39.6–40.9 s, including an unchanged repeat; the core three-way calculation was about 75 ms. Whole-state loading/witnesses/publication dominated. Physical compaction reduced roughly 243 MB to 134 MB without improving merge time. Retention may reduce the logical population, but no end-to-end retention speedup is established.

Live rows, current JSONL/native base, SQLite allocated pages, `.br_history`, Git history and Colony's local artifacts are different stores. Removing one diary does not erase old snapshots, compact SQLite or clean local logs. Do not weaken recovery witnesses to improve a benchmark. Native correctness-preserving unchanged/incremental merge work remains a separate performance opportunity.

## 10. Scoped implementation order and acceptance

These are bounded proposed work packages, not newly created tasks or authorization to start them. Keep each slice focused; split a growing package by contract rather than building a general persistence platform.

| Order / owner | Deliverable | Acceptance boundary |
| --- | --- | --- |
| 1. Native Beads + Beads adapter | Class-scoped policy; consume existing close CAS; generation admission and native reconstruction contract | Generated work cannot evade draft/AC through reclassification; artifacts have coherent creation/closure without fake AC; stale close fails atomically; incompatible generation refuses before writes. |
| 2. Shared + Busy Bee | New workflow document, native AC carrier, one completion path and joined evidence | Preserve original versus transformed data; notes never parsed/overwritten; unclassified close cannot advance; identical retries work after collection. |
| 3. Busy Bee + Colony | Publishing-frontier/admission fence and honest unsuccessful settlement | No launch crosses publishing/settlement/retirement; partial IDs survive; prior successful stage stays successful; unfinished AC/task stays unfinished. |
| 4. Bee/Colony + Shared | Versioned spawn JSON, observations/acknowledgment/closure, response contract and generation-bound attempts | Races preserve scoped members; foreign/stale attempt denied; closure is not process-stop proof; exact response bodies/corrections remain readable. |
| 5. UI + Shared + viewer/tool owners | Bounded projection/search and current/retired views | Notes searchable; typed links/continuation/freshness explicit; useful generated work visible; missing definition does not hide lifecycle facts. |
| 6. Product owners + Beeswax + native maintenance | Plan-only retirement, semantic coverage, exact manifest and reconstruction | Outside links/late edits invalidate approval; unresolved delivery/process uncertainty blocks retirement; retained scope and IDs survive; no cascade. |
| 7. Operator + Beeswax | Disposable fleet rehearsal, then separately approved generation cutover | Old tool/credential, offline host, mixed base and old backup cannot enter G+1; fresh clone verifies; phase recovery and rollback boundary hold. |
| 8. Bookworm + tool owners | Accepted guidance, help, definitions, prompts and release/adoption notes | One authoritative home per rule; composed prompts have no stale notes-as-result or alternate-completion instructions. |

**Cross-cutting acceptance scenarios:**

- Two parallel completes and a collector cannot lose results or clear another owner; a loop revisit has a new native identity.
- Interrupt every boundary: original save, prepared intent, native close, confirmation, labels, frontier/task/request publication. Preserve known versus uncertain effects; never replay an irreversible effect merely because a response failed.
- Edit brief/AC/assignee between save and close; CAS refuses stale closure. Reopen/reclose invalidates the old confirmation; later legitimate notes edits do not.
- Review chooses `changes`, then run is cancelled: prior review/request success remains, useful incomplete work stays open, no human assignment changes.
- Concurrent observation/stop/acknowledgment, stale finish report and absent private ownership proof do not create liveness, erase resolution or launch replacement work.
- Two response heads, a retained response with a purge-candidate request, an omitted caveat, an open manual child and an outside blocking dependent all prevent premature deletion.
- Add a comment or incoming edge after review: manifest approval invalidates. Retirement before collection, driver cleanup or supervisor exit refuses.
- Freeze/apply interrupted at each phase, tombstones on only one peer, old backup restore and indefinitely offline clone have explicit non-resurrection outcomes through the **actual Hive publication path**, not only native fixture merges.
- Fresh reconstruction preserves meaningful IDs/chronology, native acceptance/state, human reservations, surviving edges and summaries. Exact response reads distinguish original, compacted and unavailable detail.
- Retain an unfinished child while removing its parent carrying “No production writes.” Exercise both native `agent_context` and ancestor-prose variants: the restriction remains attributable and governing after reconstruction, not merely archived in notes. Test enabled root/topmost-epic and immediate-parent emission plus explicit reads of other relevant ancestors, then Hive's emission-disabled manual ancestor-read path. An unmapped loss or newly inherited conflict/authority change blocks the rewrite/removal.
- Realistic large ledgers/recipes/diaries are benchmarked through public boundaries for serialized bytes, native calls, CAS latency, p50/p95 read/merge latency, RSS, row/event counts and Git/local/archive growth. Small latest-only writes are not a throughput acceptance substitute.

For ordinary reads, adopt the Architect's proposed 50-record/50-relations-per-direction pages with explicit continuation and a documented byte budget (its example is 128 KiB). These are target defaults to implement and test, not current universal CLI flags. Never truncate an exact body silently; full selected responses remain retrievable. Backend operations lacking paging must gain it or expose their unbounded cost. Prefer native indexed notes-aware search; until available, an honest bounded union of description/comment and notes queries must preserve deduplication and continuation.

Current and retired UI views must retain meaningful generated work, hide only appropriate system/artifact/coordination clutter, and expose archived-execution provenance separately from task status. Generation/export digest join source/cache identity. Keep native SQLite ranking and exported JSONL topology distinct; viewer filters do not become scheduling authority.

## 11. Risks, tradeoffs and unresolved facts

| Risk or tradeoff | Recommendation and remaining fact to establish |
| --- | --- |
| Closed-but-unconfirmed interval | Accept it explicitly rather than retain machine close-reason grammar or build a general transaction engine. Rehearse recovery and measure incidence; never infer confirmation. |
| One large system document | Simpler ownership, stronger retention coupling and potentially larger CAS/export writes. Benchmark realistic histories; split long-lived executions at deliberate continuation boundaries, not by silently trimming required originals. |
| Summary loses an important caveat | Require coverage review, self-contained retained meaning and independent verification. Default to retaining uncertain material, not forcing a size target. |
| Full report or log deliberately disappears | Exact-reader contract must say compacted/unavailable. Raw wording cannot be reconstructed from a summary; preserve it when that matters. |
| Stale clone/backup reintroduces data or effects | Enforce generation and transport admission, quarantine salvage and no automatic wake. Current Hive does not yet provide the validated protocol. |
| New native capability scope grows | Build class-scoped gates, guarded-close consumption, projection/search and reconstruction as bounded seams. Avoid a new scheduler, distributed transaction engine or independent comment-GC merger. |
| Class exception weakens ordinary policy | Validate class plus representation at creation/transitions; reject reclassification evasion. Generated work and executable documentation tasks remain ordinary. |
| Failed execution leaves open run/container | Intentional truthfulness, not a cleanup defect. Separate execution disposition from task acceptance in readers and continuation guidance. |
| Search loses diary facts after compaction | Notes-aware search is required; existing ordinary search did not cover notes-only findings. |
| Existing historical evidence is heterogeneous | Preserve unknowns and curated specialist/merge references in full until their owners approve a replacement. No volume percentage establishes deletion eligibility. |

The broad Architect report deliberately resolves options left open in the first focused report: class exemptions, a single completion path, revision-guarded joined evidence, publishing-before-dispatch, unfinished work after unsuccessful settlement and generation-based physical purge. These are explicit proposed breaks, **not unresolved contradictions between the reports**.

Remaining implementation facts include actual fleet/credential inventory, selected archive access and eventual disposal rules, native reconstruction preservation guarantees, real large-ledger/CAS performance and end-to-end cross-clone purge/rejoin behavior. No retention interval, physical-reclamation promise or performance improvement is established. The native class-policy gap and existing unguarded adapter call are verified, not questions to handwave away.

The proposal is ready for adoption review; implementation and destructive cutover require separate authorization. The parent owns final review/presentation, complete checks where applicable, commits and landing. This report changes none of those authorities.

## Appendix A. Evidence and authoritative homes

### Evidence ledger

Current implementation references below are relative to canonical `/Users/ct/dev/projects/hive` at **`020d38baddd4c82aefd70da9a7158b1c8ea55dcb`**, confirmed during this synthesis. The workshop checkout is the older **`186da413144705420e3da42f66d19680d111bb77`** plus untracked research artifacts; it is not the source of current runtime claims. Local evidence filenames below are relative to this proposal's workshop directory. Historical reports retain their own revisions and limits.

| Evidence | Retained source | What it supports |
| --- | --- | --- |
| Agreed intent and corrections | `BEADS-POLICY-NOTES.md:1`; workshop `hv-igexmh` under `hv-2ezek8` | New top sections supersede historical alternatives. Proposal authority is separate from destructive-action authority. |
| Focused Busy Bee architecture | Native response `hv-j43n80`, request `hv-y0jkkh`, run `hv-4xwxog`; `BEADS-BUSYBEE-ARCHITECT-REPORT.md:1` | Complete Busy Bee write/consumer inventory, original-result semantics, joined-evidence tradeoff and publication ordering. |
| Broad architecture | Native response `hv-puh37j`, request `hv-0ednz1`, run `hv-yaodxg`, author `chocolate-grand-sparrow`; final request outcome **succeeded**, verified with `bee result` | Selected full target: explicit classes, single completion path, guarded joined evidence, honest unsuccessful settlement, retirement and generation cutover. |
| Current automation inventory | `BEADS-AUTOMATION-WRITES.html:1` | Busy Bee/Bee/Colony producers and downstream consumers at the canonical revision above. |
| Native enforcement | `BEADS-POLICY-ENFORCEMENT-EVIDENCE.md:1`; `BEADS-POLICY-ENFORCEMENT-EXPERIMENT.json:1` | Disposable draft/AC/reason/entry-route tests; no label-scoped field or closure gates. |
| Latest-value probe | `BEADS-AUTOMATION-WRITE-EVIDENCE.md:1`; `BEADS-AUTOMATION-WRITE-EXPERIMENT.json:1` | Bounded storage/write observations, not CAS throughput or physical reclamation. |
| Graph discovery/hydration | `BEADS-GRAPH-PERFORMANCE.html:1`; `BEADS-GRAPH-EXPERIMENT.json:1`, `BEADS-GRAPH-SUPPLEMENT.json:1`, `BEADS-GRAPH-HYDRATION.json:1`, `BEADS-GRAPH-FRESHNESS.json:1`, `BEADS-GRAPH-TIMEOUT-CONFIRMATION.json:1` | Typed-link coverage, repeated traversal, output versus input budgets, selected topology/hydration timing and freshness limits. |
| Fields, relationships and pruning | `BEADS-JSON-READING-EXPERIMENT.json:1`, `BEADS-RELATIONSHIP-EXPERIMENT.json:1`, `BEADS-JSONL-PRUNING-EXPERIMENT.json:1`, `BEADS-GATE-EXPERIMENT.json:1` | Projection/search differences, supported links, local deletion and receiver behavior, nonexported reported-gate evidence. |
| Tracker growth | Native response `hv-shvp84`, report task `hv-9jqdeq`; `BEADS-TRACKER-GROWTH-PRIOR-REPORT.md:1` | 22 October census and isolated native merge/disk measurements. |
| Retention research | Native response `hv-iy8u3v`, report task `hv-pvqi7x`; `BEADS-RETENTION-PRIOR-REPORT.md:1` | Native merge/import asymmetries, stale reintroduction, storage layers and current API limits. |
| Ephemeral-family precedent | Native response `hv-07n1lr`, report task `hv-9yi08m`; architecture `hv-uxs2bx` | Referenced prior investigation of local execution families; not a validated fleet purge protocol. |
| Historical field rationale | `BEADS-FIELD-HISTORY.json:1`; focused report cites `hv-hb71ub` and `hv-8focnc` | Preserve original-result and ownership guarantees, not accidental field placement. The comments-research request `hv-0qzrzx` delivered but failed workflow completion; delivery is not success. |

Measurements are prior disposable experiments, not rerun here. The native build used for the main probes was `br 0.7.6`, Hive snapshot-sync source `b77ae7094e9fde7cba304ba00d306ec483c6bdd2`; a version string alone does not independently identify every installed binary's revision. No full networked, concurrent Hive purge/cutover validation has been performed.

### Current source anchors and future documentation homes

| Home | Current evidence / approved-change destination |
| --- | --- |
| `GLOSSARY.md:1` | Shared identity, task, response, system and workflow vocabulary. Any new record class needs an explicit definition rather than quietly renaming all generated records. |
| `docs/architecture.md:1` | Package ownership and current native closure authority. Record the joined-evidence change here after approval; keep engine details in the specification. |
| `lib/busybee/SPEC.md:1` | Authoritative workflow identity, progression, result, closure, settlement and checkpoint contract. |
| `lib/busybee/src/runtime.ts:392`, `lib/busybee/src/runtime.ts:944`, `lib/busybee/src/runtime.ts:1223`, `lib/busybee/src/runtime.ts:1636` | Current result persistence, original-input retry/read and generated completion/dispatch prose. |
| `lib/busybee/src/native.ts:116`, `lib/busybee/src/native.ts:271`; `lib/busybee/src/settlement.ts:331` | Native creation/closure and run-note settlement intent. The stale close-CAS comment requires correction with the adapter implementation, outside this prose-only scope. |
| `lib/beads/src/service.ts:28`; native `/Users/ct/dev/projects/beads_rust/src/cli/commands/close.rs:41` | Adapter lacks the native guarded-close option confirmed in installed `br close --help`; extend the consumed seam rather than claiming native lacks it. |
| `.workflows/do-work/workflow.ts:22`; `lib/busybee/src/definition.ts:16` | Definition-to-visit acceptance gap and repeated request/checklist rendering. |
| `lib/shared/src/workflow-lifecycle.ts:29`; `lib/colony/src/workflow-anchor.ts:25` | Current structured close-reason authority and Colony anchor/admission consumers. |
| `docs/agents/spawn-requests.md:1`; `lib/shared/src/spawn-request.ts:1` | Request outcome versus resolution, owning-host authority, acknowledgment and replacement. Update contract and all readers together. |
| `lib/colony/src/observations.ts:1`; `lib/colony/src/requests.ts:1` | Current observations/acknowledgment and label publication. |
| `docs/agents/responses.md:1`; `lib/colony/src/response-store.ts:412` | Authored response/correction provenance and current born-closed JSON artifact creation. |
| `lib/colony/src/response-protocol.ts:1`; `lib/shared/src/response-protocol.ts:1` | Composed delivery guidance: shared target pointer versus general role protocol. |
| `lib/hive-ui/server/data.ts:48`; `lib/hive-ui/server/api.ts:142`; `docs/design/hive-ui.md:1` | Workflow identity/outcome projections and UI topology/freshness contract. |
| `docs/beads-meta.md:1`; `docs/beads-labels.md:1` | Ordinary field/reference guidance and existing label stewardship. Field guidance changes; stewardship is retained. |
| `docs/beads-integration.md:1`; `lib/beeswax/src/beads/publish.ts:132` | Tracker publication/recovery policy and native reconciliation path; home for approved generation/rejoin behavior. |
| `AGENTS.md:1`; execution/authoring tool help | Keep only routing and short pointers on the agent hot path. Detailed class/retention/recovery procedures belong in their owning guides and tool contracts. |

### Composed-prompt audit

Current composition repeats a request in the run brief, workflow context and stage instructions. Busy Bee adds completion/discovery prose, then copies the rendered stage description into a dispatch prompt that also tells the worker to read the stage. Bee appends a common delivery protocol to the captured role; assignment instructions add the response target. This is observed composition, not proof that every stored duplicate is dispensable.

The target should render the operative brief and native AC once, dispatch a short run/stage/endpoint pointer with the worker's navigation boundary, and keep delivery mechanics in tool help plus one shared target pointer. Preserve exact captured role/provenance and frozen visit inputs where consumers genuinely require them; current native briefs remain authoritative for work. Do not replace captured text with mutable current files or let a frozen copy override later scope corrections. Inspect the composed result across sources, rather than pruning each prompt in isolation. An immutable shared prompt store is optional later work, not a prerequisite or an assumed lossless optimization.

This proposal is the review artifact; it does not become an always-loaded agent rule. After approval, its relevant decisions should be encoded once in the homes above, with concise discovery pointers. The HTML body is a presentation of this same proposal, not a second policy authority.
