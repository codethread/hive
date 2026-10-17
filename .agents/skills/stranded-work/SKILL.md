---
name: stranded-work
description: Investigate blocked, parked or stranded Hive agent work when asked to recover unfinished work, explain why it stopped, or identify a focused prevention fix.
---

# Investigate stranded work

Start from the user's unfinished work and desired outcome. A `blocked` task, failed spawn request or quiet process is a lead, not a diagnosis.

```text
Unfinished work
  |
  +-- recovery authorized? -- yes --> route recovery and track its outcome
  |
  v
Bounded facts --> causal diagnosis --> focused prevention
```

Recovery and independent diagnosis can proceed together. Keep their evidence and completion claims distinct.

## Establish scope and recovery

The coordinator owns human dialogue, scope, authorization, recovery routing and a compact evidence ledger. Separate permission to inspect, record follow-ups, recover and implement; carry forward permission already given. Preserve supplied tracker selection, identities, assignments and human/HITL reservations under the repository's [AGENTS.md](../../../AGENTS.md) policy.

Start with known task, request and workflow run IDs. Record each case's intended outcome, observed stop, authoritative evidence, current disposition and next missing fact. Distinguish observations from hypotheses and retain timestamps and exact evidence pointers rather than repeated full logs.

Before inspecting spawn requests or interpreting failure and replacement, read the [spawn state contract](../../../docs/agents/spawn-requests.md). For recovery, follow the applicable public tool instructions and focused help:

- Bee requests: `bee skills get delegation`; use its recovery reference for retry, stop or interrupted submission.
- Busy Bee runs: `busybee skills get workflow-execution`; resume the known run and collect retained results through its protocol.
- Uncertain runtime liveness: `colony skills get operations`; verify current process evidence before acting on an old observation.

Track each recovery to a verified completion, failure or explicit handoff. While independent work or a long landing tail continues, record what is still moving, its responsible identity and next check; continue diagnosis without declaring that work finished. When authority or intent is missing, ask the user for that decision while continuing permitted reads.

## Fan out facts; retain one analyst

Follow the [specialist protocol](../../../docs/agents/specialists.md) and configured Bee roles. Keep model and reasoning defaults unless the user or repository specifies an override.

Fan out independent tracker questions to small Honeybee assignments. Each assignment contains:

- One bounded, falsifiable question and the known IDs.
- The evidence/query window and permitted reads.
- A stopping condition, including what to return if evidence is absent.
- An answer contract: findings, exact pointers and uncertainty.

Use the appropriate configured specialist for narrow source lookups. Keep these assignments factual; the analyst owns causal synthesis.

For deep or multi-case diagnosis, retain one focused analyst with strong reasoning capability. Use the configured librarian for causal and ownership judgments, keeping follow-ups in the same evidence thread. If the user explicitly authorizes a harness subagent, prefer direct messages to that same analyst. Send compact facts, counterexamples and user corrections instead of restarting its context.

Ask the analyst for the leading falsifiable hypothesis and **one next missing fact** that could change its conclusion. Obtain that fact through a focused lookup, then return it to the same thread. Meanwhile, the coordinator continues triage and research and gives the human calm, concise updates about what is known, uncertain and happening next. Apply corrections promptly to every affected assignment the coordinator owns.

## Explain why work stayed unfinished

Build the chain for each case:

```text
Initiating event -> observed stop/outcome -> persisted work/result/checkpoint
                -> why work stayed unfinished -> smallest prevention
```

Keep response availability, request outcome and resolution, task status, workflow completion and runtime freshness separate in the ledger. Use the spawn contract to interpret these facts. Inspect bounded execution-attempt logs only for missing facts that could change the chain. Current source can suggest a mechanism; historical runtime or revision evidence is needed to attribute it to that execution.

Test the leading explanation against counterexamples:

- Successful continuation of the same run can disprove a generic inability to resume.
- Deliberate human pause or cancellation is intentional; compare the remaining work with that intent before diagnosing abandonment.
- User-accepted replacement of an obsolete version is ordinary. Investigate leftovers only when bounded recurrence evidence warrants it.
- Multiple comments or child records may describe one incident. Phrase-query matches establish a lower bound within that query's scope, not an overall failure rate.

When evidence cannot distinguish competing causes, report the unresolved fork and next discriminating fact.

## Converge and hand back

Compare the proposed prevention with smaller protocol or interface changes. Select the smallest change that interrupts the evidenced causal chain, with a reproducer or verifiable acceptance criteria and explicit limits. Keep unrelated causes separate instead of forcing one fix to explain every case.

For an authorized follow-up, use a narrow Honeybee duplicate check and reuse relevant existing work before creating a bead. Keep proposed implementation within the recording and execution scope established above.

Return a concise synthesis: recovery outcomes or continuing handoffs, the causal conclusion and strongest evidence, remaining uncertainty, and the focused prevention bead or proposed next action. Complete only the investigation's assigned work; examined tasks retain their own acceptance and closure authority.
