# Specialist delegation

Use Bee for repository subagents. Read `bee --help` and `bee kinds` before choosing a role, then the relevant command help for submission and retrieval. Pass task IDs, scope, context, acceptance and relevant revisions in workflow input.

## Prose

Delegate repository prose writing and review to bookworm, including prose embedded in code. It edits during review, so complete its pass before final checks and code review.

Supply the original request and corrections, rationale, exact writable files, audience, verified behavior and command examples, authoritative references, prior findings and revision/diff. Pass existing scout inventories and research rather than asking it to rediscover them. Identify unknowns explicitly.

## Architectural intent

Use librarian for unclear ownership, domain concepts, seams or abstractions after reading [architecture](../architecture.md); for user corrections and recurring confusion; and for final-diff review of those concerns. Routine file placement needs no consultation. Reviewer owns code style and tests.

Forward the original request, corrections and supplied rationale, prior advice and known evidence ID. Keep the accepted approach in the implementation task's design and return decisions/outcomes to the same [librarian evidence thread](../../.hive/bees/librarian/system_prompt.md#architectural-evidence-records). Evidence capture is part of the role; documentation edits need explicit scope.

Specialists complete their own report work. Examined implementation and landing acceptance remain with their owners. [Response delivery](./responses.md) distinguishes reports from retained specialist evidence.
