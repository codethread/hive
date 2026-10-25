# Coordinate Beads work

For engine-managed work, read the [runtime boundary](../SKILL.md#engine-managed-work) before applying these defaults.

## Claim and hand off

Before claiming agent-authored work, apply [planning's draft and acceptance gate](planning.md#define-completion). Inspect current assignment and blockers immediately before claiming through `br update --help`. Record the scope and execution checkout: sessions can share an actor, so a matching identity alone does not prove that no other session is working there. Use repository policy for deliberate human handoffs and record the decision needed.

When delegating, follow `bee skills get delegation` for submission, retained IDs and result delivery. Choose bee kinds from repository policy and available configuration.

## Keep resumable evidence

Keep `notes` as one consolidated current account: what was done and why, decisions, verification, limitations, unfinished work and next action. Refresh it at consequential decisions, interruptions, handoffs and completion rather than appending competing summaries. Preserve useful findings and rationale; state what passed, what was not checked and what remains. Inspect saved progress after interruption before repeating effects. A handoff should identify artifacts and the action or decision needed to resume.

Capture useful conversation selectively in comments, with attribution and a clear distinction between quotations, paraphrases and accepted decisions. Comments can carry short progress/delivery evidence; promote consequential conclusions into the current brief or notes. No automatic transcript is required.

A separate working diary is optional history, not unfinished child work. Attach an existing diary with a nonblocking `related` link and keep experiments and intermediate history in its authored comments. Promote useful conclusions to the task at handoff or completion. These defaults define no diary type, label or lifecycle; without an established artifact contract, use selective task comments instead.

## Complete and publish

Verify outcomes before ticking acceptance criteria. Close only when acceptance and required child work are complete. Leave unfinished work open with its concrete blocker or next action. A report completes only its own scope, not the work it examines; landing acceptance waits for integration.

For ordinary task closure, use `br close --help` and a readable, proof-bearing `close_reason` explaining why the work can close, not replacing the current account in notes. Release and consumer adoption may have separate owners and criteria.

At a repository-authorized publication checkpoint, follow `beeswax skills file repository-setup references/publication.md` for local versus remote exchange, first publication and recovery.
