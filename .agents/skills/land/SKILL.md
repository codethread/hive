---
name: land
description: Finish and land agreed work when the user explicitly says "land it", including unfinished implementation or an existing PR.
---

# Land

An explicit request to land is permission to finish the agreed scope and integrate it, not a claim that implementation is already complete. Never land on your own initiative. Discussing, editing or test-driving the landing workflow is not authorization to land the current branch.

## Enter through triage

Inspect the request, scope beads, worktree diff and any PR before choosing the next work. Retain the canonical root, selected permanent `BEADS_DB`, target branch/PR and exact task scope outside the feature checkout. Respect published claims, unrelated edits and other agents' landing work.

Use the repository's [land definition](../../../.workflows/land/workflow.ts) when Busy Bee is available: inspect `busybee input-schema land`, start a named run, then follow `discover` and the active task's instructions. Supply `expectedCommits: []` when no commits exist yet; identify the target as a worktree branch or PR URL. Do not manufacture prerequisite evidence to start. When executing manually, follow the same decisions below.

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
                                        Cleanup, publish, report
```

| Observed state | Next work |
| --- | --- |
| Acceptance incomplete or known defect | Implement the remaining scope or fix; then checks and local review |
| Work complete but checks missing/stale | Tidy this change and run required checks/tests |
| Checks current but local review absent/stale | Review the complete diff against standards and task acceptance |
| Checked and approved, but not yet committed | Commit the reviewed content without replaying review |
| Committed, checked and approved at the current revision | Recheck PR/worktree readiness; skip redundant implementation/review |
| Already integrated | Verify the actual integration and clean up; do not merge again |

A reusable review receipt identifies its bead, base and cumulative diff fingerprint. Read the bead: require reviewer/check evidence, approval and resolved findings matching the current change, including relevant dirty/untracked files. Closed means the review finished, not that it approved. Record new reviews on beads so later PR-based entry can reuse them. Code changes, hook edits and conflict resolutions require renewed checks/review; committing unchanged reviewed content does not.

Where the root architectural-review trigger applies, obtain `librarian` review of the final diff with the task bead, settled intent, user corrections and prior advice; reuse earlier evidence only if it still covers the final change. Resolve architectural findings or obtain the missing decision, and route useful outcomes to curation separately from review. Use `reviewer` for the separate code style, test quality, documentation standards and verification pass when warranted. Recheck affected review evidence after fixes.

## Return paths and blockers

- Review findings and verified PR defects return to implementation with a concrete repair brief. Close a completed review with a changes outcome rather than leaving the review open while secretly implementing.
- Verify PR comments against current code. Fix valid defects; reply with evidence to unsupported claims; explain already-fixed/outdated comments. Recheck readiness after every disposition. A rebuttal does not waive required approval or resolve somebody else's blocking thread.
- Pending CI, review/queue progress, infrastructure failures and unresolved decisions keep the current task open with evidence and a next action. Do not churn tasks or poll by transitioning. Reassess scope/target through triage when assumptions change.
- Before closing each workflow worker, write its result/evidence into native bead notes. Outcome payloads carry the next brief but do not substitute for review evidence on beads.

## Integrate and finish

Recheck explicit authorization, current reviewed content and applicable merge gates immediately before integration. Never bypass hooks, branch protections or tool refusals. Use Honeycomb's configured finish policy for worktree landing; use the repository's GitHub merge policy for a PR. A queue/auto-merge request is not a merge. New feedback returns to disposition; code/base changes return to verification/review.

Retain source and actual integration commits; squash/rebase landing needs content/PR correspondence rather than source-SHA ancestry. Verify clean synchronized canonical `main` and required checks. Use Honeycomb for any remaining worktree cleanup, with integration proof; preserve the permanent `tracker/state` checkout. If cleanup removes the source, continue from the surviving checkout with retained `BEADS_DB` and an unchanged named workflow definition. Check that definition is available before removal.

Record landing evidence and close only tasks whose acceptance and integration are proven. Run `bun run beads:sync` from a surviving configured checkout after completion updates, including after Busy Bee closes its run. Tracker publication never substitutes for code integration. On synchronization conflict stop tracker work, retain evidence and follow repository recovery guidance; never force ownership or publication.

Report what landed, verification, cleanup and publication evidence. Done requires clean synchronized main containing the intended work, passing checks, accepted tracker completion and no leftovers from this work. Failed integration, cleanup or publication remains incomplete; preserve unrelated work. A post-merge defect needs an agreed forward fix or revert, not an automatic rewrite of main.
