# Busy Bee specification

Busy Bee is a general-purpose workflow engine. Domains supply charts, schemas and task briefs; the engine owns their projection into Beads. See the [user guide](./README.md) for commands and the [authoring guide](../../docs/busybee-workflows.md) for the definition contract.

## Work and progression

**Ordinary work contains each root workflow.** `run` and `start` require an explicit existing parent in the selected tracker. The parent must be nonclosed and lack the `system` label; ordinary bugs are accepted alongside tasks, features and epics. Common root initialization reads and validates it before publishing any run, checkpoint, visit or request. The run has one native `parent-child` edge to that work through `CreateTask.parent`. The parent is neither claimed nor closed by Busy Bee. Nested XState actors remain inside the run's existing visit/group hierarchy; they create no additional root workflow.

**XState owns progression; Beads owns work.** Sequential stages are siblings. Nested tasks belong to their nearest bead-bearing container; dynamic actors name their containing group. Final states mark completion without creating work. This preserves the distinction between doing something next and doing it as part of another task.

**Each bead represents a visit.** Only work at a published frontier is created. Its task callback renders the brief once, which remains fixed for that visit. An accepted worker result retires the visit even when a loop returns to the same state; untouched parallel tasks retain theirs. Projection observes published frontiers, not every XState microstep: unsubmitted states that leave and re-enter within one macrostep may retain their visit.

**Workers complete; the driver collects.** `complete` validates an active worker visit's outcome and saves the original `{choice,data}` JSON in native task notes. After that checkpoint write and lock release, a separate short close phase reacquires ownership, checks for retirement and attempts ordinary native closure with a `succeeded` fact. Closure enforces native Beads acceptance and child-completion gates. A closure refusal preserves the saved result; the close phase releases its lock. Completion does not advance the workflow. Narrative evidence belongs in comments; `record-result` remains the save-only primitive.

While the run and visit remain eligible, a retry with identical saved original choice and data can finish closing an open visit or acknowledge a matching successful closure, including after collection. It does not replace the saved outcome. Different or malformed saved results fail explicitly; a closed visit without saved evidence also fails. The envelope retains original input rather than schema-transformed output, so collection parses that input once when consuming it. These ordered writes are not an atomic transaction across result persistence and native closure.

**Busy Bee owns progression.** `collect` consumes saved results from closed active driver-handled and Bee-dispatched visits, permitting a replacement driver to continue arbitrary payloads. Direct `next` and `choice` submissions require a still-active, already-closed driver-handled visit and a valid result. Failed or cancelled visits cannot advance; stale outcome-label projections fail explicitly. Closure is not independent verification of the work; native policy can be overridden outside Busy Bee. An eligible closed visit with a valid result remains consumable independently of its execution request; an unfinished Bee-dispatched visit whose terminal request has no pending replacement fails visibly with run, stage and request identifiers.

**Containers outlive their tasks.** Containers have no worker outcome. Busy Bee closes them when their stage finishes and closes the run on completion. Transitions that would create children beneath an existing closed bead, including the run, fail before publication. Completed work is never reopened to serve as a container.

## Native workflow outcomes

Native closure is authoritative for generated run, visit and grouping beads. Busy Bee writes JSON `close_reason` in the same native close operation that records `closed_at`:

```json
{
	"kind": "busybee-lifecycle",
	"formatVersion": 1,
	"scope": "visit",
	"runId": "example-run",
	"outcome": "succeeded",
	"reason": "Original worker result saved; visit completed."
}
```

`scope` is `run`, `visit` or `group`; `outcome` is `succeeded`, `failed` or `cancelled`. A nonclosed bead is pending. An old unmarked closure is unclassified, not inferred success. Malformed marked facts or facts inconsistent with the native closure, run or scope fail visibly. The [Shared decoder](../shared/src/workflow-lifecycle.ts) owns this consumed representation.

A worker choice answers the workflow's question; the closure fact describes execution. A review choosing `changes` can therefore complete successfully. Original `{choice,data}` stays in visit notes. Later retirement preserves completed descendants, their results and their closure facts. Native run outcome is distinct from the XState snapshot status returned by existing run views and previews.

Busy Bee publishes the [registered outcome query labels](../../docs/beads-labels.md#taxonomy) after closure as a separate write. They are a derived index, never outcome authority. Projection failure retains native-close evidence and fails explicitly; inspect the reported bead and checkpoint before recovery. This is not a bulk historical classification or backfill mechanism.

## Bounded unsuccessful settlement

`settle RUN cancel|fail --reason TEXT` retires pending generated scope; `settle --help` owns invocation, schemas and diagnostics. It reads the checkpoint inventory without importing the workflow definition. It closes pending visits and groups bottom-up, then the run, with `cancelled` or `failed` facts. It leaves the saved chart state unchanged and does not submit authored outcomes.

Settlement requires agreement between the checkpoint inventory and complete native ancestry. It preserves completed work and refuses unfinished manual descendants, human/HITL or other-agent reservations, and unsupported inventory. Ordinary native acceptance and child gates still apply. It neither closes the source task or ancestors nor decides their acceptance.

New runs begin with checkpoint `managedExecution: "unmanaged"`. Before driver handoff effects or Bee-dispatched stage publication, Busy Bee stamps the coherent prior checkpoint `managed` under its existing ownership; that exposure never resets. Missing historical provenance is unknown, not proof of no execution; invalid present values fail. Explicit unmanaged provenance plus complete native inventory agreement and no contradictory requests permits settlement without a daemon.

Managed or unknown exposure requires fresh clearance from the running owning-host Colony daemon registered for the selected repository/database. Busy Bee retains checkpoint ownership through inspection and closure; Colony serializes clearance with final claim/reservation/supervisor admission and checks native requests and retained attempts. Missing history, foreign/unbound hosts, live or unverified processes, and marked manual execution refuse clearance. Request publication and execution admission honor the native run/settlement fence. [Colony's clearance interface](../colony/README.md#workflow-execution-clearance) owns the observation contract.

A run-note settlement intent fences further publication; it is not an alternative outcome. Partial effects retain that intent, checkpoint ownership and confirmed/uncertain IDs for inspection. There is no automatic replay, unlock or held-lock recovery. Settlement does not stop processes or supply a general workflow resolution engine. These guarantees require cooperating version-matched tools on one live database, not concurrent tracker exchange, arbitrary native edits, old writers or externally detached execution.

## Contracts and authority

Zod schemas drive validation and CLI discovery; task briefs describe work instead of copying payload templates. Definitions can add context-dependent validation and explain those constraints in discovery. Author outcomes and runner operations have separate identities, so outcome names are unrestricted by runner command names.

The caller's Git checkout supplies the workflow catalogue; native `br` selects the tracker. Execution directory and database storage remain independent. Named manifests require full SemVer versions. Named runs resolve their saved name in the current checkout, allowing continuation after worktree removal when the current version satisfies the forward caret range from the saved version. Equality and newer compatible patch/minor versions are allowed; downgrades and major changes are rejected. Major-zero ranges follow caret's narrower boundary (`0.2.3` permits versions below `0.3.0`; `0.0.3` permits only itself). Prereleases require exact SemVer equality; build metadata does not affect equality or precedence. A successful mutation persists the current manifest version for subsequent restores; read-only inspection does not persist that update.

Catalogue discovery excludes `.workflows/node_modules`. Named fingerprints record provenance, not compatibility: they include regular files in the workflow folder recursively, excluding every `node_modules` entry, plus existing regular files named `package.json`, `bun.lock`, `bun.lockb`, `package-lock.json`, `pnpm-lock.yaml` and `yarn.lock` directly under the shared `.workflows` directory. Explicit-file fingerprints cover only the entry file's bytes and must match before import. Neither fingerprint verifies installed dependency contents or external imports. Authors own preservation of state IDs, actor routes, persisted context and frozen task command contracts across compatible named versions; see [version authoring](../../docs/busybee-workflows.md#version-saved-workflow-contracts).

Snapshot compatibility and authorization are separate. When the saved named workflow still exists but cannot resume compatibly, a bee may create a fresh run of that same workflow for the same already-authorized scope without renewed user approval. Preserve the original request, source/target, scope, ownership/assignment intent, tracker and old run/task/evidence references. Inspect completed and uncertain effects and enter the current workflow's triage to continue remaining work; permission to re-mint does not authorize blindly replaying effects or skipping current checks and reviews. Retain the old run as history; its disposition is separate.

If the saved named workflow folder is absent, stop and ask the user which workflow to use. An existing folder with a missing/malformed manifest, invalid entry or unrelated I/O failure retains its actual diagnostic. The engine neither creates replacement runs automatically nor selects a substitute name or migrates snapshots. It rejects incompatible named versions and changed explicit files before importing them. This recovery guidance applies when restoring existing checkpoints through inspection or mutation; explicit-file runs retain file-based guidance.

Identity follows native Beads roles: the current actor receives mutation attribution; the human owner remains accountable; the run's assignee determines assignment of driver-handled tasks. Grouping and checkpoint beads have no assignee. Bee-dispatched tasks are left for Colony to claim. [Ownership options](./README.md#ownership-and-assignment).

## Checkpoint and failure boundary

Readable run and task beads stay separate from machine state. A related bead labelled `system` and `busybee-checkpoint` stores the deep XState snapshot and visit history in its description, with the lock UUID and diagnostic PID in its notes. The `system` label excludes it from ordinary task selection; a nonblocking `related` edge makes it discoverable without adding a work prerequisite. Beads relationship metadata is not checkpoint storage.

The engine checkpoint's `formatVersion: 1` is independent of the named workflow's SemVer. Restore validates a small versioned header identifying the run and definition, then trusts the engine-owned snapshot, active visits, history and visit counts in the stored body. It does not recursively validate every persisted field or repair edited checkpoints. Old, missing or unknown format versions fail with deliberate regenerate guidance: inspect existing effects, preserve evidence and start a fresh run. There is no legacy decoder or checkpoint migration.

Checkpoint mutations use native `br update --if-unchanged` to acquire a per-invocation lock and read fresh state. Progression validates the submission batch, advances actors, publishes task/Bee effects and saves the checkpoint. Result persistence and subsequent native closure follow the [completion ordering](#work-and-progression). Release is conditional on ownership. Agents work outside this short lock; contenders wait up to ten seconds and never steal it. All writers must share one live database: [tracker synchronization](../../docs/beads-integration.md) is not a distributed lock.

Failures before a publication write is attempted release ownership. Once a write is attempted, uncertain failure retains ownership for inspection. Multi-write effects are not transactional: initialization can leave orphan records, and later failures can leave partial tasks or Bee requests. There is no automatic expiry, retry or recovery. A PID alone does not establish ownership; inspect native records and the owner before explicit recovery, and prefer a fresh run after uncertain effects.

Partial-effect creation errors retain the known `parentId`, even when the run creation response is uncertain. Initialization also reports confirmed `runId` and `checkpoint` identities and the `uncertainOperation`; initial frontier publication keeps its existing checkpoint-lock failure contract. The native parent edge is the containment authority, without another parent copy in the checkpoint.

## Saved-state preview

Public CLI run views (`run`, `start`, `show`, `collect`, `next`, `choice`) expose run status and visit references without actor context or instruction bodies. `show --instructions` adds the exact frozen text from each active visit's saved `meta.instructions`; it does not rerender that brief or expose raw context. Runtime APIs, checkpoints and native task descriptions retain their full content. Native run/task briefs remain authoritative for current work and caller completion instructions. See `show --help` for fields and inspection commands.

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

The retained [native integration tests](./tests/integration/native.test.ts) exercise repository tracker selection, schema discovery without a database and executable JSON errors; the memory-backed [failure test](./tests/integration/failure.test.ts) covers initial actor failure before tasks are created. Earlier closure, hierarchy, concurrency and publication-failure checks are parked in the [Busy Bee coverage record](../../docs/test-cases/busybee.md). The later [authorized lifecycle removal](../../docs/test-cases/lifecycle-slow-test-removal.md) identifies a rejected cohort whose historical source pointers do not authorize restoration. [Package agent guidance](./AGENTS.md#verification) maps the remaining checks. Update the relevant evidence when changing these decisions.
