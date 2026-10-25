---
name: hive
description: Plan and coordinate Beads-tracked work with Hive. Use when creating or revising tasks, choosing or implementing work, delegating, recording decisions or progress, handing off or completing work, or coordinating a workflow run.
---

# Work with Hive

Use the consuming repository's instructions for work policy, human ownership, actor fallback, worktrees, validation, review and publication checkpoints. This skill supplies customizable defaults for executable work; responses and reference records retain their own contracts. Installed CLI help and bundled instructions own command procedures.

## Engine-managed work

Before applying ordinary field or completion rules to Busy Bee work, preserve its stage result notes (`record-result`/`complete`), temporary run-note settlement intent and structured close reasons. Put narrative evidence in comments and, when authorized, the ordinary source task's current notes. Follow the active brief, `busybee skills get workflow-execution` and `busybee complete --help`; never directly close managed work or replace engine payloads with prose. Busy Bee alone closes groups and the run. These defaults do not establish producer compliance or native enforcement.

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
