# Philosophy and tenets

> [!info]  
> They shape all design decisions, scope and code.  
> Nothing make break this, no agent may edit this file

Agentic tools move too fast to make a mega-tool worth building, but tooling is exceptionally helpful. To that end, `hive` is a collection of fast-moving tools, designed to work together, wherein each may be dropped and replaced.

## Tenets

1. Alpha software built for me; no backwards compatibility, not api shims, no migration docs (beyond a changelog).
2. Solve the happy path and FAIL LOUDLY otherwise. This is not a rust app with all cases covered, it prioritises solving the problem with the least complexity and if not we fail with clear and diagnostics (agents can fix fast)

## Scope

- No tool should require more than a few days to build. Changes should not be long refactors. Better to drop one tool and rebuild a new one from scratch with the lessons learned.
- Each thing build solves a direct problem, not because it might be cool
