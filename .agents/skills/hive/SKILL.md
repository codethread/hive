---
name: hive
description: Plan and coordinate Beads-tracked work with Hive. Use when creating or revising tasks, choosing or implementing work, delegating, recording decisions or progress, handing off or completing work, or coordinating a workflow run.
---

# Work with Hive

Use the consuming repository's instructions for human ownership, actor fallback, worktree policy, validation and publication checkpoints. When creating, updating or completing executable work in this repository, follow the [work policy](../../../docs/beads-meta.md#authoring-and-handing-off-work). This is a customizable workflow; installed CLI help and bundled instructions own command procedures.

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

For a supplied Busy Bee run, follow `busybee skills get workflow-execution` and its active briefs. Continue the saved run on retry. The run's stages and outcome contracts govern execution; additional workflow work belongs beneath that run.

Use the repository's verification and review gates. Report changed behavior, evidence, unresolved work and retained task/result IDs.
