# Specialist delegation

Use Bee for repository subagents. Read `bee --help` and `bee kinds` before choosing a role, then the relevant command help for submission and retrieval. Pass task IDs, scope, context, acceptance and relevant revisions in workflow input.

## Prose

Delegate repository prose writing and review to bookworm, including prose embedded in code. It edits during review, so complete its pass before final checks and code review.

Supply the original request and corrections, rationale, exact writable files, audience, verified behavior and command examples, authoritative references, prior findings and revision/diff. Pass existing scout inventories and research rather than asking it to rediscover them. Identify unknowns explicitly.

## Architecture

Architect authors new or revised architectural decisions: domain meaning, patterns, module responsibilities, interfaces, seams and evolution. Librarian curates the accepted guidance: where it lives, what it means and whether a change conforms to it. Read [architecture](../architecture.md) and the relevant [domain records](domain.md) before selecting either role.

Librarian consultation is optional. Use it to locate or explain established guidance when that helps; routine lookups and clear placement rules need no consultation. Final Librarian review is mandatory before commit or handoff and covers the actual final base and diff. [Land](../../.workflows/land/workflow.ts) and [feature-task delivery](../../.workflows/do-feature-task/workflow.ts) dispatch that review before Reviewer. Repairs or a changed base return through checks and review.

| Question or finding | Route |
| --- | --- |
| Where does a contract belong under an existing package rule? | Apply the rule; optionally ask Librarian for the governing reference and current interface. |
| A new seam needs an ownership rule, or an accepted rule must change. | Architect decides or proposes within the task's authority; ct resolves decisions reserved to the user. |
| A final diff departs from an established decision. | Librarian cites the rule and required repair; a proposed rule change goes to Architect. |
| Agents repeatedly cannot find or interpret the guidance. | Librarian catalogs the questions and evidence; Architect resolves any new design decision and Bookworm encodes accepted guidance. |

Forward the original request, corrections and rationale, relevant revisions, prior advice and known evidence ID. Keep accepted decisions in the implementation task's current notes under the [work policy](../beads-meta.md#authoring-and-handing-off-work), and return decisions/outcomes to the same [Librarian evidence thread](../../.hive/bees/librarian/system_prompt.md#architectural-evidence-records). Recurring confusion is evidence of a guidance gap, not authority to invent a rule. Give Bookworm settled intent and explicit files for prose changes. Reviewer retains code-style and test-quality review.

## Operational architecture

Architect also handles focused integration-continuity questions and suspected blockers. Its [role prompt](../../.hive/bees/architect/system_prompt.md) owns the assessment; workflow briefs determine any required consultation. This is separate from Librarian's final conformity review and adds no universal Architect review gate.

Architect may direct ordinary implementation and architectural changes within the accepted feature goal and authorization. Escalate to ct only when continuation requires changing that objective or authorization, an irreversible or destructive external effect, crossing a security or permission boundary, or resolving an explicit human reservation. These bounds preserve [philosophy](../PHILOSOPHY.md) and native safeguards. Resolve routine seam and implementation choices within that authority.

For these operational assessments, the assignment selects `integration-review` or `unblock`. Outcomes are:

| Outcome | Meaning and next action |
| --- | --- |
| `approved` | The inspected candidate fits the feature and prior deliveries. |
| `follow-up` | Give scoped direction to the original task bee, which repairs or supplies missing evidence and returns for review. |
| `terminal-blocker` | State the new facts proving the current implementation untenable and why authorized follow-up cannot resolve them. |
| `critical-decision` | Name the decision reserved for ct, the authority boundary and the explicit dependency that prevents continuation. |

The task owner applies the advice and records any blocker and next action under the task's workflow and native Beads rules.

## Completion

Specialists complete their own report work. Examined implementation and landing acceptance remain with their owners. [Response delivery](./responses.md) distinguishes reports from retained specialist evidence.
