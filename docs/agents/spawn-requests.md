# Spawn state and native queries

Read this contract before inspecting spawn requests, interpreting failures/supersession, retrying work or changing lifecycle publication. Access to automation-owned `system` + `bee` beads requires an explicit Bee/Colony operation or system-maintenance assignment; see [label authority](../beads-labels.md#taxonomy).

## Facts and authority

Submission captures the requesting machine's hostname. Only that host's Colony may dispatch, claim, observe, settle or repair the request automatically; manual `colony launch` enforces the same binding. Automatic attempts retain it; a changed native host invalidates retained authority. `bee retry` binds its replacement to the submitting host.

`bee status` exposes the host. Missing provenance appears as `null`/`unbound`. Foreign and unbound requests remain inspectable but are not automatically adopted, including label repair. Explicit stop, acknowledgment and retry remain operator actions. To execute unbound queued work, deliberately close the old request and submit from the intended host.

Native status answers whether work remains requested. Spawns stay `open` through execution; task status belongs to their linked work. Closure records intent or settlement, not proof that a process stopped.

Every produced spawn has one `bee-outcome:*` and one `bee-resolution:*` label. These project native closure and provenance for queries; they confer no scheduling or process authority. The [shared request model](../../lib/shared/src/spawn-request.ts) owns their derivation. Valid published combinations are:

| Native status | Outcome | Resolution | Evidence |
| --- | --- | --- | --- |
| `open` | `pending` | `unresolved` | Work requested, including automatic retries; no claim that a worker is running. |
| `closed` | `succeeded` | `resolved` | Close reason `completed`, including completion without launch. |
| `closed` | `failed` | `unresolved` | Close reason `exhausted`, `claim_failed` or `blocked`, without acknowledgment or replacement. |
| `closed` | `failed` | `resolved` | Acknowledgment of that closure or an incoming `supersedes` edge from a successfully created replacement. |
| `closed` | `cancelled` | `resolved` | Deliberate closure, including `cancelled`, `Stopped by Bee`, another operator reason or no reason. |

All other combinations, duplicate labels and unknown values are invalid projections. Inspection treats native statuses other than `closed` as pending; Colony itself uses `open` and `closed`. Reopening a terminal spawn does not reset its history: use `bee retry`.

## Transitions and resolution

Automatic retries preserve the request and identity. Explicit `bee retry` creates `replacement --supersedes--> original`; only successful creation resolves an unresolved failure. Deliberate cancellation resumption requires `--resume-cancelled`. Read `bee retry --help` for eligibility, process verification and recipe selection. `related` edges identify work; `supersedes` edges identify replacements.

A replaced cancellation retains its native close reason, closure time, identity and `cancelled`/`resolved` disposition. Its resolution provenance becomes `superseded` with the actual replacement IDs; `needsAttention` remains false. A failed replacement needs its own follow-up while the predecessor remains resolved. Busy Bee follows this provenance for the same dispatched stage, preserving the saved run and visits.

[Automatic work reviews](../../lib/colony/README.md#automatic-work-reviews) use this same public retry path. Read `colony work-review recover --help` for their narrower evidence, saved-assignment and one-attempt limits, including incident-linked native continuation authority for a cancelled predecessor.

`bee ack` resolves attention without changing failure outcome, task state or execution history. `bee stop` on an already-closed request preserves its outcome and resolution. It does not acknowledge failure.

`bee status` exposes native disposition, resolution provenance, `needsAttention` and whether label publication is current. Exact old-ID inspection retains that request's history. Use `bee result --help` for authored answers and replacement selection.

## Acknowledge an accepted failure

Read `bee ack --help` for eligibility and use. Authority comes from a native `Bee acknowledgment:` comment whose `{closedAt, reason}` matches the exact closure. Native comment author and timestamp supply attribution; Colony observations are separate evidence.

Repeats preserve the original acknowledgment and repair labels. If synchronization introduces competing comments, the [shared model](../../lib/shared/src/spawn-request.ts) chooses deterministically by native timestamp, author and text, retaining every record. This is not globally serialized first-writer authority: an earlier imported record can change the selected acknowledgment. Supersession takes precedence without deleting it. A comment for another closure does not resolve this one.

Acknowledgment precedes label publication. After `request_labels_pending`, fix the tracker failure and repeat `bee ack`; waking Colony alone does not repair an old failed/unresolved label pair.

## Report your own execution finished

`bee finish --help` owns worker delivery and completion instructions; [responses](./responses.md) are independent authored artifacts.

Task closure leaves a live bee time for cleanup. After exit or `finish success`, Colony checks linked work; unfinished work follows bounded retry/exhaustion even after a success report. A validated `finish blocked` instead ends automatic retries, preserves closed tasks and blocked states, releases only unfinished claims still owned by that bee, and records the reason and unfinished IDs. The spawn closes failed/unresolved for caller attention.

After resolving the blocker, the caller uses `bee retry`. Blocked tasks must first become ready through an explicit update or dependency resolution. Retry creates a new request; it does not reopen the original or resume its session.

### Report transport and authority

Colony injects request/attempt identity, token and private state location. Preserve that context; it is local execution authority, not a security boundary against the same OS user. [`launch.ts`](../../lib/colony/src/launch.ts) validates it against the immutable receipt and atomically writes `finish.json`. Identical repeats succeed; conflicting reports fail.

`finish_submitted` acknowledges durable submission. Colony accepts only its recorded current attempt; stale reports cannot affect a replacement. Cancellation takes precedence. A sleeping daemon consumes the report after wake, and checkpointed settlement survives interruption.

## Report an inactivity verdict

Only a Colony-launched inactivity drone uses `bee system report`; read its help. Injected review/target context and the recorded executing attempt authorize one immutable `verdict.json`. Every duplicate is rejected, including an identical repeat. Stale, mismatched, replaced, settling or late reports are rejected; malformed/invalid artifacts remain evidence without affecting the target.

The inactivity drone reports active/inactive only. Colony owns task claims, process cleanup and retry decisions. The [runtime guide](../../lib/colony/README.md#review-quiet-bees-with-a-drone) owns trigger, deadline and missing-verdict policy; [`drone.ts`](../../lib/colony/src/drone.ts) owns report validation.

## Find requests with native Beads

Use the selected `BEADS_DB` with focused filters and bounded output. Repeated `--label` filters are ANDed. Failed requests are closed, so attention/history queries need `--all`. For example:

```sh
br list --label system --label bee --label bee-outcome:failed \
  --label bee-resolution:unresolved --all --limit 20 --db "$BEADS_DB" --json
```

Read `br list --help`, `br search --help` and `br query --help` for native filtering, pagination and saved queries. `br show ID --json` reads exact provenance and comments.

Query labels can lag native facts or be absent. Inspect selected IDs with `bee status ID --json` for closure, acknowledgment, supersession and label publication state. When investigating missing records, use focused native queries without disposition labels.

## Saved presets

Use `bee setup --help` to install the Bee-owned `bee-attention` preset. Hive's [setup task](../repository-commands.md#setup-and-automation) includes it.

Run it with `br query run bee-attention --db "$BEADS_DB" --json`. Native query-run options override saved filters: `--label` replaces the entire saved label group. To narrow by kind, repeat all four attention labels plus `agent:KIND`; an independent `--assignee` filter leaves the preset labels intact.

## Publication and recovery

Native closure/provenance and label publication are separate writes. Bee/Colony publishes both label namespaces together, preserving unrelated labels, guarding the native revision and rereading authority afterward. [`requests.ts`](../../lib/colony/src/requests.ts) owns bounded conflict recovery. Success requires current labels; interruption can leave stale projections while exact inspection already reports the new fact.

`request_labels_pending` includes `requestId` and any created `replacementIds`. Inspect those effects before retrying: a failure after replacement creation does not mean the replacement was refused.

After fixing the reported tracker failure:

- Repeat `bee stop CLOSED_ID` to repair its labels without changing closure. Repeating `bee retry OLD_ID` after supersession repairs publication and refuses a duplicate; inspect the existing replacement.
- An awake Colony repairs same-host closed requests still labeled pending, including closures before registration, and publishes predecessor labels before dispatching a replacement.
- Settlement publication failure stops polling in visible `failed` state. Wake the same repository/tracker/server to replay the retained settlement; daemon recovery also resumes durable awake intent.

Current labels cause no write. There is no bulk historical relabeling; use exact inspection or unfiltered native history for missing projections. Manual provenance edits and concurrent changes require deliberate reconciliation, not inference from saved queries.

## Execution observations are separate

Private checkpoints and attempts have distinct lifetimes and state vocabularies. A failed attempt may leave its request pending for retry; neither vocabulary supplies disposition-label values.

`bee status` reads the latest timestamped Colony observation, not live process health. It can remain stale while asleep or after cancellation. `colony inspect` exposes retained checkpoints and artifact paths; `observedAt` is inspection time, not reconciliation time. For current runtime evidence, follow the [operator guide](../../lib/colony/README.md#inspect-runtime-and-retained-history).
