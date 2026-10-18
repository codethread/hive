# Specialist delegation

Use Bee for repository subagents. Read `bee --help` and `bee kinds` before choosing a role, then the relevant command help for submission and retrieval. Pass task IDs, scope, context, acceptance and relevant revisions in workflow input.

## Prose

Delegate repository prose writing and review to bookworm, including prose embedded in code. It edits during review, so complete its pass before final checks and code review.

Supply the original request and corrections, rationale, exact writable files, audience, verified behavior and command examples, authoritative references, prior findings and revision/diff. Pass existing scout inventories and research rather than asking it to rediscover them. Identify unknowns explicitly.

## Architectural intent

Use librarian for unclear ownership, domain concepts, seams or abstractions after reading [architecture](../architecture.md); for user corrections and recurring confusion; and for final-diff review of those concerns. Routine file placement needs no consultation. Reviewer owns code style and tests.

Forward the original request, corrections and supplied rationale, prior advice and known evidence ID. Keep the accepted approach in the implementation task's design and return decisions/outcomes to the same [librarian evidence thread](../../.hive/bees/librarian/system_prompt.md#architectural-evidence-records). Evidence capture is part of the role; documentation edits need explicit scope.

## Operational architecture

Use architect when a feature-task workflow requires integration continuity review or direction on a suspected blocker. Its [role prompt](../../.hive/bees/architect/system_prompt.md) owns inspection and receipt requirements. Reviewer owns detailed code and test review; librarian retains durable intent, architectural memory and `evidence:architecture` stewardship. Required Librarian consultations still apply.

Architect may direct ordinary implementation and architectural changes within the accepted feature goal and authorization. Escalate to ct only when continuation requires changing that objective or authorization, an irreversible or destructive external effect, crossing a security or permission boundary, or resolving an explicit human reservation. These bounds preserve [philosophy](../PHILOSOPHY.md) and native safeguards. Resolve routine seam and implementation choices within that authority.

The assignment selects `integration-review` or `unblock`. Outcomes are:

| Outcome | Meaning and next action |
| --- | --- |
| `approved` | Integration review confirms the exact combined candidate fits the feature and prior deliveries. The task bee continues the workflow's integration gates. |
| `follow-up` | Give scoped direction to the original task bee, which repairs or supplies missing evidence and returns for review. |
| `terminal-blocker` | State the new facts proving the current implementation untenable and why authorized follow-up cannot resolve them. |
| `critical-decision` | Name the decision reserved for ct, the authority boundary and the explicit dependency that prevents continuation. |

Before accepting approval, the consuming workflow matches the assigned consultation request and its filed response to the feature, source task and inspected revisions in the receipt.

In these workflows, a suspected blocker requires Architect consultation before the task bee marks its source task blocked. Only an evidenced `terminal-blocker` determination or an explicit `critical-decision` dependency supports that transition; the task bee records the determination and next action under its workflow instructions. Ordinary follow-up does not justify assigning ct or blocking the source task. If consultation is unavailable, record that condition and the next recovery action; it supplies neither approval nor a source-blocking determination.

## Completion

Specialists complete their own report work. Examined implementation and landing acceptance remain with their owners. [Response delivery](./responses.md) distinguishes reports from retained specialist evidence.
