# Bee and Busy Bee API proposal

Status: historical paper design from the POC. Production follow-on hv-gw9ag implements the separate CLI composition; current commands and contracts live in the [Bee guide](../../lib/colony/README.md#create-requests) and [Busy Bee guide](../../lib/busybee/README.md). The direct `next`/`choice`, native-close and JSON-notes procedures below are obsolete: the [current completion contract](../../lib/busybee/SPEC.md#work-and-progression) uses `complete` → `collect` with system-owned results. Preserve this paper as rationale, not an execution runbook. Alternative package/surface designs below remain proposals.

Recommend **Bee composing Busy Bee at submission, with two focused CLIs during execution**. Keep one implementation of workflow progression. A single executable can offer both APIs, but it does not remove their distinct identities, lifecycles or authority. Add that façade only if observed agent use warrants it.

## What the POC establishes

The [production submission](../../lib/colony/src/workflow-submission.ts) starts a Busy Bee run and submits exactly that run to Bee. Its default stage contains the actual caller assignment and verification instructions. Colony watches run closure and releases unfinished descendants assigned to a stopped driver. Independent workers retain their assignments.

The original POC called Busy Bee's runtime inside its own package and invokes Bee through its CLI. Its prototype is replaced by production workflow submission, kind defaults and separate stage dispatch. The remaining paper records the design rationale and alternatives considered.

These responsibilities already have separate implementations:

| Responsibility | Current implementation | Authority |
| --- | --- | --- |
| Select a kind, capture recipe and create a request | [Colony producer](../../lib/colony/src/producer.ts) | Bee submission |
| Claim work, supervise attempts, stop and retry | [Colony request lifecycle](../../lib/colony/src/request.ts) | Colony |
| Resolve definitions, validate initial input and create a run | [Busy Bee runtime](../../lib/busybee/src/runtime.ts) | Busy Bee |
| Decide transitions, publish visits and save checkpoints | Busy Bee runtime and workflow chart | XState and Busy Bee |
| Record work, assignment, evidence and native closure | Native Beads through `br` | Task actors and Beads |
| Validate an execution's finish report | [Colony launch protocol](../../lib/colony/src/launch.ts) | Colony execution provenance |

## API 1: Bee assignment and execution

Proposed public submission:

```sh
# Kind default, normally the standard do-work workflow.
bee spawn worker --input-file work.json --cwd /path/to/worktree --json

# Named workflow from the execution checkout's catalogue.
bee spawn worker --workflow land --input-file land.json \
  --cwd /path/to/worktree --json

# Explicit definition for an experiment.
bee spawn worker --source /path/to/workflow.ts --input-file input.json \
  --cwd /path/to/worktree --json
```

`--workflow` and `--source` are alternative selectors. Omission selects the kind's configured workflow, with a standard do-work default supplied by repository setup. A missing selected definition fails visibly. The default workflow's distribution/setup is implementation scope; the existing POC uses a bundled example source.

Reuse Bee's existing actor, selected tracker, model, effort, harness and execution-directory options. Initial input comes entirely from the caller and is validated against the selected workflow. The default input is `title`, `request` and `acceptance`; custom charts define their own input schema. Verification criteria are stage instructions unless a definition explicitly projects native acceptance requirements.

Preserve directory meanings: Bee's `--repo` discovers canonical configuration; `--cwd` selects execution. Omitting `--cwd` retains Bee's current canonical-root execution default. Busy Bee resolves the catalogue from the execution checkout, not automatically from the canonical root; schema discovery must use that same checkout through `--repo`. Resolve `--source` and input paths relative to the submitting command's directory before changing subprocess directories. Translate Bee's `--beads-db` to Busy Bee's `--db`; preserve the same actor and human owner. A workflow input named `worktree` remains schema data, not an implicit execution-directory override.

Submission order:

1. Resolve kind defaults and overrides, execution checkout and tracker.
2. Start the selected workflow once through Busy Bee, with the run and initial driver-handled stages unassigned.
3. Ask Busy Bee to prepare the active run for delegation; make it ready and append driver instructions using the existing POC handoff until that interface exists.
4. Create one driver request linked to the run.
5. Return both identities, without implying dispatch or completion.

Proposed result fields: `request.id`, `request.identity`, `workflow.runId` and `workflow.status`. The request is an execution request; the run is the durable assignment. A stage ID names one visit beneath that assignment. Avoid an ambiguous single `id` or mixing workflow status into request outcome.

Keep existing request operations: `bee status REQUEST`, `bee stop REQUEST`, `bee retry REQUEST`, and attempt-scoped `bee finish success|blocked`. Retry retains the same run and captured workflow input; changing a kind's default must not initialize a replacement workflow. Automatic attempts retain their captured request and identity. An explicit retry uses current execution defaults or overrides and a new bee identity, as it does today. It requires an unresolved unsuccessful request with unfinished assigned work; cancellation or an already-closed run does not supply that condition.

## API 2: Busy Bee workflow operations

Keep the existing workflow API and command meanings:

| Operation | Command shape | Meaning |
| --- | --- | --- |
| Catalogue and initialization schema | `busybee list`, `busybee input-schema NAME` | Discover definitions and caller requirements |
| Start without a Bee driver | `busybee run NAME --input-file FILE --owner HUMAN` | Create a standalone run; Bee-dispatched stages may still delegate |
| Inspect a saved run | `busybee show RUN` | Read active visits and workflow status |
| Discover valid outcomes | `busybee discover RUN` | Read current stage IDs, choices and payload schemas |
| Submit a completed stage | `busybee next RUN STAGE` | Submit the declared `next` outcome of a closed active stage |
| Submit another outcome | `busybee choice RUN STAGE OUTCOME --data-file FILE` | Validate and apply a declared choice |
| Collect Bee-dispatched workers | `busybee collect RUN` | Read worker results and advance their visits |

Workers read and claim their driver-handled stages, do the work, record verification and close those stages through `br`. Busy Bee advances from accepted results and closes grouping beads and the run. The driver calls `bee finish success` only after the run reports done. A blocked driver records the blocker and reports `bee finish blocked`.

The Luna probe confused the task argument to `next` once. Regardless of CLI prefix, help and discovery must clearly identify **RUN and STAGE** and distinguish them from an outcome name. Putting all commands under `bee` would not itself fix this argument contract.

## Bee-dispatched stages need a separate execution primitive

If public `bee spawn` always creates a workflow, Busy Bee's current call to `bee spawn` for Bee-dispatched stages would recursively wrap each stage. Changing public submission therefore also requires changing that internal call.

Propose a single-bead execution primitive, with an explicit CLI seam for Busy Bee:

```sh
# Workflow integration operation; creates no new workflow.
bee system dispatch-stage KIND STAGE --run RUN --json
```

This reuses Bee's request creation, admission, identity, supervision and finish handling. It assigns one already-created stage. The driver submission uses the same lower-level producer to assign one run. The low-level primitive never selects a kind's default workflow.

Persist the distinction in the shared request contract: a driver request names its run; a stage request names its run and stage. This lets Colony materialize the correct execution instructions without guessing from titles or relying on a prompt-only convention. It is proposed request representation, requiring coordinated consumer updates, not a CLI-only edit.

Bee-dispatched workers do and verify the work, save JSON notes containing `choice` and its schema payload, close their stage, then finish their execution. They must not call `next` or `choice`; the driver collects their results. A replacement driver resumes coordination without reassigning those workers. An alive driver consumes capacity while waiting for workers, and collection reads closed-stage notes rather than failed spawn disposition. Capacity and blocked-result propagation need explicit workflow policies before productization.

## Compare the surfaces

| Design | Caller and driver commands | Code reuse | Agent/documentation cost | Package consequence |
| --- | --- | --- | --- | --- |
| Separate, caller composes manually | Caller starts Busy Bee and then submits Bee; driver uses both | Existing engines reused | Caller must handle readiness, partial submission and run/request mapping | Fits current graph, but leaks POC coordination |
| **Bee composes submission; two focused CLIs** | Caller uses `bee spawn`; driver uses Busy Bee plus `bee finish` | One workflow engine and one request producer | Two command names, one short driver loop; no duplicate navigation grammar | Fits current graph through CLI seams; recommended |
| Bee façade over Busy Bee | Caller uses `bee spawn`; driver uses `bee workflow …` and `bee finish` | Same Busy Bee CLI/runtime, with a routing adapter | One agent-facing executable; help and generated instructions must use the same spelling | Fits current graph through process composition |
| Consolidated product, one CLI | Bee owns workflow and request subcommands | One workflow implementation retained inside the merged product | One executable still exposes both lifecycle vocabularies | Explicit ownership/package change; couples replaceable products |
| Shared workflow engine, two thin CLIs | Both call a common workflow implementation; Bee keeps request operations | Direct runtime reuse without child processes for workflow calls | Command count remains a presentation decision | New dependency graph and engine ownership required |

Two CLIs work when their responsibilities and the run/request distinction are explicit. The current POC and live linear probe support that conclusion, but do not establish that arbitrary workflow coordination is reliable or that two CLIs are optimal.

A Bee façade is a reasonable ergonomic alternative. Proposed `bee workflow ARGS…` forwards to Busy Bee's existing parser, preserving its argument grammar, output and exit status. `bee workflow --help` comes from Busy Bee; Bee does not maintain a second command table or reinterpret workflow outcomes. The router must forward failures once, preserving the one-document JSON contract. It adds child-process startup; measure that in a focused driver loop before treating it as a reason to move engines.

If the façade becomes the agent convention, also change generated stage discovery commands, driver instructions and workflow-related guidance to that spelling. A façade whose task briefs still direct agents to `busybee` does not deliver the intended single surface. Command spelling should be presentation data rendered by the CLI/brief adapter, not another workflow progression implementation.

## Engine reuse and package placement

[Busy Bee already exports its runtime](../../lib/busybee/package.json). Its CLI is an adapter over `start`, `startNamed`, `navigate` and `discover`. That is the workflow engine to reuse; Bee's request state machine remains a different engine.

The current [architecture](../architecture.md) allows cross-product imports through Shared and Beads. Consequently, production Colony cannot simply import `@hive/busybee`. The POC's direct call is inside Busy Bee and does not establish an exception.

Three concrete reuse placements:

- **Current graph:** Colony invokes Busy Bee through injected command services. Busy Bee invokes the new stage-dispatch seam when needed. Do not copy charts, schema validation, checkpoint logic or navigation into Colony. Reuse Shared's request representation, Beads services, endpoint and error contracts where actual consumers agree.
- **New workflow engine package:** move definition/catalogue loading, XState navigation, task projection and checkpoint ownership together into an explicitly owned base package. Bee and Busy Bee CLI adapters consume it. Keep kind configuration, attempts, supervision and request settlement in Colony. Inject stage dispatch through a small port; the engine imports no Colony product. This requires a deliberate architecture/import-rule change and an actual second runtime consumer.
- **Merged product:** keep both executable names or one namespace, but place the workflow implementation in the same owning package as its CLI consumers. This permits direct calls without an artificial Shared dependency, at the cost of broader product ownership. Choose it only if independent replacement of Bee and Busy Bee is no longer a project goal.

Do not move the entire workflow runtime into Shared to bypass the rule. Shared currently owns common contracts, while Beads owns native tracker I/O; adding domain progression there would change its responsibility. Direct engine sharing is technically feasible, but it is a packaging decision, not something obtained merely by exporting functions.

For the recommended composition, reuse the existing runtime operations. A small Busy Bee delegation operation can own active-run readiness and driver briefing, replacing the POC's caller-managed native update. Bee owns the final request creation. That handoff is useful depth because it hides real workflow initialization semantics; a second universal orchestration engine would duplicate two existing lifecycles.

## Failure and completion contracts

- Invalid initial input creates no run or driver request. A run that finishes during initialization stays closed and creates no driver; retain the POC's visible `workflow_already_done` outcome unless a separate no-work success policy is chosen.
- Workflow creation and request creation remain separate effects. Report every known run, checkpoint and request ID on partial failure, including any stage dispatch requests created during initialization. Distinguish confirmed absence of a driver request, a known created request and uncertain publication; inspection precedes any retry.
- A run with no driver request needs a same-run driver-attachment operation that performs native admission without initializing another workflow. Its spelling and authorization remain unresolved. Public `bee spawn` would create another run, and `bee retry` requires an existing eligible request, so neither is an orphan-run recovery contract. Do not promise automatic recovery, rollback or idempotency before that seam is designed; preserve uncertain-publication locks.
- Busy Bee alone decides workflow completion. Colony decides execution settlement by observing the assigned run or stage and validated finish reports.
- Stopped-driver cleanup follows native parent-child links beneath its recorded claims and clears only unfinished assignments held by that identity. Closed work, human reservations, native blocked states and independent identities remain intact.
- `bee stop REQUEST` stops that execution after verified reconciliation. It is not a promise to cancel the entire workflow and all Bee-dispatched workers. Whole-workflow cancellation is a separate unresolved operation.
- Checkpoints persist the XState snapshot and versioned definition locator, not a copy of source code. Named definitions resolve in the continuation checkout and must satisfy the forward SemVer caret range from the saved manifest version; their folder hashes record provenance. Explicit sources retain their original path and require the saved entry-file hash to match. Authors own imported dependencies and compatibility of persisted state and frozen task commands. Existing uncertain-publication locks and finite retry limits remain; consolidating CLI names changes none of them.
- A driver-handled stage's selected outcome and payload need durable evidence before closure for interruption recovery. The POC's empty-payload `next` continuation does not establish arbitrary-payload recovery; the exact durable delivery contract remains to be designed.

## Agent guidance and discovery

For the final version, update the shared bee execution guidance: additional task beads created as part of the current workflow's work must have the main workflow run bead as their native parent. Native parent closure then requires that work to finish before the run can close, preserving the run as Colony's completion anchor. Separate work, including separate task beads used for delegation to other agents, need not share that parent. Such work is outside the run's automatic completion check; the driving bee remains responsible for obtaining any results its assignment requires before completing the workflow. This is a future guidance requirement, not a creation-time check in the POC, and additional children do not become workflow stages automatically.

This is an instruction-derived map, not a measured trace of every harness. Root instruction injection and skill-description discovery vary by harness. A skill description is not its loaded body. The proposed guidance below does not add full workflow reference material to every agent's startup context.

| Agent situation | Small guidance needed | Material reached on demand |
| --- | --- | --- |
| Delegating caller | Choose kind, provide workflow input, submit and inspect both returned identities | `bee spawn --help`, kind discovery, Busy Bee input schema in the execution checkout |
| Workflow driver | Read run; discover active stages; claim/do/verify/close driver-handled work; advance or collect; finish only when done | `busybee discover RUN`, relevant outcome schema and command help |
| Bee-dispatched stage worker | Work only on assigned stage; save JSON notes before closing stage, then finish | Stage brief, result schema, `bee finish --help` |
| Workflow author | Definition and ownership contract | Busy Bee specification and workflow authoring guide |
| Operator investigating execution | Request outcome and process evidence are separate from workflow status | Bee status, Colony inspection/explanation, workflow show |

Proposed driver loop:

```text
read run -> discover stages -> do and verify driver-handled work -> close stage
         -> advance / collect -> repeat until run done -> finish execution
```

Update the existing locations when implementing the chosen design:

- Root `AGENTS.md`: replace task-list submission guidance with one workflow assignment and a pointer to command help. Preserve tracker ownership, evidence and publication rules.
- Bee command help: explain caller input, kind default/override, run versus request, and no-work/partial-submission outcomes. Keep the internal stage operation clearly identified as workflow integration.
- Colony's shared launch protocol: materialize driver or stage-worker steps from persisted execution scope. Kind prompts retain specialist role restrictions; they do not each carry a copy of the orchestration runbook.
- Busy Bee discovery and generated task briefs: put required stage IDs, choices, schemas and closure authority beside the current work. Match the chosen canonical command spelling.
- Bee and Busy Bee user guides: keep delegation lifecycle and workflow operation reference in their owning guides, with links at the seam. Workflow-related skills use those commands and carry their domain-specific work, not a duplicate engine runbook.

Under a façade, the driver substitutes `bee workflow` for the Busy Bee prefix; the work loop and two identities stay the same. Standalone Busy Bee remains available for workflow authors and workflows without a Bee driver. Document one canonical spelling for delegated agents, rather than teaching interchangeable aliases at startup.

## Recommendation and next proof

Use Bee composition at submission and retain Busy Bee progression for the next POC. This removes caller-managed handoff while preserving existing engine ownership, and the current evidence has not shown CLI count itself to be the principal failure source.

The next focused comparison should give equivalent agents the same small workflow through the two-CLI loop and the Bee façade. Observe wrong command selection, run/stage confusion, repeated help reads, completion/blocked behavior, context loaded and command overhead. Reuse one fixture and one workflow engine; do not duplicate a full integration suite for each spelling.

If that comparison favors the façade, ship its routing and coherent help/brief presentation without merging engines. Choose direct shared-engine calls or product consolidation only after an explicit package-ownership decision or measured process overhead warrants it. This paper proposes those decisions; it does not authorize implementation or establish new repository policy.
