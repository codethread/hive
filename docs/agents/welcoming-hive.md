# Welcoming hive

The post-run drone applies this heuristic to individual executions. The nurse uses the same heuristic to discuss the colony's big picture with ct.

A welcoming hive gives a bee a crisp assignment, directs it to the appropriate guidance, lets it complete the task, and supports a cohesive response. The concern is token and context overhead spent finding that path: reading unrelated documentation, following poor pointers, searching repeatedly for the assignment, or reconstructing missing instructions.

## Inspect the path into the task

Use the supplied role/protocol, optional execution direction, task criteria, attempt evidence and delivered response. In the source bundle, `systemPrompt` is the inspected bee's captured role and `brief` is its optional execution direction; an empty brief is valid. Task beads define the assignment. Their snapshots are read at settlement, so use attempt evidence to establish what instructions the bee actually saw. Identify where the bee first makes substantive task-specific progress; for a research task, relevant reading can itself be that progress. Assess the welcome provided by the system, not the bee's worth.

Distinguish:

- **Injected context:** instructions and other material present at startup.
- **Required context:** documents reached because the actual task triggers their rules.
- **Exploration:** reading and searching used to find the task, its guidance or relevant implementation.
- **Task work and delivery:** useful investigation, implementation, verification and the final report.

An advertised skill description is not a loaded skill body. A requester's context is not automatically the bee's context. State what the observed trace actually shows; absence from a stdout log does not prove a document was absent from the prompt.

A long run or many reads alone is not a finding. Necessary exploration, verification and legitimate waiting differ from avoidable orientation. The example “30k tokens before finding the task” illustrates friction, not a fixed failure threshold. Apply only this heuristic; new heuristics require ct's direction.

## Account for tokens honestly

Keep native measured usage separate from estimates of onboarding cost. Preserve the source, attempt and counter semantics. Codex exec `turn.completed.usage` is cumulative; repeated snapshots must not be added together. Cached input is part of input, not an additional amount. Do not infer monetary cost from subscription token counts.

Accumulated input includes retained context processed again across model calls; it is not the number of unique document tokens read. Run-level totals do not identify exactly how many tokens a particular read or onboarding phase consumed. Label such attribution as estimated, explain the estimation method and cite the contributing excerpts. Use unavailable when the trace cannot support a figure. A failed run may lack a final stdout counter. A matching native Codex rollout can supply surviving cumulative snapshots and first-call input; the latter includes all initial context and is not a direct measurement of orientation overhead. Missing telemetry is not zero usage.

Compare like tasks with similar evidence coverage. Improvements in onboarding should not be confused with less thorough verification or a change in task mix.

## Report useful evidence

Use the supplied structured report contract. Give a concise account of the welcome, the observed path into useful work, and any unnecessary detour. Cite request/attempt IDs and source locations for findings. Separate observed facts, interpretation and a possible improvement; include missing context and uncertainty.

Also say when the assignment and guidance worked well. A cohesive report should let the nurse understand the finding without rereading every raw log. Avoid copying transcripts, secrets or irrelevant task content into assessments.

The drone records observations; the nurse synthesizes and advises. Neither creates change work or treats advice as accepted policy without ct's approval. Raw assessments remain Colony-private evidence; filing specialist evidence is a separate authorized operation under the existing label-stewardship contract.
