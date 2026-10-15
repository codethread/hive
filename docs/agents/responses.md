# Agent response delivery

File the complete authored answer once as a response. Keep task comments for progress, verification and response pointers; workflow stage notes hold only Busy Bee's original `{choice,data}` result. Command syntax, pagination and JSON schemas live in `bee response --help`, its subcommand help, `bee result --help` and `bee response --schema`.

Bee/Colony owns the common runtime instructions in [`RESPONSE_PROTOCOL`](../../lib/colony/src/response-protocol.ts), appended to the selected kind system role for managed task executions and interactive Bee sessions. Kind prompts describe the role and its authority; the managed execution assignment supplies the exact producing run/stage. Private assessments and inactivity verdicts retain their separate protocols.

## Retrieve a bee's answer

1. Retain `request.id` from successful `bee spawn`, `bee attach-workflow`, `bee dispatch-stage` or `bee retry` output. Keep the same repository and selected tracker for subsequent reads. This is the execution request ID; the workflow run, assigned stage and external parent have separate IDs.
2. Inspect `bee status REQUEST --json`. While `disposition.outcome` is `pending`, execution may still be waiting, running or automatically retrying. Response availability is separate: a published answer can exist before settlement, and a closed request can lack one.
3. Retrieve the complete authored answer with `bee result REQUEST --json`. Read `response.body` alongside `request.outcome` and closure facts; a failed request can deliver a useful blocker report. This command selects the driver's run response or the dispatched worker's stage response for that exact request. Drivers own the complete synthesis; read individual worker responses explicitly when their evidence is needed.

Choose the request ID by lifecycle:

| Event | Result lookup |
| --- | --- |
| Colony recovery adopts a surviving execution, or automatically retries an attempt | Keep the same request ID and use `bee result REQUEST --json`. Attempts share that request's response lineage. |
| Explicit `bee retry OLD_REQUEST` creates a replacement | Save the returned `request.id`; use `bee status NEW_REQUEST --json` and `bee result NEW_REQUEST --json`. The run/stage is retained, while the response lineage is new. |
| Only the predecessor ID is known | Read `bee status OLD_REQUEST --json` and inspect `resolution.replacementIds`. Select the intended replacement explicitly; `bee result OLD_REQUEST` retains the predecessor's historical answer. |
| A response ID is already cited | Use `bee response get RESPONSE_ID --json` for that immutable artifact, including a superseded answer. Use `bee result REQUEST` to resolve the request's current corrected answer. |

Task-only lookup can be ambiguous after replacement requests or standalone deliveries; use the exact request or response ID. A missing, ambiguous or malformed response fails explicitly. Inspect `bee status` and the reported IDs: wait if execution remains pending; report incomplete delivery if a settled request has no response; resolve conflicting heads through an explicit producer correction. Task comments, workflow notes and logs provide supporting evidence. Request success alone does not guarantee an authored answer, and response availability alone does not establish success. Use `bee retry` only when replacing eligible failed work, rather than to recover a missing answer from completed work.

## Choose the producing task

| Execution | Response target |
| --- | --- |
| Workflow driver, including a one-stage do-work run | Its run bead |
| Bee-dispatched worker | Its assigned stage bead |
| Ordinary task outside managed execution | The explicit producing task |
| Review or advice | Its own report run/stage, rather than the examined implementation task |

A driver owns the run's complete final answer or synthesis. Read dispatched workers' responses explicitly and cite their response IDs when synthesizing conclusions. Source tasks and driver-handled stages retain concise proof and pointers instead of duplicate report bodies. An independently useful intermediate artifact may use an explicit standalone task-scoped response; it is separate from the managed execution's final delivery.

## Publish and complete

1. Write the full Markdown answer to a file. Preserve the supplied `BD_ACTOR`, selected tracker and execution identity. Publish against the target above and verify the returned response ID with an exact `bee response get` read. Managed publication defaults to `HIVE_SPAWN_ID`; an independent task-scoped artifact uses `--standalone`. Publication preserves human/HITL reservations and other identities' claims, and can finish interrupted delivery against completed work without reopening it.
2. Comment on the assigned work with concise deliverable references, verification results, limits and required next actions. A one-stage driver can publish its run response before closing the stage so the comment can cite it. For a workflow visit, save the selected outcome and original payload with `busybee record-result` before closure; response IDs need not be added to that payload.
3. Close only work whose acceptance and child work are satisfied. The driver consumes saved closed-stage results with `busybee collect`, including interrupted deliveries, and reads worker responses for synthesis. Busy Bee alone closes groups and the run. A response does not change task state, satisfy acceptance, advance the chart or prove success; it adds no response-required completion gate.
4. Before `bee finish success`, verify the driver's run is done or the worker's assigned stage is complete. For blocked work, publish and verify a blocker response against the same target, record blockers and next actions on unfinished work, leave it open and use `bee finish blocked` with the durable reason. Direct user conversations return their answer directly unless filing was requested.

Private post-run assessments and inactivity verdicts retain their own reporting commands and private artifacts. They are separate from task response delivery.

## Record identity and corrections

Bee creates a response atomically as a closed `docs` bead labeled `response`, owned by `ct`, with no assignee or parent. It is a filed artifact: never claim it, assign execution to it or use it as a work container. Its description is a versioned JSON document containing `formatVersion: 1`, `taskId`, optional `requestId`, `author`, the complete `body` and `supersedes`. Notes stay empty. Native identity and creation time identify the artifact.

Outgoing nonblocking links connect the response to its producing task (`replies-to`), its managed request when present (`related`) and corrected responses (`supersedes`). The document and links agree; filing does not mutate the producing task or publish the tracker to another clone. Follow the existing [publication checkpoints](../../AGENTS.md#storage-and-publication).

Responses are immutable. An identical publication by the same author with the same correction intent reuses its ID. To correct a delivery, publish a new response explicitly superseding every current head in the same task/request scope. Exact-ID reads retain the original body. Concurrent conflicting publications remain ambiguous until an explicit correction; there is no automatic latest-wins rule. If publication is uncertain, inspect the reported known effects and IDs before retrying.

Automatic retries and recovery retain the request and response lineage. A resumed producer inspects `bee result REQUEST --json` before publishing: an unchanged delivery can reuse its response ID, while a revised answer explicitly supersedes every current head in that scope. Explicit `bee retry` creates a distinct request ID and response lineage even when its producing task is unchanged; its response cannot supersede the predecessor request's response. A replacement request has no response bead until one is published. Exact `bee status` includes a compact availability summary; a broad request list does not expand response bodies.

## Retrieve historical evidence

Default response search includes filed closed records and returns bounded metadata, with full bodies expanded only through explicit get/result. Matches may come from body or provenance. Comments search returns candidates because native matching also examines titles and descriptions; notes search returns notes candidates. Each source has independent pagination; follow its continuation metadata.

Explicit comment history preserves original author, time and text. It bounds returned entries but fetches all comments for the selected task; numeric comment IDs are local conveniences. Portable citations use task ID plus author/time/text. Notes history is a full current snapshot with revision time and unknown authorship, not an inferred authored report. Existing comments and notes remain historical evidence: no backfill, relabeling or silent conversion into responses.

## Specialist evidence

General response publication grants no `evidence:*` stewardship. Specialists retain independently useful [filed evidence records](../beads-meta.md#filed-specialist-evidence) and their registered curation history. Those records can cite response IDs while retaining compact questions, decisions, corrections and outcomes; they need not duplicate complete report bodies. Filing a review response or evidence record completes neither the examined implementation nor its landing acceptance.
