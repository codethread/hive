# Plan Beads work

For engine-managed work, read the [runtime boundary](../SKILL.md#engine-managed-work) before applying these defaults. Use focused `br COMMAND --help` for fields and operations. Request only the fields needed for the next decision; apply prime's ordinary-work query filters when searching or selecting work.

Before editing, read the task and applicable ancestor instructions. Preserve useful historical content, including existing design/prerequisites, and governing instructions; these defaults do not authorize record migration or deletion.

## Define completion

| Field | What to put here |
| --- | --- |
| `description` | Current problem, intended outcome, scope/non-goals and context, including relevant code or documentation pointers. Keep it meaningful without the original conversation, including after completion. |
| `acceptance_criteria` | The dedicated acceptance checklist: concrete, independently verifiable outcomes, normally `- [ ]` Markdown items. Do not duplicate it in the description. |
| `design`, `prerequisites` | Leave unused for new ordinary work. Put current intent in the brief and approach/rationale in notes. Represent prerequisite work as separate tasks with blocking links. |
| `agent_context` | JSON governing instructions specific to a parent/subtree. Keep repository-wide rules in `AGENTS.md`; this is not a progress log or searchable routing metadata. |

Create agent-authored executable work explicitly with `br create --status draft` and the remaining task fields. Supply meaningful native acceptance criteria before **any** departure from draft, including a claim. Use `br create --help` and `br update --help` for field operations and incremental acceptance edits. Native presence/checklist checks cannot establish that criteria are meaningful or true.

Distinguish report, implementation and landing scope in acceptance. Follow [coordination](coordination.md#keep-resumable-evidence) to maintain current notes and evidence.

A task can be ready for development yet still await a prerequisite. Conversely, native readiness does not prove that its requirements are clear. Resolve missing intent with the requester before committing to an interpretation that changes the scope.

## Decompose by responsibility

Create children when work needs separate acceptance, ownership or delegation. Each child needs its own narrower brief and acceptance; parent links do not copy narrative fields. Parent links group related work; blocking dependencies order execution. A parent link alone does not make one child wait for another. Use `br dep --help` to express the actual prerequisite direction.

Keep each delegated scope independently reviewable: identify writable paths, expected outputs, verification and boundaries with concurrent work. Keep integration and shared-file decisions with a named owner. Record newly discovered work under the existing scope when it contributes to that scope; keep independent work separate.

Choose the accountable human owner from repository policy. Owner, assignee and mutation actor are distinct; a human owner does not reserve the task for human execution.
