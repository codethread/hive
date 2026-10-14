# Agent response delivery

File the complete authored answer once as a response. Keep task comments for progress, verification and response pointers; workflow stage notes hold only Busy Bee's original `{choice,data}` result. Command syntax, pagination and JSON schemas live in `bee response --help`, its subcommand help, `bee result --help` and `bee response --schema`.

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

A Bee retry has a distinct request ID and response lineage even when its producing task is unchanged. `bee result REQUEST` selects only that exact request's captured run/stage and returns its response plus native outcome facts. Older request IDs remain historical; task-only resolution can be ambiguous. Missing, ambiguous or malformed responses fail explicitly, without falling back to comments or notes. Exact `bee status` includes a compact availability summary; a broad request list does not expand response bodies.

## Retrieve historical evidence

Default response search includes filed closed records and returns bounded metadata, with full bodies expanded only through explicit get/result. Matches may come from body or provenance. Comments search returns candidates because native matching also examines titles and descriptions; notes search returns notes candidates. Each source has independent pagination; follow its continuation metadata.

Explicit comment history preserves original author, time and text. It bounds returned entries but fetches all comments for the selected task; numeric comment IDs are local conveniences. Portable citations use task ID plus author/time/text. Notes history is a full current snapshot with revision time and unknown authorship, not an inferred authored report. Existing comments and notes remain historical evidence: no backfill, relabeling or silent conversion into responses.

## Specialist evidence

General response publication grants no `evidence:*` stewardship. Specialists retain independently useful [filed evidence records](../beads-meta.md#filed-specialist-evidence) and their registered curation history. Those records can cite response IDs while retaining compact questions, decisions, corrections and outcomes; they need not duplicate complete report bodies. Filing a review response or evidence record completes neither the examined implementation nor its landing acceptance.
