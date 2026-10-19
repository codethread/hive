# Specialist delegation

Use Bee for repository subagents. Read `bee --help` and `bee kinds` before choosing a role, then the relevant command help for submission and retrieval. Pass task IDs, scope, context, acceptance and relevant revisions in workflow input.

## Prose

Delegate repository prose writing and review to bookworm, including prose embedded in code. It edits during review, so complete its pass before final checks and code review.

Supply the original request and corrections, rationale, exact writable files, audience, verified behavior and command examples, authoritative references, prior findings and revision/diff. Pass existing scout inventories and research rather than asking it to rediscover them. Identify unknowns explicitly.

## Architectural intent

Use librarian for unclear ownership, domain concepts, seams or abstractions after reading [architecture](../architecture.md); for user corrections and recurring confusion; and for final-diff review of those concerns. Routine file placement needs no consultation. Reviewer owns code style and tests.

Forward the original request, corrections and supplied rationale, prior advice and known evidence ID. Keep the accepted approach in the implementation task's design and return decisions/outcomes to the same [librarian evidence thread](../../.hive/bees/librarian/system_prompt.md#architectural-evidence-records). Evidence capture is part of the role; documentation edits need explicit scope.

## Operational architecture

Use architect for a focused integration-continuity question or direction on a suspected blocker. Its [role prompt](../../.hive/bees/architect/system_prompt.md) owns the assessment; workflow briefs determine any required consultation. Reviewer owns code and test review, while librarian retains durable intent, architectural memory and `evidence:architecture` stewardship.

Architect may direct ordinary implementation and architectural changes within the accepted feature goal and authorization. Escalate to ct only when continuation requires changing that objective or authorization, an irreversible or destructive external effect, crossing a security or permission boundary, or resolving an explicit human reservation. These bounds preserve [philosophy](../PHILOSOPHY.md) and native safeguards. Resolve routine seam and implementation choices within that authority.

The assignment selects `integration-review` or `unblock`. Outcomes are:

| Outcome | Meaning and next action |
| --- | --- |
| `approved` | The inspected candidate fits the feature and prior deliveries. |
| `follow-up` | Give scoped direction to the original task bee, which repairs or supplies missing evidence and returns for review. |
| `terminal-blocker` | State the new facts proving the current implementation untenable and why authorized follow-up cannot resolve them. |
| `critical-decision` | Name the decision reserved for ct, the authority boundary and the explicit dependency that prevents continuation. |

The task owner applies the advice and records any blocker and next action under the task's workflow and native Beads rules.

## Completion

Specialists complete their own report work. Examined implementation and landing acceptance remain with their owners. [Response delivery](./responses.md) distinguishes reports from retained specialist evidence.
