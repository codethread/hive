# Specialist delegation

Use Bee for repository subagents. Run `bee --help`, then `bee kinds` before delegating. Put the assignment, context and acceptance in workflow input; normally use the kind's workflow and omit prompt overrides. `bee spawn KIND --input-file FILE` creates the run and work stage the specialist completes. The [Bee and Colony guide](../../lib/colony/README.md#create-requests) documents request creation and inspection.

## Architectural intent

- **Consult:** use `librarian` when ownership, domain concepts, seams or abstraction choices remain unclear after reading the [architecture](../architecture.md); routine file placement does not need a consultation.
- **Curate/discuss:** use `librarian` to synthesize difficult questions, recurring confusion and outcomes. Forward user corrections with the original request, context and supplied rationale. Evidence capture is part of the role; explicitly scope documentation changes and new policy decisions.
- **Review:** before committing or handing off changes to those architectural concerns, use `librarian` in review mode on the final diff. Keep code style, test quality and general standards review with `reviewer`.

Pass existing task IDs as context, affected paths/revisions, settled decisions, prior advice and the evidence ID when known. Librarian records substantive exchanges under its [evidence contract](../../.hive/bees/librarian/system_prompt.md#architectural-evidence-records); no separate filing assignment is needed. Keep the accepted approach in the implementation task's design and return corrections and final outcomes to the same evidence thread. Consult/review leave examined code, architecture documents and implementation tasks unchanged; routine evidence capture remains part of reporting.
