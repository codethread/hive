# Bee and Busy Bee composition

This record retains the rationale for separate request and workflow interfaces from the original POC. Production composition lives in [workflow submission](../../lib/colony/src/workflow-submission.ts); [architecture](../architecture.md) owns package boundaries. Current operation contracts belong to the [Bee guide](../../lib/colony/README.md#create-requests), [Busy Bee specification](../../lib/busybee/SPEC.md) and focused command help.

## Two identities and authorities

Bee creates a workflow beneath existing ordinary work, prepares driver admission through Busy Bee, then publishes a request for that run. The returned `request.id` identifies execution and authored delivery; `workflow.runId` identifies the durable assignment. Bee-dispatched stages reuse existing visits through `bee system dispatch-stage`, avoiding a recursive workflow wrapper.

Busy Bee owns chart progression, visit projection, checkpoints and native workflow disposition. Colony owns request admission, claims, attempts, supervision and execution settlement. Native Beads owns task state and assignment. Source/parent acceptance remains separate from all three. A failed driver request alone does not fail its run; a successful replacement does not rewrite its predecessor's outcome.

The process boundary is injected and typed. Colony consumes native lifecycle through `inspect`, work through `inspect --work`, and admission through `advance --prepare-driver`. Shared owns consumed wire parsers, not workflow policy. The package entry exposes Busy Bee's `inspect`, `advance` and `settle` operations plus creation and stage primitives; product consumers still use commands under the import rules.

## Why keep separate products

The original POC showed that submission could hide workflow initialization and handoff while execution retained two focused CLIs. A façade could route the same operations, but command count alone would not remove run/stage confusion or their distinct authority. The original probe confused a stage argument once; it did not establish that merging engines was necessary.

The alternatives remain architectural choices, not pending implementation requirements:

- A façade could reduce command selection overhead if observed agent use warrants it, without adding another progression engine.
- A shared engine package would need an actual second runtime consumer and explicit ownership/import-rule changes. Move cohesive workflow responsibilities together, not into Shared as an import-rule workaround.
- Product consolidation would broaden ownership and give up some independent replaceability. It is not implied by exporting runtime functions.

The current command composition preserves independently replaceable tools and one implementation of each lifecycle. Direct runtime calls in the original Busy Bee-local POC did not authorize cross-product imports.

## Partial effects and continuation

Workflow creation, admission preparation and request publication are separate effects. Submission reports known run/request IDs and whether driver publication was attempted or uncertain. Inspect confirmed effects before retrying. `bee attach-workflow --help` owns confirmed-orphan recovery; `bee retry --help` owns eligible failed-request replacement. Neither authorizes a duplicate run after uncertain publication.

Workers preserve original `{choice,data}` through `complete`; drivers use `advance` to consume closed results. `--prepare-driver` selects admission only. Busy Bee alone closes groups and the run. The [work contract](../../lib/busybee/SPEC.md#work-and-progression) owns completion ordering; [response delivery](../agents/responses.md) owns authored answers separately from those outcomes.

Request closure or `bee stop` intent is not process-exit proof. Stopped-driver cleanup preserves independent workers, reservations and completed work. [Settlement](../../lib/busybee/SPEC.md#unsuccessful-settlement) supplies supported run retirement; [workflow adoption](../../lib/beeswax/README.md#workflow-tool-adoption) coordinates owning-host clearance and tool cutover without replaying completed effects.

## Agent context

Colony's launch protocol composes the captured role, shared response protocol and driver/stage assignment. Busy Bee appends discovery and completion pointers to generated visits. Workflow authors supply domain work; kind prompts supply specialization. Neither needs a copied orchestration manual.

Drivers inspect explicit work, perform only their available visits, read worker answers and advance saved outcomes. Stage workers complete only their assigned stage. The run brief owns caller tails, and `bee finish --help` owns execution reporting. Supporting workflow work stays beneath its run; independent delegation still requires the caller to obtain required results.

This is an instruction-derived map, not a claim that every harness loads every source. Skill descriptions advertise conditional reads; skill bodies load only on demand. Audit the actual composed launch and visit text when these sources change.
