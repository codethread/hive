# Philosophy and tenets

> [!info]  
> These shape all design decisions Nothing may break them, no agent may edit this file

Agentic tools move too fast to make a mega-tool worth building, but tooling is exceptionally helpful. To that end, `hive` is a collection of fast-moving tools, designed to work together, wherein each may be dropped and replaced.

## Tenets

1. Alpha software built for me; no backwards compatibility, not api shims. Each break goes into the changelog, agents can handle it.
2. Agents are trusted and respected. We try not to constrain them, simply guide and let them do their best work.
3. Solve the happy path and FAIL LOUDLY otherwise. This is not a rust app with all cases covered, it prioritises solving the problem with the least complexity and if not we fail with clear and diagnostics (agents can fix fast)
4. Hive strives for resumable work with minimal loss, not durable workflows à la Temporal.

## Scope

- No tool should require more than a few days to build. Changes should not be long refactors. Better to drop one tool and rebuild a new one from scratch with the lessons learned.
- Each thing built solves a direct problem, not because it might be cool
