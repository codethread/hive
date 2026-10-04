# Spawn state and native queries

This is the authoritative reference for agents inspecting spawn requests, finding failures, retrying work or changing request lifecycle code. It applies to automation-owned `system` + `bee` beads. Reading or changing these beads requires an explicit Bee/Colony operation or system-maintenance assignment; ordinary task selection still excludes `system`.

## Facts and authority

Native Beads status answers whether work is still requested. Colony creates requests `open` and closes them on settlement; it does not mark a spawn `in_progress` when its worker starts. Task status and assignment belong to the linked task beads. Closing a spawn records intent or settlement, not proof that its worker has stopped.

Every produced spawn has exactly one `bee-outcome:*` label and one `bee-resolution:*` label. They are query projections of native closure and provenance, maintained by Bee and Colony. The [shared request model](../../lib/shared/src/spawn-request.ts) defines the mapping used by inspection and publication. Labels never drive scheduling, establish process ownership or replace the native facts.

| Namespace | Complete set of values | Meaning |
| --- | --- | --- |
| `bee-outcome:` | `pending`, `succeeded`, `failed`, `cancelled` | Whether the request is pending, completed its work, ended unsuccessfully, or was deliberately closed. |
| `bee-resolution:` | `unresolved`, `resolved` | Whether follow-up remains; only failed **and** unresolved means failure attention. |

These are the only valid combinations after publication:

| Native status | Outcome label | Resolution label | Meaning and evidence |
| --- | --- | --- | --- |
| `open` | `bee-outcome:pending` | `bee-resolution:unresolved` | Waiting, claiming, executing, settling or awaiting another automatic attempt. Pending does not mean a worker is running. |
| `closed` | `bee-outcome:succeeded` | `bee-resolution:resolved` | Native close reason `completed`: all related tasks completed, including completion without a launch. |
| `closed` | `bee-outcome:failed` | `bee-resolution:unresolved` | Native close reason `exhausted`, `claim_failed` or `blocked`; no replacement resolves the failure. |
| `closed` | `bee-outcome:failed` | `bee-resolution:resolved` | A successfully created replacement has a native `supersedes` edge to this failed request. Original failure evidence remains intact. |
| `closed` | `bee-outcome:cancelled` | `bee-resolution:resolved` | Deliberate closure: `cancelled`, Bee's `Stopped by Bee`, or another operator close reason (including no reason). |

`pending/resolved`, `succeeded/unresolved` and `cancelled/unresolved` are invalid. Multiple or unknown values in either namespace are invalid projections. Native statuses other than `closed` are interpreted as pending for inspection; Colony's spawn lifecycle uses `open` and `closed`. Reopening a terminal spawn does not reset its attempt history: use `bee retry` for a new request.

## Transitions and resolution

- `bee spawn` and a newly created replacement start pending/unresolved. Automatic retries stay on the same pending request and retain its identity.
- Completion publishes succeeded/resolved. Retry exhaustion, partial claim acquisition failure or explicit blocked handoff publishes failed/unresolved. `bee stop` closes an open request and publishes cancelled/resolved.
- `bee retry` first admits and creates a new request with `replacement --supersedes--> original`. Only that successful creation resolves the original. Reservation, duplicate, invalid recipe or native creation failure leaves the original unresolved.
- A replacement failing becomes independently failed/unresolved. Its predecessor stays failed/resolved. Following `related` edges finds work; following `supersedes` finds replacement provenance.
- Repeating `bee stop` on a closed request preserves its outcome and resolution. It does not acknowledge a failure. Explicit acknowledgment remains separate work in hv-45f.4; do not resolve failures by manually editing labels.

`bee status <id> --json` exposes `disposition: {outcome, resolution}` with the table's values, `needsAttention`, and `labelPublication: "current" | "pending"`. Its existing `resolution` detail is `{kind: "unresolved"}`, `{kind: "resolved"}`, or `{kind: "superseded", replacementIds: [...]}`. `superseded` is provenance detail, not a third resolution-label value. Replacement status includes `supersedes` IDs. Exact old-ID inspection retains the original recipe, identity, closure, task links and observations.

## Report your own execution finished

A Colony-launched bee reports through Bee, without entering a spawn ID:

```sh
bee finish success
bee finish blocked --reason "Missing credential for TASK_ID; operator must supply it, then retry"
```

Complete all possible work first, close completed tasks, record findings and next actions on the remaining task beads, and synchronize the tracker before reporting. Mark manually blocked tasks with native `blocked` status when appropriate. The blocked reason must be nonempty; explain the blocker and required next action. Colony records unfinished task IDs alongside that reason. A report does not automatically mark all linked tasks blocked. Native dependency waiting remains readiness for a pending request; an explicit blocked handoff is terminal unsuccessful execution requiring attention, including when the bee has closed its tasks but cannot finish cleanup or synchronization.

Closing every task does not stop a live bee: it retains time for cleanup, synchronization and reporting. `finish success` ends that execution's work; Colony checks all linked tasks. Unfinished work follows the ordinary bounded failure/retry policy, including exhaustion, even after a success report. After process exit, all tasks closed can also satisfy the request. Before launch, all tasks closed still prevents a launch. Caller `bee stop` remains cancellation without automatic retry.

`finish blocked` ends the attempt without scheduling automatic retries. Colony preserves closed task records and native blocked states, releases only unfinished claims still owned by this bee, records the reason, attempt ID and unfinished task IDs on the spawn, and closes it as `blocked`. The existing failed/unresolved label pair exposes attention; `bee status` displays the durable reason in its last recorded observation. This handoff does not spend further automatic attempts to exhaustion.

After resolving the external blocker, the caller uses `bee retry ORIGINAL_ID --actor ACTOR`. It creates a new request with unfinished task links and native `supersedes` provenance; predecessor and task history remain available. Native blocked tasks must become ready through an explicit task update or dependency resolution before the replacement can launch. Retry does not erase their status, reopen the original, resume an old session, or launch a duplicate live execution. There is no separate resume command.

### Report transport and authority

Colony injects `HIVE_SPAWN_ID`, `HIVE_ATTEMPT_ID`, `HIVE_ATTEMPT_TOKEN` and `HIVE_COLONY_STATE` with the existing launch environment. Do not manufacture these values or copy them between attempts. They are local execution context, not protection against another process with access to the same user's private state.

Bee validates this context against the immutable launch receipt and atomically publishes one `finish.json` in that attempt's directory. Identical repeat submissions succeed; a conflicting second result fails. The `finish_submitted` response acknowledges durable submission, not accepted settlement. A sleeping or stopped Colony consumes it when awake again; the artifact survives worker exit and daemon restart. Inspection remains available through `bee status` and `colony inspect`.

Only the recorded current executing attempt is eligible at reconciliation. Colony checks the report's request ID, attempt ID and token against its stored launch authority. Reports in old attempt directories cannot affect a later attempt or a linked replacement, even if a late submission succeeds locally. External request cancellation takes precedence. The validated decision is checkpointed before process cleanup, and its reason is published before terminal closure and label publication, so interrupted settlement can replay without losing the handoff.

## Report an inactivity verdict

Only a Colony-launched inactivity drone submits `bee report SPAWN_ID active|inactive`. Colony supplies the inspected spawn/attempt/review in its prompt and injects `HIVE_DRONE_REVIEW_ID` and `HIVE_DRONE_TARGET_ATTEMPT_ID` alongside the drone's own `HIVE_ATTEMPT_ID`, `HIVE_ATTEMPT_TOKEN` and `HIVE_COLONY_STATE`. Do not copy context from another attempt. As with finish reporting, these are local authority checks for processes sharing the user's private state, not a security boundary against that user.

Bee checks the private recorded review and current executing target before atomically creating one immutable `verdict.json` in the drone's directory. Unlike finish reporting, **every duplicate verdict is rejected**, including an identical repeat. The `drone_verdict_submitted` response acknowledges submission; only Colony accepts the decision. The report binds the target spawn and attempt, review ID, drone attempt and token, and submission time. Replaced or settling targets, decided reviews, mismatched provenance and reports at or after the five-minute deadline are rejected. Colony ignores malformed, stale and late artifacts as invalid verdicts, retaining them as evidence; they cannot affect a replacement.

The drone reports only active/inactive. It must not claim or close tasks, signal processes, assign lifecycle states, launch another review or use `bee finish`. Colony owns verified cleanup and normal bounded target retry/exhaustion. Its [15-minute trigger and five-minute deadline policy](../../lib/colony/README.md#review-quiet-bees-with-a-drone) also explains missing-verdict failures, independent active deferral and asleep/recovery behavior. There is no unsettled post-launch missing-verdict policy: exit without a valid verdict or deadline expiry uses inactive consequences with distinct diagnostics and no drone retry.

## Find requests with native Beads

Use the selected `BEADS_DB`. Repeated `--label` flags are **AND** filters. Failed requests are closed, so attention and history queries must include `--all`. `--limit 0` keeps results complete. The native [`br query` commands](https://github.com/Dicklesworthstone/beads_rust#commands) save list filters; Hive has no separate query language.

```sh
# Failure attention: all four labels must match, including closed requests.
br list --label system --label bee --label bee-outcome:failed \
  --label bee-resolution:unresolved --all --limit 0 --db "$BEADS_DB" --json

# All open requests, regardless of last execution observation.
br list --label system --label bee --status open --limit 0 --db "$BEADS_DB" --json

# Full request history, including successful and resolved failed requests.
br list --label system --label bee --all --limit 0 --db "$BEADS_DB" --json

# Every failed request, whether unresolved or already superseded.
br list --label system --label bee --label bee-outcome:failed \
  --all --limit 0 --db "$BEADS_DB" --json

# All unresolved requests also includes pending work; this is not an attention query.
br list --label system --label bee --label bee-resolution:unresolved \
  --all --limit 0 --db "$BEADS_DB" --json

# Text search across request history; substitute a task ID or other search text.
br search 'TASK_ID_OR_TEXT' --label system --label bee --all --limit 0 --db "$BEADS_DB" --json

# Exact native record, including related tasks, supersession and timestamped comments.
br show SPAWN_ID --db "$BEADS_DB" --json
```

For a selected tracker outside the project environment, replace `"$BEADS_DB"` with its absolute database path. Omit `--json` for human output. `bee list` remains available: its default includes open requests and unresolved failures; `bee list --all` includes resolved history.

## Saved presets

`bun run beads:setup --db "$BEADS_DB"` installs or refreshes the Hive-owned native preset `bee-attention` along with the existing checkout setup. Saved queries live in the selected local Beads database's configuration, not issue JSONL; setup must run for each separate tracker clone. Setup overwrites this named preset and preserves other presets.

To install it directly using your harness actor (replace `codex` with `claude` or `pi` when applicable):

```sh
br query save bee-attention \
  --description 'Failed unresolved spawn requests, including closed requests' \
  --label system --label bee --label bee-outcome:failed --label bee-resolution:unresolved \
  --all --limit 0 --db "$BEADS_DB" --actor codex --json

br query run bee-attention --db "$BEADS_DB" --json
br query list --db "$BEADS_DB" --json

# Optional local history preset, installed explicitly rather than by setup.
br query save bee-history --label system --label bee --all --limit 0 \
  --db "$BEADS_DB" --actor codex --json
br query run bee-history --db "$BEADS_DB" --json
```

Native `query save` refuses an existing name. To refresh an existing preset manually, first run `br query delete bee-attention --db "$BEADS_DB" --actor codex --json`, then the save command above. Setup performs that replacement. If it is interrupted between delete and save, rerun setup to restore the preset.

Native query-run options override saved filters. In particular, supplying `--label` replaces the saved label group; it does not add another AND condition to that group. To narrow attention to a kind, repeat all four attention labels plus `--label agent:worker`, or use the full `br list` form. An independent `--assignee FRIENDLY_NAME` filter can narrow the saved preset without replacing its labels.

## Publication and recovery

Native `br` does not atomically combine closure or replacement creation with label publication. Bee/Colony writes the native fact first, then replaces both label groups in one native `--set-labels` transaction, retaining the other labels it read. It checks the native revision before writing and rereads facts afterward. A successful lifecycle operation has exactly the projected pair. A failed or interrupted publication can temporarily leave the previous pair: native queries may lag, while `bee status` reports the authoritative disposition and `labelPublication: "pending"`.

Publication failures return a nonzero exit and `reason: "request_labels_pending"`, with `requestId` and any already-created `replacementIds`. Fix the reported tracker failure; inspect the IDs before taking recovery action. A failure returned after replacement creation is **not** refusal of that replacement. Its native edge and request remain, and the original is already superseded in exact inspection.

Recovery is bounded and preserves history:

- Repeat `bee stop CLOSED_ID --actor codex` to repair a closed request's labels without changing its close reason. Repeating `bee retry OLD_ID --actor codex` after supersession repairs the projection and refuses another replacement; inspect the existing replacement instead.
- An awake Colony repairs closed requests still carrying `bee-outcome:pending`, including closures made before runtime registration. It publishes a replacement's predecessor labels before dispatching that replacement.
- Runtime settlement publishes labels before saving its terminal checkpoint. A failed pass leaves Colony in its visible `failed` state and stops polling. After fixing the tracker failure, run `colony wake --repo REPOSITORY --beads-db "$BEADS_DB"` against the same server state to replay the saved settlement; daemon recovery also resumes durable awake intent. Unchanged publications do not write again.

Use `--repo` and `--beads-db` on Bee/Colony commands when the current environment does not select the intended repository and tracker. There is no bulk historical relabeling: records created before this contract may be absent from label-filtered queries. Use the unfiltered native history query or exact inspection for those records. Manual edits to automation-owned labels or concurrent changes to native provenance require inspection and deliberate reconciliation; saved queries alone cannot diagnose a stale projection.

## Execution observations are separate

Private request checkpoints use `waiting`, `claiming`, `executing`, `settling`, `retrying`, `terminal`; terminal checkpoint outcomes are `completed`, `cancelled`, `exhausted`, `claim_failed`, `blocked`. Attempt state uses `starting`, `running`, `exited`, `failed`. Those values describe different lifetimes and are not label values. A failed attempt can lead to another automatic attempt while the request stays pending.

`bee status` reports the last timestamped `Colony observation:` comment, or `null` when none exists. It does not probe a process or daemon. A running observation can remain after cancellation while a colony sleeps. `colony inspect --json` exposes retained runtime checkpoints and attempt paths; its `observedAt` is inspection time, not reconciliation time. Use the [operator guide](../../lib/colony/README.md#inspect-runtime-and-retained-history) for daemon availability, retained history and process cleanup. Labels, closure, and old observations never prove current runtime health.
