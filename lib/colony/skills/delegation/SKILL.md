---
name: delegation
description: Use Bee to delegate work to configured agent roles, retrieve their answers, or recover and complete workflow executions.
---

Use Bee for execution requests in the application's repository. Follow that repository's domain conventions, commands, task policy and authorization; this guidance supplies tool mechanics. Read `bee --help` and the relevant subcommand help for flags.

## Submit a bounded assignment

1. Select the repository and tracker deliberately. `--repo` selects canonical Bee configuration; `--beads-db` (or `BEADS_DB`) selects the tracker. `--cwd` selects the execution checkout and its workflow definitions, independently of those selections.
2. Choose a configured role by its description and default workflow with `bee kinds`; its help covers discovery and prompt expansion. Kind discovery requires configuration, but no tracker or daemon.
3. Read the existing parent task and its acceptance criteria. Follow `bee spawn --help` to prepare workflow input and submit the assignment with the selected repository, tracker and checkout. Preserve an injected `BD_ACTOR`; otherwise supply your agent actor. Keep role defaults unless a deliberate override is needed.
4. Retain `request.id`, `request.identity` and `workflow.runId`. Submission creates durable work and a request; it does not establish that an agent started or completed anything. The original parent keeps its own assignment and completion policy.

## Inspect before taking the next action

```text
Known request
  |
  +-- open --------------------> inspect and wait for execution
  +-- failed, unresolved ------> diagnose; retry after resolving cause
  +-- closed -----------------> read the answer and native outcome
```

Use `bee status` for exact request/task facts and delivery availability; `bee list --help` covers discovery and history. Read `bee result --help`, then retrieve the authored answer with the retained request ID. Interpret the answer alongside its native outcome before synthesizing it; task closure alone is not an answer.

Native task beads own acceptance, status and assignment. Request closure, process exit and task completion are distinct. A last Colony observation is timestamped historical evidence, not proof of current execution. Use `colony explain REQUEST` with the same repository/tracker and selected server when fresh process and scheduling evidence is needed; preserve its source, freshness and unavailable evidence.

Before retrying, cancelling, recovering a partial submission, or completing an assigned execution, read [execution and recovery](references/execution.md) with `bee skills file delegation references/execution.md`.
