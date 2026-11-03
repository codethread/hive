---
name: code-review
description: "Review files, work-in-progress changes, commits or ranges through Hive’s bounded domain review workflow. Use for branch or PR review and “review since X”."
---

# Code review

Keep two independent axes: **Standards** checks repository rules; **Spec** checks the originating request, acceptance and corrections. Passing one does not compensate for failing the other.

```text
Assigned a domain audit? -- yes --> Audit its supplied scope; report to the caller
        |
        no
        v
Prepare or resume one review run --> Collect audits --> Synthesize both axes
```

## Assigned domain audit

Follow the active brief, not the caller procedure below. Audit only the assigned concern and paths; read surrounding contracts as context. Use the caller's supplied prior-gate receipt and report contradictions to the caller. Do not launch another review or rediscover unrelated gate identities.

Review source and supplied check evidence. The caller owns check execution; Bookworm owns prose edits and Librarian owns architectural conformity. Apply the [specialist protocol](../../../docs/agents/specialists.md) and the applicable review guidance below. Deliver under the stage's outcome contract.

## Caller procedure

1. **Select scope and evidence.** Read the [review workflow usage](../../../.workflows/review/README.md) for the helper's four scope meanings and input contract. Ask when the intended base or scope is ambiguous; do not silently turn worktree review into a `HEAD`-only range. Supply the source task, content identity, check receipts and accepted architecture evidence. For Spec, use the supplied request/acceptance and corrections; ask for missing intent rather than inventing a spec. Advisory review may explicitly omit Spec; final-gate review requires it.
2. **Verify final-gate prerequisites.** Apply the specialist protocol to the complete intended candidate. Record native Bookworm/Librarian provenance once in the input; domain audits consume that receipt. Select an explicit final-gate worktree base that includes prior branch commits.
3. **Prepare and start once.** Use the submission helper's `--dry-run` to inspect paths, omitted domains and unmatched coverage. Correct an unintended scope before publication. Start one `review` run beneath the authorized work and retain its ID. If a run is already supplied or recorded, resume it instead.
4. **Drive the saved run.** Follow `busybee skills get workflow-execution` and the active briefs. Collect saved closed-stage results, including interrupted deliveries, and read worker answers through `bee result --help`. The workflow dispatches its own fixed audits; the caller performs synthesis. Pending or failed workers are not completed coverage.
5. **Synthesize independently.** File the run's answer with exact scope/content and worker request/stage/response references. Show selected, omitted and unmatched coverage. Keep `## Standards` and `## Spec` separate, retaining attribution, required repairs, suggestions and gaps. Mark absent advisory Spec `not_requested`; do not manufacture approval from a completed run. Follow the native delivery and completion instructions rather than adding another reporting protocol.

The caller owns concurrent edits. Resolved refs and content receipts identify the review; they do not promise an isolated or unchanged checkout. Findings return to the implementation owner. Changed candidates need the applicable checks and reviews, not automatic repair within this workflow.

## Review guidance

Read root and affected package instructions, then load only guidance relevant to the assigned concern:

- **Code:** [TypeScript](../typescript/SKILL.md), [agent CLIs](../agent-clis/SKILL.md) and the available robustness skill when applicable.
- **Tests:** [testing](../testing/SKILL.md) and [I/O dependency seams](../io-dependency-seams/SKILL.md). Assess missing coverage even when only production files changed.
- **Docs:** [docs style](../docs-styleguide/SKILL.md), plus [writing for agents](../writing-for-agents/SKILL.md) and [hotpath review](../agent-docs-hotpath/SKILL.md) for agent-facing prose. Verify claims against implementation and actual help; report only.
- **Spec:** compare the complete selected scope with the supplied request, acceptance and corrections for missing, incorrect or unrequested behavior. Keep standards findings in their own axis.

For each required finding, cite severity, `path:line`, the governing rule or requirement and a concrete repair. Missing access or evidence is an explicit gap, not a pass. Suggestions alone do not block approval.

### Heuristics are not rules

Fowler's code smells can prompt investigation: mysterious names, duplicated code, feature envy, data clumps, primitive obsession, repeated switches, shotgun surgery, divergent change, speculative generality, message chains, middle men and refused bequests. Label such observations as heuristics—for example, “possible Feature Envy”—unless a governing repository rule establishes a violation. Explain the local cost before proposing a change; do not prescribe abstraction merely because a smell has a name.

Repository guidance overrides these heuristics, including its tolerance for small duplication. Skip findings already enforced by tooling. Preserve each axis's conclusion rather than ranking one axis as the overall winner.
