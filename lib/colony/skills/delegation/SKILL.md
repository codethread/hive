---
name: delegation
description: Delegate work with Bee, retrieve authored answers, or retry, cancel and finish assigned executions.
---

Follow the application's task policy and authorization. Read `bee --help` for the submission sequence and focused command help for options.

## Submit a bounded assignment

1. Read the existing parent task and acceptance criteria. Choose a kind by its description and default workflow with `bee kinds`.
2. Follow `bee spawn --help` to submit workflow input. Select configuration, tracker and execution checkout independently; preserve supplied `BD_ACTOR` and `BEADS_DB`. Keep kind defaults unless the assignment needs an override.
3. Retain `request.id` for delivery, `request.identity` for assignment and `workflow.runId` for workflow navigation. Submission does not establish that execution started. The parent keeps its own assignment and completion policy.

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
