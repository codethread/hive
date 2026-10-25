# Busy Bee specification

Busy Bee is a general-purpose workflow engine. Domains supply charts, schemas and task briefs; the engine owns their projection into Beads. See the [user guide](./README.md) for commands and the [authoring guide](../../docs/busybee-workflows.md) for the definition contract.

## Work and progression

**Ordinary work contains each root workflow.** `run` and `start` require an explicit existing parent in the selected tracker. The parent must be nonclosed and lack the `system` label; ordinary bugs are accepted alongside tasks, features and epics. Common root initialization validates it before publishing any run, checkpoint, visit or request. The run has one native `parent-child` edge to that work through `CreateTask.parent`. Busy Bee neither claims nor closes the parent. Nested XState actors remain inside the run's existing visit/group hierarchy; they create no additional root workflow.

**XState owns progression; Beads owns current work.** Sequential stages are siblings. Nested tasks belong to their nearest bead-bearing container; dynamic actors name their containing group. Final states mark chart completion without creating work. Busy Bee owns generated inventory, original results, accepted transitions and completion directives. Native Beads owns current briefs, acceptance, claims, assignees, owners, reservations, blockers and manual descendants.

**Each bead represents a visit.** Only work at a published frontier is created. Its task callback renders the brief, including optional acceptance criteria, once; the saved render remains frozen for that visit. Renderer changes affect future visits only. An accepted worker result retires the visit even when a loop returns to the same state; untouched parallel tasks retain theirs. Projection observes published frontiers, not every XState microstep: unsubmitted states that leave and re-enter within one macrostep may retain their visit.

**Descriptions and acceptance are separate.** `runBrief.description` supplies the run description; visit `instructions` plus engine guidance form worker and group descriptions. Optional `acceptanceCriteria` from `runBrief` or a task callback passes unchanged to native `acceptance_criteria`. Absence remains valid. Frozen metadata is creation provenance, not authority to restore mutable native fields. Busy Bee neither extracts criteria from prose nor overwrites later brief/acceptance edits or checklist ticks.

**One successful-completion path: `complete` → `collect`.** There is no save-only `record-result`, direct `next`/`choice` submission or runtime submit bypass. An authored choice named `next` remains legal and may require data. Worker response delivery remains a separate protocol; see [responses](../../docs/agents/responses.md).

Under per-run ownership, `complete RUN TASK CHOICE`:

1. Validates generated visit identity, current reservation/readiness, absence of settlement, and the active choice/schema/transition. An already-consumed retry checks retained evidence without replaying the transition.
2. Saves the original `{choice,data}` and a `requested/succeeded` completion together in the workflow system description. The original is immutable: retries compare JSON structurally, not by serialized key order. Conflicting input fails. Schema-transformed data belongs only in accepted history/snapshot; never resubmit it as the original.
3. Re-reads native work and projects closure through the [current gates](#completion-projection-and-reconciliation), using a readable generated reason and native close `ifUnchanged`. Successful closure is re-read before recording `confirmed` with the canonical native `closed_at` witness.
4. Publishes derived outcome labels and releases its own lock. Completion does not advance the chart. A known failure retains saved intent/effects and releases ownership when possible; retry the same original or reconcile after resolving the reported gate.

**The driver collects confirmed results.** `collect` first reconciles known completion projections, then validates the complete consumable frontier batch in stable order. A consumable visit has a retained original, confirmed successful completion and matching current native closure. Failed/cancelled visits cannot advance. Labels are repaired projections, not lifecycle authority. Eligible closed results remain consumable independently of their execution request; an unfinished Bee-dispatched visit whose terminal request has no pending replacement fails visibly with run, stage and request IDs.

After advancing in memory, Busy Bee saves accepted history, the resulting snapshot, the retired frontier and departed-group completion directives **before** native group/run closure or new frontier publication. Consumed visits leave the active frontier, so a refused container close can be retried without sending their events twice. A persisted final root snapshot receives a successful run directive; native closure is still required. New generated membership and explicit scope are saved before Bee dispatch; the returned request ID is saved before ownership releases.

**Containers have no worker result.** Departed groups close bottom-up and the run closes last, through the same fresh native gates as visits. The engine never ticks container criteria. A refused close preserves the advanced chart and requested completion; `collect` or `reconcile` retries projection. New work cannot be created beneath a closed structural parent. Reopening is limited to the completion repairs below, not reuse of completed work as a container.

## Native workflow outcomes

The workflow system description owns intended outcomes for generated runs, visits and groups. Native closure is the required projection, not an independent source of workflow meaning. The [Shared contract](../shared/src/workflow-lifecycle.ts) joins system completion with current native state without importing a workflow definition:

- No directive and nonclosed native work: pending.
- `requested`: intended outcome is fixed, but closure is unconfirmed; never terminal success.
- `confirmed` plus matching native closed timestamp and generated reason: terminal `succeeded`, `failed` or `cancelled`.
- Direct closure without a directive, reopened/reclosed confirmed work, or altered generated close prose: projection mismatch, not success or newly executable work.

A worker choice answers the workflow's question; its completion outcome describes execution. A review choosing `changes` can therefore succeed. Original results remain in the system record after collection. Ordinary and system notes are neither read nor written as workflow transport. Comments and filed responses remain authored evidence.

Generated `close_reason` is readable prose retained in the directive, not JSON transport. Writers and readers compare it for projection agreement; consumers never parse its grammar or infer an outcome from it. `confirmed.closedAt` witnesses native closure, not every task edit: an unrelated notes or assignment edit does not invalidate it merely by changing `updated_at`.

Busy Bee publishes only the [registered outcome-label namespace](../../docs/beads-labels.md#taxonomy), preserving unrelated labels with CAS. Labels are a query index, never outcome authority. A failed label write can lag confirmed closure; repair does not replay the worker's transition.

## Completion projection and reconciliation

`reconcile RUN` repairs the saved generated inventory without loading a definition, advancing a chart, creating work/requests or authorizing settlement. `complete`, `collect` and `settle` use the same projector.

| Current observation | Bounded repair |
| --- | --- |
| Native closed, no completion directive | Guarded update of status to `open`, clearing native closure metadata; remove only outcome labels. Never synthesize a result. |
| Requested completion, native open | Recheck gates, guarded-close and confirm. |
| Requested completion, native closed | Guarded reopen, then current gates and guarded-close; do not adopt a direct closure as confirmation. |
| Confirmed completion, matching closure | No close write; repair labels if needed. |
| Confirmed completion, reopened, different closure timestamp or altered reason | Preserve intended outcome/result; guarded reopen when necessary, recheck gates, guarded-close and update the witness. No transition replay. |
| Current reservation/readiness or work gate refuses | Preserve live work and control evidence; report affected IDs and the required action. |
| Missing generated bead, changed ancestry, corrupt control or unknown create/dispatch effects | Fail visibly; no reminting, arbitrary adoption or ancestry repair. |

Repairs inspect reservations even on closed targets. Human/HITL or another agent's claim, blocked/draft/deferred work and future deferral remain barriers. Before closure, Busy Bee explicitly rejects unchecked native `acceptance_items`, unfinished children and blocking dependencies, even if an unconfigured tracker would allow closure. Configured native policy may impose further gates. Optional absent/empty acceptance remains valid; checklist state does not prove the work true.

Reopen ancestors top-down when needed; close descendants bottom-up. Reopening uses native update `ifUnchanged` on status only; closing uses native close `ifUnchanged`, without force or synthetic ticks. Preserve briefs, acceptance, notes, assignments, owners, reservations and unrelated labels. This does not restore a previous open/in-progress status or undo unrelated native edits. Reason-only repair may reopen/reclose and change `closed_at`, because native close cannot rewrite an already-closed reason.

An unsuccessful settlement projection requires a same-operation/reason `settle` retry with fresh execution clearance, including after a previously completed settlement is reopened. Generic `reconcile` may diagnose mismatches and repair labels but cannot reclose failed/cancelled scope through a clearance bypass.

## Bounded unsuccessful settlement

`settle RUN cancel|fail --reason TEXT` retires eligible generated scope without importing the definition, advancing the saved chart or submitting an authored choice. See `settle --help` for invocation and diagnostics. It does not stop processes, close the source task or ancestors, or decide their acceptance.

Under ownership, settlement inspects complete generated/native ancestry, requests/replacements and reservations. It refuses unfinished manual descendants and unsupported inventory. It saves operation, reason and bounded inventory in the **system description** before clearance; this durable intent fences completion, progression and new admission between invocations.

New runs have `managedExecution: "unmanaged"`. Before driver handoff or Bee stage publication, Busy Bee stamps the coherent checkpoint `managed`; that exposure never resets. Explicit unmanaged provenance plus complete inventory agreement and no contradictory requests permits daemon-free settlement. Format-2 control requires this provenance; missing or invalid values fail rather than proving no execution.

Managed exposure requires fresh clearance from the running owning-host Colony daemon registered for the selected repository/database. Busy Bee holds ownership through clearance and projection, then rechecks inventory and reservations. Colony serializes clearance with final claim/reservation/supervisor admission and checks native requests and retained attempts. Missing history, foreign/unbound hosts, live or unverified processes, and marked manual execution refuse clearance. [Colony's clearance interface](../colony/README.md#workflow-execution-clearance) owns that observation contract.

After clearance, settlement saves requested failed/cancelled directives for its retirement targets and projects closures bottom-up, run last, through ordinary native gates. Existing successful directives are immutable, including **requested success**: settlement may gated-confirm such a descendant after clearance, but cannot replace its outcome. The original remains unconsumed; chart/history do not advance. A run with an existing successful directive cannot be retired; finish its success projection through `collect` or `reconcile`.

Settlement is complete only when required projections are confirmed. Known partial failures retain intent and confirmed effects and release their own lock when possible. Retry the **same operation and reason** after resolving gates; every retry obtains fresh clearance, even when the saved settlement was previously complete. Conflicting settlement input fails. Unchecked acceptance or an unfinished child can prevent retirement indefinitely; cancellation never authorizes force closure, false ticks or reporting an unfinished native anchor as terminal.

These guarantees require cooperating version-matched tools on one live database, not concurrent tracker exchange, old writers or externally detached execution. Settlement supplies no general held-lock recovery; the [failure boundary](#checkpoint-and-failure-boundary) still applies.

## Contracts and authority

Zod schemas drive validation and CLI discovery; task briefs describe work instead of copying payload templates. Definitions can add context-dependent validation and explain those constraints in discovery. Author outcomes and runner operations have separate identities, so outcome names are unrestricted by runner command names.

The caller's Git checkout supplies the workflow catalogue; native `br` selects the tracker. Execution directory and database storage remain independent. Named manifests require full SemVer versions. Named runs resolve their saved name in the current checkout, allowing continuation after worktree removal when the current version satisfies the forward caret range from the saved version. Equality and newer compatible patch/minor versions are allowed; downgrades and major changes are rejected. Major-zero ranges follow caret's narrower boundary (`0.2.3` permits versions below `0.3.0`; `0.0.3` permits only itself). Prereleases require exact SemVer equality; build metadata does not affect equality or precedence. A successful mutation persists the current manifest version for subsequent restores; read-only inspection does not persist that update.

Catalogue discovery excludes `.workflows/node_modules`. Named fingerprints record provenance, not compatibility: they include regular files in the workflow folder recursively, excluding every `node_modules` entry, plus existing regular files named `package.json`, `bun.lock`, `bun.lockb`, `package-lock.json`, `pnpm-lock.yaml` and `yarn.lock` directly under the shared `.workflows` directory. Explicit-file fingerprints cover only the entry file's bytes and must match before import. Neither fingerprint verifies installed dependency contents or external imports. Authors own preservation of state IDs, actor routes, persisted context and frozen task command contracts across compatible named versions; see [version authoring](../../docs/busybee-workflows.md#version-saved-workflow-contracts).

Definition compatibility and authorization are separate. When the saved named workflow still exists but cannot resume compatibly, a bee may create a fresh run of that same workflow for the same already-authorized scope without renewed user approval. Preserve the original request, source/target, scope, ownership/assignment intent, tracker and old run/task/evidence references. Inspect completed and uncertain effects and enter the current workflow's triage to continue remaining work; permission to re-mint does not authorize blindly replaying effects or skipping current checks and reviews. Retain the old run as history; its disposition is separate.

If the saved named workflow folder is absent, stop and ask the user which workflow to use. An existing folder with a missing/malformed manifest, invalid entry or unrelated I/O failure retains its actual diagnostic. The engine neither creates replacement runs automatically nor selects a substitute name or migrates snapshots. It rejects incompatible named versions and changed explicit files before importing them. This recovery guidance applies when restoring existing checkpoints through inspection or mutation; explicit-file runs retain file-based guidance.

Identity follows native Beads roles: the current actor receives mutation attribution; the human owner remains accountable; the run's assignee determines assignment of driver-handled tasks. Grouping and checkpoint beads have no assignee. Bee-dispatched tasks are left for Colony to claim. [Ownership options](./README.md#ownership-and-assignment).

## Checkpoint and failure boundary

One related bead labelled `system` and `busybee-checkpoint` holds the entire machine document in its **description**. A nonblocking `related` edge associates it with the ordinary run; native parent edges remain containment authority. System notes are untouched. The system label excludes the record from ordinary work selection.

Engine `formatVersion: 2` is independent of workflow SemVer and the structural preview/inspection wire versions. Alongside the definition locator/version/hash, deep XState snapshot, active frozen entries, visit counters and accepted transformed history, the document carries:

| Member | Meaning |
| --- | --- |
| `id` | Native run bead ID. |
| `lock` | `null` or `{owner, pid}`; unique invocation ownership and diagnostic PID. |
| `managedExecution` | `unmanaged` or `managed` exposure. |
| `created` | Generated history with explicit `visit`/`group` scope, native bead/parent IDs and dispatch provenance. The run is not duplicated here. |
| `results` | Immutable original `{choice,data}` by native visit bead ID, retained after consumption. Loops get new bead IDs; replacement requests do not. |
| `completions` | By native bead ID: `{scope, outcome, reason, state: "requested"}` or the same fields with `state: "confirmed"` and native `closedAt`. Scope is `visit`, `group` or `run`; outcome is `succeeded`, `failed` or `cancelled`. |
| `settlement` | `null` or `{operation, reason, state, inventory}`. Operation is `cancel`/`fail`, state is `pending`/`complete`, and inventory contains bounded `{id, scope}` retirement targets. |

Shared validates the consumed identity/control/completion contract and exactly-one-related-system selection. Busy Bee validates the definition header and owns the opaque XState body; this is not recursive validation of every saved actor field or a checkpoint-repair framework.

Missing, unknown and format-1 documents fail before mutation. **Format-1 runs cannot resume under format-2 tools.** Finish them with matching old tools or follow the [same-scope fresh-run rules](#contracts-and-authority); old-run disposition and live cutover need their own authority. There is no migration, fallback to notes/close reasons or automatic cutover. The [adoption guide](./README.md#breaking-adoption) covers version-matched deployment and caller changes.

Acquisition, patches and release use fresh, owner-checked, whole-description CAS updates. Patches preserve unrelated control members rather than writing an earlier in-memory snapshot over newer results. Work happens outside these short ownership windows; contenders wait up to ten seconds and never steal a lock. PID is diagnostic, not takeover authority. All writers share one live database; [tracker synchronization](../../docs/beads-integration.md) supplies no distributed lock.

Known result-save/close/confirmation/label and container-projection failures retain durable evidence and release their own lock when owner-checked release succeeds. A retry can reconcile those bounded effects; an uncertain close response is neither success nor failure proof. Inspect current native state and canonicalize unconfirmed closure through the projector. Process death or database unavailability can still prevent release and require explicit held-owner inspection/recovery; no automatic expiry or PID takeover exists.

Unknown task-creation, driver-handoff or request-publication effects retain ownership for inspection. These are not replayable completion failures. Multi-write initialization can leave orphan records: errors retain known `parentId`, `runId`, checkpoint, task/request IDs and the uncertain operation where available. Inspect confirmed effects before any authorized recovery; do not repeat publication or remint missing work merely because a response failed.

## Saved-state preview

Public CLI run views (`run`, `start`, `show`, `collect`) expose visit references and required `chartStatus`, `completion` and `nativeStatus` fields without actor context or instruction bodies. `chartStatus` is the saved chart status; `completion` is `pending`, `projection_pending`, `succeeded`, `failed` or `cancelled` from the current system/native join. `status` is `completion_pending` when the chart is done without confirmed native success; otherwise it retains the chart status. `system prepare-driver` exposes the same status distinctions. Structural preview/inspection schemas are unchanged and their saved chart status alone never proves completion. `show --instructions` adds the exact frozen text from each active visit's saved `meta.instructions`; it does not rerender that brief or expose raw context. Runtime APIs, checkpoints and native task descriptions retain their full content. Native run/task briefs remain authoritative for current work and caller completion instructions. See `show --help` for fields and inspection commands.

`discover` exposes outcome choices, payload schemas and author constraints. Like `show`, it performs no native writes, but restores, starts and stops an XState actor; discovery also calls author discovery/schema code. The preview interfaces below have a narrower execution boundary.

`system checkpoint RUN --json` returns the public `runId`, `checkpoint` and `savedAt` fields in a `workflow_checkpoint` success envelope. It validates the checkpoint header and run identity without importing a definition, rendering instructions, creating actors, acquiring locks or writing. The [Shared wire schema](../shared/src/workflow-preview.ts) owns the payload; `system schema --checkpoint --json` exposes its success schema without tracker access.

`savedAt` is the native checkpoint's update time, including lock and other bookkeeping writes. A changed checkpoint stamp is a reason to inspect again, not proof of workflow progress or a state-entry timestamp. Compare all three fields within the same repository/database endpoint. Equality does not detect definition-only changes, run-title edits or changes to external renderer inputs.

`preview RUN --json` reads an active or completed run's latest checkpoint and resolves its definition under the [existing version and hash rules](#contracts-and-authority). Its Shared payload carries source fingerprints and structural diagrams with original saved state value/status for the root and retained child machine actors.

The structural allowlist preserves hierarchy, initial/final/history states and event, eventless, delayed, completion and invocation-result transitions. Each invocation exposes only its normalized `id` and `src` strings. Guards are descriptive labels. Context, input/output, task bodies, prompts, result history, metadata, actions and guard parameters stay out of the payload. Actors absent from the saved checkpoint are not reconstructed as historical visits. Missing or unsupported child logic, invalid state paths and incomplete parallel state fail explicitly; preview never substitutes a normalized state or recalculates the saved status.

`system preview RUN --json` extends this structural projection with instruction text for tooling consumers such as Hive UI. It uses the same checkpoint/definition loading path, reading one checkpoint for both structure and instructions. Its `workflow_inspection` envelope has `formatVersion: 1`; each actor's `instructions` map is keyed by full state node ID, including the root:

| Kind | Meaning |
| --- | --- |
| `frozen` | A published active visit's title, instructions and bead ID. Text is copied exactly from saved `active.meta`, matching actor path and node; its renderer is not called. |
| `rendered` | Other task metadata rendered with a separate clone of that actor's own retained context. This is a preview using the current definition, not a historical brief or prediction of future context. |
| `none` | The state has no task metadata. |
| `unavailable` | That state's instruction rendering failed; the message explains the failure. Other states remain inspectable. |

The optional `bee` field describes dispatch provenance. On `frozen` instructions it contains the saved Bee `kind` and original published `request` ID, which may precede an explicit retry's replacement request. On `rendered` instructions it contains only the resolved `kind`: an authored dispatch preview with no request identity. Omission means no Bee dispatch metadata, including on grouping states; it does not classify a state as driver-handled. Neither variant establishes current assignment or worker liveness.

Inspection substitutes no example or default context. It sends rendered text, not raw context, metadata or executable code. Structural and definition failures still fail the whole read. `system schema --json` exposes the inspection success envelope schema without tracker access; system interfaces require JSON.

`definition.sourceMatch` is `exact` when the saved and current fingerprints match, otherwise `compatible` for an allowed named definition. A compatible chart may differ from the chart that produced the snapshot. Preview reports definition-loading failures without replacing the run or updating its provenance.

Both preview interfaces create no actors, evaluate no transition guards or actions, advance no run, acquire no checkpoint lock and perform no engine writes. Ordinary `preview` calls no task renderers; system inspection calls only those described above. Trusted definition imports and render callbacks execute author code, so neither interface is an I/O sandbox. Consumers use the projection for display; Busy Bee retains authority over workflow progression.

## Simulation

`system simulate` replays supplied outcomes from a saved actor or explicit initial input. It shares preview's checkpoint loading and definition compatibility rules, then rejects a changed checkpoint identity, update time or current definition hash with `simulation_stale_baseline`. Every request replays from its stated origin; there is no simulation session store. A shorter event list implements Back or Reset. See `busybee system simulate --help` for request construction and schema discovery.

The [Shared simulation schema](../shared/src/workflow-simulation.ts) owns request and response fields. Requests require explicit JSON input for an initial start and explicit data for every event. Busy Bee validates initial input against `inputSchema` and original event data against the command schema on each replay. Original creation input is not retained or reconstructed from saved context. Initial starts are root-only; retained child actors can start independently from their own saved state. The `workflow_simulation` response carries the selected actor's structure, state/status and instruction text, available commands with payload schemas, and the initial-input schema. It exposes no raw context, actor references or executable effects. Listed choices still require valid data and matching guards; examples are drafts, not evidence that real work happened.

Untouched published visits retain their frozen briefs, command mappings and native identity. New simulated visits freeze rendered briefs and commands at the settled publication frontier, following the [visit projection rule](#work-and-progression); other states preview the current simulated context. Bee metadata follows the [frozen/rendered distinction](#saved-state-preview). Retired visits never lend their bead or request identity to a simulated visit. An author's `validateCommand` runs only for an untouched published visit; accepting an outcome on a new simulated visit with that hook fails as unsupported. Optional author discovery details are omitted.

Pure assignments and guards, hierarchy, parallel regions, eventless transitions, immediate internal raises, same-machine final states and serialized history references are supported. Active child coordination, actor references, invocation, timers, spawn/send/delayed actions and custom effects are unsupported when encountered; inactive branches do not disable the selected machine. A retained child's simulated completion never advances its parent. Unsupported behavior or invalid data rejects the replay rather than publishing partial progress.

Simulation creates and starts no live actors, executes no custom action effects, acquires no checkpoint locks and writes no checkpoints, tasks or requests. It never advances the actual run. Trusted imports and author calculations, including initialization, guards, assignments, validation and rendering, still execute: this is not an I/O sandbox. A simulated final state neither completes real work nor grants approval to execute it.

## Validation boundary

`validate` checks definition resolution, supplied input and the pure initial XState snapshot. It creates no beads and starts no live actor. It does not prove later paths, guards or action implementations. Workflow code remains trusted executable code, including imports and calculations performed during validation; see [definition validation](../../docs/busybee-workflows.md#validate-a-definition).

`preflight NAME [--source PATH] --json` checks the selected tracker's existing unfinished named runs against the selected repository's current definition or a proposed module. Without `--source`, the selected manifest supplies the candidate version. An explicit proposed module is independent of catalogue discovery and leaves version compatibility unchecked. The report covers version compatibility, structural snapshot restoration, active state/actor routes, frozen command contracts and rendering of the current frontier. An optional author `resumeSchema` validates persisted root actor context without replacing it with parsed/transformed output; `inputSchema` applies only at creation and is not a resume-context schema. Normal resume does not run `resumeSchema`. Without it, root context validation is explicitly unchecked. Child context schemas, future transitions, guards, actions, payload semantics and external effects remain unproved even when all available checks pass.

Preflight reads records without acquiring a mutation reservation, writing checkpoints/tasks, starting actors or spawning workers. It does import trusted definitions and call author validation/render functions; read-only engine behavior is not an I/O sandbox. Reports retain per-run failures and incompatibility produces a nonzero exit. Preflight is an authoring aid, not proof of future-path compatibility or the truth of completed work; see [preflight guidance](../../docs/busybee-workflows.md#preflight-existing-runs).

The retained [native integration tests](./tests/integration/native.test.ts) exercise repository tracker selection, schema discovery without a database and executable JSON errors; the memory-backed [failure test](./tests/integration/failure.test.ts) covers initial actor failure before tasks are created. The [current completion inventory](../../docs/test-cases/busybee.md#system-owned-completion-coverage) maps format-2 contract tests separately from historical closure, hierarchy, concurrency and publication-failure checks. The later [authorized lifecycle removal](../../docs/test-cases/lifecycle-slow-test-removal.md) identifies a rejected cohort whose historical source pointers do not authorize restoration. [Package agent guidance](./AGENTS.md#verification) maps the remaining checks. Update the relevant evidence when changing these decisions.
