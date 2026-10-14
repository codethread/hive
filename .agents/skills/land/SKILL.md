---
name: land
description: Finish and land agreed work when the user explicitly says "land it", including unfinished implementation or an existing PR.
---

# Land

An explicit request to land is permission to finish the agreed scope and integrate it, not a claim that implementation is already complete. Never land on your own initiative. Discussing, editing or test-driving the landing workflow is not authorization to land the current branch.

## Enter through triage

Inspect the request, scope beads, worktree diff and any PR before choosing the next work. Retain the canonical root, selected permanent `BEADS_DB`, target branch/PR and exact task scope outside the feature checkout. Respect published claims, unrelated edits and other agents' landing work.

Use the repository's [land definition](../../../.workflows/land/workflow.ts) when Busy Bee is available: inspect `busybee input-schema land`, start a named run with `--parent ID` naming existing ordinary work, then follow `discover` and the active task's instructions. Supply `expectedCommits: []` when no commits exist yet; identify the target as a worktree branch or PR URL. `completedTasks` is the explicitly authorized closure scope, independent of the structural parent. Do not manufacture prerequisite evidence to start. When operating without a Bee driver, follow the same decisions below.

```text
Triage --> Implement --> Check --> Local review --> Commit
   |           ^            |           |             |
   |           +--- failures/findings --+             v
   +-- current review evidence ----------------> Readiness
   |                                            |      |
   |                    PR comments --> verify/fix/reply|
   |                                            |      v
   +-- already integrated ------------------> Verify <- Integrate
                                                 |
                                        Cleanup, evidence, report
                                                 |
                                      Busy Bee closes the run
                                                 |
                                      Caller closes tasks, publishes
```

| Observed state | Next work |
| --- | --- |
| Acceptance incomplete or known defect | Implement the remaining scope or fix; then checks and local review |
| Work complete but checks missing/stale | Tidy this change and run required checks/tests |
| Checks current but local review absent/stale | Review the complete diff against standards and task acceptance |
| Checked and approved, but not yet committed | Commit the reviewed content without replaying review |
| Committed, checked and approved at the current revision | Recheck PR/worktree readiness; skip redundant implementation/review |
| Already integrated | Verify the actual integration and clean up; do not merge again |

Before proceeding to agent review, get `bun run check` passing for the complete current change. Its full suite prints the complete timing report and fails on unapproved `DANGER`; return these failures to meaningful test/setup refactoring using relevant skills. If the measured cost is necessary, keep landing open and propose the exact JSON allowance and justification for explicit user sign-off before editing the registry. Record the command, result and revision in the check task's notes; changed content requires a fresh passing check. The landing worker owns this gate, not the reviewer.

A reusable review receipt identifies its bead, base and cumulative diff fingerprint. Read the bead: require reviewer approval and resolved findings matching the current change, including relevant dirty/untracked files. Closed means the review finished, not that it approved. Record new reviews on beads so later PR-based entry can reuse them. Code changes, hook edits and conflict resolutions require renewed checks/review; committing unchanged reviewed content does not.

Where the root architectural-review trigger applies, obtain `librarian` review of the final diff with the task bead, settled intent, user corrections and prior advice; reuse earlier evidence only if it still covers the final change. Resolve architectural findings or obtain the missing decision, and route useful outcomes to curation separately from review. Use `reviewer` for the separate code style, test quality and documentation standards pass when warranted. Recheck affected review evidence after fixes.

## Return paths and blockers

- Review findings and verified PR defects return to implementation with a concrete repair brief. Close a completed review with a changes outcome rather than leaving the review open while secretly implementing.
- Verify PR comments against current code. Fix valid defects; reply with evidence to unsupported claims; explain already-fixed/outdated comments. Recheck readiness after every disposition. A rebuttal does not waive required approval or resolve somebody else's blocking thread.
- Pending CI, review/queue progress, infrastructure failures and unresolved decisions keep the current task open with evidence and a next action. Do not churn tasks or poll by transitioning. Reassess scope/target through triage when assumptions change.
- Before closing each workflow worker, comment with its deliverable and verification, then save its outcome payload using `busybee record-result RUN STAGE CHOICE --data-file FILE`. This stores `{choice,data}` in stage notes. The caller/driver uses `busybee collect RUN` to consume closed results, including interrupted driver-handled deliveries. Bee-dispatched stage workers finish only their assigned visit and leave navigation and run closure to the driver and Busy Bee.

## Integrate and finish

Recheck explicit authorization, current reviewed content and applicable merge gates immediately before integration. Never bypass hooks, branch protections or tool refusals. Use Honeycomb's configured finish policy for worktree landing; use the repository's GitHub merge policy for a PR. A queue/auto-merge request is not a merge. New feedback returns to disposition; code/base changes return to verification/review.

Retain source and actual integration commits; squash/rebase landing needs content/PR correspondence rather than source-SHA ancestry. Verify clean synchronized canonical `main` and required checks. Use Honeycomb for any remaining worktree cleanup, with integration proof; preserve the permanent `tracker/state` checkout. If cleanup removes the source, continue from the surviving checkout with retained `BEADS_DB` and an unchanged named workflow definition. Check that definition is available before removal.

Record source/integration commits, review receipt, passing checks, cleanup and per-task acceptance evidence on the Land run and authorized scope beads before the final stage closes. The retained run brief contains the authorized `completedTasks`, canonical checkout, tracker endpoint and caller completion instructions; its comments retain evidence independently of the final visit.

The standalone Land caller or Land driver carrying the same explicit user authorization owns the post-done tail:

1. Close/collect the final visit and wait for Busy Bee to report `status: done`. Busy Bee alone closes grouping beads and the run.
2. Inspect retained evidence and close only proven `completedTasks` bottom-up, after their child tasks and workflows finish. The structural parent grants no extra closure permission. Broader/shared parents remain open while unrelated children or acceptance remain.
3. Publish once with `bun run beads:sync` from the surviving configured checkout using retained `BEADS_DB`, after all final task/workflow updates. Verify the accepted `tracker/state` snapshot contains that completion evidence.
4. Report closure and publication evidence, then call `bee finish success` where applicable. Generic driver success still requires only its run anchor done; the additional tail comes from Land-specific authorization.

Local stage handoffs stay local. Tracker publication never substitutes for code integration. If closure or publication fails after done, inspect partial effects and record the exact remaining external task/operation, blocker and required next action on the run and unfinished scope beads. Leave those tasks open and report the blocked handoff (`bee finish blocked --reason "…"` where applicable). Keep the completed run done: it has no unfinished anchor for `bee retry`; do not reopen or blindly replace it. On synchronization conflict stop tracker work and follow repository recovery guidance without forcing claims or publication.

Report what landed, verification, cleanup and publication evidence. Done requires clean synchronized main containing the intended work, passing checks, accepted tracker completion and no leftovers from this work. Failed integration, cleanup or publication remains incomplete; preserve unrelated work. A post-merge defect needs an agreed forward fix or revert, not an automatic rewrite of main.
