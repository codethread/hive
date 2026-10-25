---
name: hive
description: Plan, carry out and hand off Beads-tracked work in repositories using Hive. Use when recording work, choosing a task, implementing an assigned bead or coordinating a workflow run.
---

# Work with Hive

Use the consuming repository's instructions for human ownership, actor fallback, worktree policy, validation and publication checkpoints. When creating, updating or completing executable work in this repository, follow the [work policy](../../../docs/beads-meta.md#authoring-and-handing-off-work). This is a customizable workflow; installed CLI help and bundled instructions own command procedures. Load `beeswax prime` only if its shared safety and tool pointers are absent from context.

## Route the request

```text
Request
  |
  +-- Inspect an ID or answer a question --> read and report
  +-- Record work only ------------------> capture scope; stop before claiming
  +-- Perform supplied work ------------> inspect its brief and acceptance
  +-- Choose work ----------------------> select a candidate; inspect it
```

Start with `br show ID --json` for a supplied task. Questions need no bookkeeping task. Reuse existing scope when recording or implementing work; search only when the request leaves the task unidentified. When choosing work, use native readiness and, if useful, BV's advice through the tool pointers in prime.

Before creating tasks or changing scope or dependencies, read [planning](references/planning.md). The result should name the authorized work and how completion will be verified.

## Carry the work through

Before claiming, delegating, updating progress or closing a task, read [coordination](references/coordination.md). Record enough context for another session to resume the same scope.

For a supplied Busy Bee run, follow `busybee skills get workflow-execution` and its active briefs. Continue the saved run on retry. The run's stages and outcome contracts govern execution; additional workflow work belongs beneath that run.

Use the repository's verification and review gates. Report changed behavior, evidence, unresolved work and retained task/result IDs.
