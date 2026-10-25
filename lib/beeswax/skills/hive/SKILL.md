---
name: hive
description: Plan and coordinate Beads-tracked work with Hive. Use when creating or revising tasks, choosing or implementing work, delegating, recording decisions or progress, handing off or completing work, or coordinating a workflow run.
---

# Work with Hive

Use the consuming repository's instructions for work policy, human ownership, actor fallback, worktrees, validation, review and publication checkpoints. This skill supplies customizable defaults for executable work; responses and reference records retain their own contracts. Installed CLI help and bundled instructions own command procedures.

## Engine-managed work

For Busy Bee work, follow the active brief and `busybee skills get workflow-execution`. Format-2 results, completion and settlement live in the workflow system record; ordinary notes retain the current account under repository policy. Use `complete` then driver `collect`, not direct native closure. Busy Bee preserves current native gates and reservations. Before using new tools on an older saved run, follow their explicit format-adoption guidance; this skill grants no migration or retirement authority.

For a supplied run, continue the saved run on retry; additional workflow work belongs beneath it.

## Route the request

```text
Request
  |
  +-- Inspect an ID or answer a question --> read and report
  +-- Record work only ------------------> capture scope; stop before claiming
  +-- Perform supplied work ------------> inspect its brief and acceptance
  +-- Choose work ----------------------> select a candidate; inspect it
```

Start with `br show ID --json` for a supplied task. Questions need no bookkeeping task. Reuse existing scope when recording or implementing work; search only when the request leaves the task unidentified. When choosing work, use native readiness and, if useful, BV's advice.

Before creating a task or changing its brief, acceptance, scope or dependencies, read [planning](references/planning.md) for field placement and creation gates.

## Carry the work through

Before claiming, delegating, recording decisions or progress, handing off or closing a task, read [coordination](references/coordination.md) for current notes, evidence and completion gates.

Use the repository's verification and review gates. Report changed behavior, evidence, unresolved work and retained task/result IDs.
