# Parked Busy Bee test cases

These are removed executable checks, recorded for reconsideration rather than a new behavior contract. Remaining tests may cover portions. The 45 removed original cases measured over 1000ms; faster siblings and the unmeasured repository-default tracker-selection row remain.

The record contains 27 scenarios and 7 scenario outlines (46 instances after expanding examples), representing 45 original cases. L5 and L6 split one original case; all other mappings are one-to-one after expansion. Sources: `hv-luv2v` comment 4466 and `hv-hu8eo.4` comments 4393/4402. Follow-up: `hv-luv2v`.

## Reading and restoration

All source pointers below refer to revision `61e736f8e1f4bfad9b7338e140d33938d0426f71`, beneath `lib/busybee/tests/integration/`. Restore with `git show <revision>:<path>` and retain the file helpers, imported definitions and `support.ts`.

The native fixture (`support.ts:29`) used disposable Git repositories, real Beads CLI/database storage and real XState/Zod definitions. Worker outcomes, notes and closures were scripted. Landing did not execute checks, reviews, commits, merges, pushes or GitHub requests. Concurrent collection used Hive's Bee wrapper with a non-model executable; it did not test a model provider. Lock races used barriers or an injected clock, and failure scenarios deliberately injected errors.

“Publication state is unchanged” means checkpoint description, checkpoint notes and sorted issue IDs match the prior observation (`support.ts:143–162`), not that every database field was compared.

Landing helpers also checked expected stage titles and offered choices. Active task instructions after accepted submissions retained canonical root, tracker database, request, completed-task reference, target, the empty-commits instruction and scripted evidence (`land.test.ts:399–436,513–527`). The bounded-lock scenario used an injected clock to reach its deadline; it did not assert elapsed wall time.

## Native workflow and tracker behavior

### N1

```gherkin
Scenario: An open child prevents completion
  Given a worker has an open native child
  When worker closure is attempted and its outcome is submitted
  Then closure fails with CommandError and submission reports task_not_closed
  And the child stays open and publication state is unchanged
```

### N2

```gherkin
Scenario: Completed children permit worker closure
  Given a worker has a native child
  When the child is closed and then the worker is closed
  Then the native worker is closed
```

### N3

```gherkin
Scenario: Default native configuration preserves the completed worker
  Given default native configuration and a closed final worker
  When the worker advances
  Then the run is done and the worker record is identical
```

### N4

```gherkin
Scenario: Discovery keeps checkpoint internals out of human tasks
  Given a review run with a planner
  When its choices are discovered
  Then the planned outcome requires at least one task
  And the checkpoint is identical and has the system label
  And the run description excludes snapshot internals and the worker description excludes choice internals
```

### N5

```gherkin
Scenario: Concurrent submissions accept one outcome
  Given two callers reach the same native checkpoint revision for a closed worker
  When both submit the worker outcome
  Then exactly one succeeds and reports the run done
  And the other fails with inactive_task
```

### N6

```gherkin
Scenario: A held checkpoint does not block an independent workflow
  Given a caller waits on one held checkpoint
  When an independent workflow advances
  Then the independent run is done and the held checkpoint description is unchanged
  When the held checkpoint is explicitly released
  Then the waiting caller succeeds and its run is done
```

### N7

```gherkin
Scenario: Parallel reviewers reject stale approval
  Given a planner submits a two-task review plan
  When the review tasks are published
  Then there are two reviewers with the group as native parent and the run as the group parent
  When both reviewers close and one submits approval for an old revision
  Then the outcome is rejected and publication state is unchanged
```

### N8

```gherkin
Scenario Outline: Invalid review plans cannot publish
  Given a closed planner and empty checkpoint notes
  When a plan with <tasks> is submitted
  Then it fails with invalid_input and publication state is unchanged

  Examples:
    | tasks              |
    | an empty task list |
    | duplicate task IDs |
```

### N9

```gherkin
Scenario: Repair revisits planning
  Given a planned review with two reviewers
  When they close and submit changes and approval respectively
  Then repair work is active
  When the repair worker closes and submits repaired
  Then planning is active again with two recorded visits to the planning node
```

### N10

```gherkin
Scenario: Concurrent collectors consume scripted Bee results once
  Given a Bee review run with a closed scripted planner result
  When two collectors reach the same checkpoint revision and collect the plan
  Then both succeed and the run has four created entries including three requests
  When reviewers close with scripted approvals and two collectors collect together
  Then both succeed with done and the native run is closed
  And every automatic task has no assignee
```

### N11

```gherkin
Scenario: Attribution stays distinct from ownership and assignment
  Given an owner and an assignment to working-agent
  When initiating-agent starts the run
  Then the native run records that owner, creator and assignee
  And the worker is assigned to working-agent while the checkpoint is unassigned
  When finishing-agent advances the closed worker
  Then the next worker retains the owner and working-agent assignment
  And its creator is finishing-agent
```

### N12

```gherkin
Scenario: Mutation needs identity while inspection does not
  Given a workflow and a native tracker
  When start omits the actor or owner in separate attempts
  Then the attempts report missing_actor and missing_owner respectively
  When a valid run is shown without an actor
  Then inspection succeeds
```

### N13

```gherkin
Scenario Outline: Explicit tracker selection locates the created run
  Given <selection> and invocation from <execution directory>
  When a workflow starts
  Then it succeeds and the selected database contains the run with the supplied owner

  Examples:
    | selection                                       | execution directory     |
    | BEADS_DB names a separate database              | the workflow repository |
    | --db overrides BEADS_DB                         | the workflow repository |
    | --repo names the repository holding the tracker | outside that repository |
```

### N14

```gherkin
Scenario: Parallel groups are siblings of the preceding stage
  Given the parallel example has a closed first worker
  When that worker advances
  Then the Implementation group has the run as its native parent
  And the preceding worker is not its parent
```

### N15

```gherkin
Scenario: A validated outcome supplies the next grocery task
  Given the groceries example has a closed first worker
  When busy is submitted with four meals
  Then the next task is Choose quick recipes with plannedMeals equal to four
```

Restoration mapping (original registration titles):

| Scenario | Source | Original title / variants |
| --- | --- | --- |
| N1 | `native.test.ts:53` | an open native child prevents worker closure and workflow submission |
| N2 | `native.test.ts:66` | a worker can close after its native children complete |
| N3 | `native.test.ts:73` | default native configuration advances a closed worker without changing it |
| N4 | `native.test.ts:84` | discovery is read-only and the system checkpoint stays separate from human task descriptions |
| N5 | `native.test.ts:103` | two callers reach the same native lock revision and exactly one submission is accepted |
| N6 | `native.test.ts:117` | a held checkpoint leaves other workflows independent and a waiter resumes after explicit release |
| N7 | `native.test.ts:135` | parallel review tasks preserve hierarchy and a stale revision cannot change the checkpoint |
| N8 | `native.test.ts:158` | a review plan with $mode is rejected before checkpoint publication — empty task list; duplicate task IDs |
| N9 | `native.test.ts:180` | review findings produce repair work and a repaired visit publishes a fresh planner |
| N10 | `native.test.ts:200` | concurrent collectors submit scripted Bee results once without launching a model |
| N11 | `native.test.ts:217` | owner, initiating assignment and subsequent caller attribution stay distinct |
| N12 | `native.test.ts:243` | mutations require distinct actor and owner inputs while inspection does not require an actor |
| N13 | `native.test.ts:267` | native tracker selection follows $mode independently of the execution directory — environment; explicit database; explicit repository (repository row retained) |
| N14 | `native.test.ts:321` | the parallel example publishes sibling groups instead of children of the preceding stage |
| N15 | `native.test.ts:347` | the groceries example derives its next task and context from a validated outcome |

## Landing navigation and review receipts

### L1

```gherkin
Scenario: Landing requires worker closure and exposes receipt constraints
  Given an open landing triage worker
  When implement is submitted with evidence
  Then it fails with task_not_closed
  When choices are discovered and the run is shown
  Then reviewed exposes an object schema and the active tasks are unchanged
```

### L2

```gherkin
Scenario Outline: Invalid landing outcomes cannot advance
  Given a closed landing triage worker
  When <choice> is submitted with <payload>
  Then it is rejected and publication state and active tasks are unchanged

  Examples:
    | choice    | payload                         |
    | implement | no evidence                     |
    | reviewed  | evidence without review receipt |
    | commit    | evidence without commit receipt |
    | reviewed  | evidence and an empty receipt   |
    | skip      | evidence for an unknown outcome |
```

### L3

```gherkin
Scenario: Failed checks create a fresh implementation visit
  Given landing has advanced from triage through implementation to checks
  When checks report changes
  Then implementation is active with a different bead from the first visit
```

### L4

```gherkin
Scenario: Review findings require repair and a fresh review
  Given landing triage has selected review
  When review reports changes
  Then implementation instructions report No current approval
  When implementation completes and checks pass
  Then review is active with a different bead from the first review
```

### L5

```gherkin
Scenario: Changed commit content requires renewed approval
  Given a closed review has supplied approval and its receipt appears in commit instructions
  When commit reports changed content
  Then checks are active with No current approval
  When checks pass and a fresh closed review supplies approval
  Then the new receipt refers to a different review bead and appears in commit instructions
```

### L6

```gherkin
Scenario: Approval needs a receipt from the closed review
  Given a review worker is closed with scripted evidence and a receipt
  When approved is submitted without the receipt
  Then it fails with invalid_input
  When approved is submitted with the receipt
  Then it succeeds and the review stays closed with the revision in its notes
```

### L7

```gherkin
Scenario: Worktree landing resumes from a surviving checkout
  Given a reviewed worktree target and the same definition in a surviving checkout
  And finish instructions contain the review receipt
  When the original feature checkout is deleted and the finish worker closes
  And feedback is submitted from the surviving checkout
  Then the PR-only outcome is rejected and publication state is unchanged
  When finish advances through verify, publish and report with scripted outcomes
  Then the run is done with no active tasks and its native root is closed
```

### L8

```gherkin
Scenario: Late PR feedback returns through readiness
  Given a reviewed PR target has passed readiness and reached finish
  When finish reports feedback and comments are rebutted
  Then Check PR readiness is active again
```

Restoration mapping (original registration titles):

| Scenario | Source | Original title / variants |
| --- | --- | --- |
| L1 | `land.test.ts:220` | an unclosed worker cannot advance and discovery exposes review receipt constraints |
| L2 | `land.test.ts:254` | a closed worker rejects $mode without publication or advancement — missing evidence; missing reviewed receipt; missing commit receipt; malformed receipt; unknown outcome |
| L3 | `land.test.ts:281` | failed checks create a fresh implementation visit |
| L4 | `land.test.ts:290` | local findings clear approval and the repaired visit creates a fresh review |
| L5 | `land.test.ts:303` | commit content changes invalidate recorded approval until a fresh closed review supplies it |
| L6 | `land.test.ts:303` | commit content changes invalidate recorded approval until a fresh closed review supplies it (approve helper:439–459) |
| L7 | `land.test.ts:318` | a run resumes from a surviving checkout and rejects PR-only feedback for worktree targets |
| L8 | `land.test.ts:335` | late PR feedback and a rebuttal return to readiness instead of bypassing integration gates |

## Navigation and completion

### A1

```gherkin
Scenario Outline: A closed root cannot publish more work
  Given a closed worker beneath a closed root with empty checkpoint notes
  When the worker submits a <transition> outcome
  Then it fails with closed_parent and publication state is unchanged

  Examples:
    | transition |
    | self-loop  |
    | sequence   |
```

### A2

```gherkin
Scenario Outline: Author outcomes may share command names
  Given a closed worker defines an outcome named <choice>
  When that outcome is submitted
  Then a task titled Second is active with a new bead

  Examples:
    | choice     |
    | collect    |
    | initialize |
    | show       |
```

### A3

```gherkin
Scenario: A final state closes only its completed container
  Given a parallel run has a closed worker and an unfinished sibling
  When the closed worker advances to its final state
  Then its native group is closed and only the identical sibling remains active
  And the created-task inventory is identical and checkpoint notes are empty
```

### A4

```gherkin
Scenario: A missing command schema prevents discovery and submission
  Given a worker offers next without its command schema
  When choices are discovered and then next is submitted after worker closure
  Then both fail with missing_command_schema identifying the worker and next choice
  And publication state is unchanged after each attempt
```

### A5

```gherkin
Scenario: A closed worker cannot parent fresh nested work
  Given a closed worker whose next outcome would create a nested task
  When next is submitted
  Then it fails with closed_parent and publication state is unchanged
  And the closed worker record is identical
```

Restoration mapping (original registration titles):

| Scenario | Source | Original title / variants |
| --- | --- | --- |
| A1 | `navigation.test.ts:23` | a closed root rejects $mode publication without changing the checkpoint or task inventory — self-loop; sequence |
| A2 | `navigation.test.ts:40` | authors can submit an outcome named %s — collect; initialize; show |
| A3 | `navigation.test.ts:51` | final states close their container without publishing tasks or changing an unfinished sibling |
| A4 | `navigation.test.ts:68` | discovery and submission report a missing command schema before publishing effects |
| A5 | `navigation.test.ts:90` | a closed worker cannot become a parent of fresh nested work |

## Parallel revisits

### V1

```gherkin
Scenario Outline: Revisiting one branch preserves its sibling
  Given a parallel run has a first-visit worker and an active sibling
  When the worker closes and makes a <route> revisit
  Then a different native worker is in_progress with round 2 instructions
  And the sibling retains its bead and instructions
  And the worker node records visits 1 and 2

  Examples:
    | route     |
    | direct    |
    | transient |
```

Restoration mapping (original registration titles):

| Scenario | Source | Original title / variants |
| --- | --- | --- |
| V1 | `visits.test.ts:14` | a $mode revisit creates fresh work while preserving its parallel sibling — direct; transient |

## Publication failure boundaries

### F1

```gherkin
Scenario Outline: Failure before publication releases ownership
  Given a closed worker and empty checkpoint notes
  When advancing triggers an injected <failure> failure before publication
  Then the command fails with one JSON command_failed result
  And publication state is unchanged with no ownership notes remaining

  Examples:
    | failure |
    | render  |
    | action  |
```

### F2

```gherkin
Scenario: Identity-read failure preserves the original error
  Given a closed worker and an injected native identity-read error before publication
  When the worker advances
  Then navigation rejects with that same error
  And publication state is unchanged and ownership is released
```

### F3

```gherkin
Scenario: An uncertain write retains ownership until a later caller times out
  Given a closed worker whose next outcome creates a task
  When submission creates the native task but an injected error loses its result
  Then submission reports partial_effects and retains nonempty ownership notes
  When a later collector reaches the bounded lock deadline
  Then it reports checkpoint_locked identifying the held checkpoint
  And the ownership notes are unchanged
```

Restoration mapping (original registration titles):

| Scenario | Source | Original title / variants |
| --- | --- | --- |
| F1 | `failure.test.ts:43` | a prewrite $mode failure returns one JSON document and releases ownership without publication — render; action |
| F2 | `failure.test.ts:61` | a native identity-read failure before publication releases ownership without changing state |
| F3 | `failure.test.ts:93` | uncertain postwrite failure retains ownership and a subsequent caller observes the bounded lock deadline |

## Catalogue portability

### C1

```gherkin
Scenario: Changed helpers prevent restoration before import
  Given a named run whose definition helper has changed
  When the run is shown
  Then it fails with definition_changed before importing the module
  And the import marker stays absent and the checkpoint description is unchanged
```

### C2

```gherkin
Scenario: A named run survives removal of its original checkout
  Given identical named definitions in feature and surviving checkouts with separate tracker storage
  And the first worker brief contains busybee --db without the feature checkout path
  When the first worker closes and the feature checkout is deleted
  And the run advances from the surviving checkout
  Then Second task is active
```

Restoration mapping (original registration titles):

| Scenario | Source | Original title / variants |
| --- | --- | --- |
| C1 | `catalogue.test.ts:100` | helper changes reject restoration before import or checkpoint mutation |
| C2 | `catalogue.test.ts:118` | a named run continues from an unchanged surviving checkout with separate tracker storage |

## Reconciliation

| Original file        | Removed cases | Scenario instances |
| -------------------- | ------------: | -----------------: |
| `native.test.ts`     |            18 |                 18 |
| `land.test.ts`       |            11 |                 12 |
| `navigation.test.ts` |             8 |                  8 |
| `visits.test.ts`     |             2 |                  2 |
| `failure.test.ts`    |             4 |                  4 |
| `catalogue.test.ts`  |             2 |                  2 |
| Total                |            45 |                 46 |

The navigation and visits files were removed in full. Only listed cases and table rows were removed from the other files. Native storage, lock races and parent/child closure are external boundaries to reconsider; navigation and receipt behavior may be exercised with an injected tracker after a focused native adapter contract is validated. Keep simulated outcomes distinct from actual checks or integration effects when restoring coverage.
