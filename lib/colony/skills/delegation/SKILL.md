---
name: delegation
description: Delegate work with Bee, retrieve authored answers, or retry, cancel and finish assigned executions.
---

Follow the application's task policy and authorization. Read `bee --help` for the submission sequence and focused command help for options.

## Submit a bounded assignment

Choose the role by description with `bee kinds`, then follow `bee spawn --help` to select a task-appropriate workflow and submit its input. Keep kind defaults unless the assignment needs an override; changing the workflow does not require replacing the role prompt. For role and prompt authoring, read `colony skills file operations references/configuration.md`.

Keep the Bee command process alive while it waits for native tracker locks. Prefer the execution tool's asynchronous execution and polling when available; otherwise allow an outer command timeout sufficient for the configured native lock wait plus command work.

Retain `request.id` for delivery, `request.identity` for assignment and `workflow.runId` for workflow navigation. Submission does not establish that execution started. The parent keeps its own assignment and completion policy.

## Inspect before taking the next action

```text
Known request
  |
  +-- open --------------------> inspect and wait for execution
  +-- failed, unresolved ------> diagnose; retry after resolving cause
  +-- closed -----------------> read the answer and native outcome
```

Discover requests with focused native Beads queries. In a Hive checkout, read [docs/agents/spawn-requests.md](../../../../docs/agents/spawn-requests.md#find-requests-with-native-beads) for the query contract. Use `bee status` for exact-ID request/task facts. Read `bee result --help`, then retrieve the authored answer with the retained request ID and interpret it alongside the request outcome.

Native task beads own acceptance, status and assignment. For stalled execution or uncertain process state, read `colony skills get operations`; recorded request observations alone do not establish liveness.

Before retrying, cancelling, recovering a partial submission, or completing an assigned execution, read [execution and recovery](references/execution.md) with `bee skills file delegation references/execution.md`.
