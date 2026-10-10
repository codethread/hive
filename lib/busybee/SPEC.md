# Busy Bee specification

Busy Bee is a general-purpose workflow engine. Domains supply charts, schemas and task briefs; the engine owns their projection into Beads. See the [user guide](./README.md) for commands and the [authoring guide](../../docs/busybee-workflows.md) for the definition contract.

## Work and progression

**XState owns progression; Beads owns work.** Sequential stages are siblings. Nested tasks belong to their nearest bead-bearing container; dynamic actors name their containing group. Final states mark completion without creating work. This preserves the distinction between doing something next and doing it as part of another task.

**Each bead represents a visit.** Only work at a published frontier is created. Its task callback renders the brief once, which remains fixed for that visit. An accepted worker result retires the visit even when a loop returns to the same state; untouched parallel tasks retain theirs. Projection observes published frontiers, not every XState microstep: unsubmitted states that leave and re-enter within one macrostep may retain their visit.

**Workers close; Busy Bee advances.** A submission requires a still-active visit, a valid result and an already-closed worker bead. `next`, `choice` and automatic collection delegate closure policy to native Beads, including acceptance gates and worker-created subtasks. Closure records completion, not independent verification of the work; native policy can be overridden outside Busy Bee.

**Containers outlive their tasks.** Containers have no worker outcome. Busy Bee closes them when their stage finishes and closes the run on completion. Transitions that would create children beneath an existing closed bead, including the run, fail before publication. Completed work is never reopened to serve as a container.

## Contracts and authority

Zod schemas drive validation and CLI discovery; task briefs describe work instead of copying payload templates. Definitions can add context-dependent validation and explain those constraints in discovery. Author outcomes and runner operations have separate identities, so outcome names are unrestricted by runner command names.

The caller's Git checkout supplies the workflow catalogue; native `br` selects the tracker. Execution directory and database storage remain independent. Named runs resolve their saved name in the current checkout, allowing continuation from an unchanged copy after worktree removal. Restore rejects fingerprint mismatches before importing the definition. Fingerprints do not establish dependency compatibility; see [resume limits](./README.md#resume-and-failures).

Identity follows native Beads roles: the current actor receives mutation attribution; the human owner remains accountable; the run's assignee determines manual-task assignment. Grouping and checkpoint beads have no assignee. Automatic tasks are left for Colony to claim. [Ownership options](./README.md#ownership-and-assignment).

## Checkpoint and failure boundary

Readable run and task beads stay separate from machine state. A related bead labelled `system` and `busybee-checkpoint` stores the deep XState snapshot and visit history in its description, with the lock UUID and diagnostic PID in its notes. The `system` label excludes it from ordinary task selection; a nonblocking `related` edge makes it discoverable without adding a work prerequisite. Beads relationship metadata is not checkpoint storage.

Each mutation uses native `br update --if-unchanged` to acquire a per-invocation lock, then reads fresh state, validates the submission batch, advances actors, publishes task/Bee effects and saves the checkpoint. Release is conditional on ownership. Agents work outside this short lock; contenders wait up to ten seconds and never steal it. All writers must share one live database: [tracker synchronization](../../docs/beads-integration.md) is not a distributed lock.

Failures before a publication write is attempted release ownership. Once a write is attempted, uncertain failure retains ownership for inspection. Multi-write effects are not transactional: initialization can leave orphan records, and later failures can leave partial tasks or Bee requests. There is no automatic expiry, retry or recovery. A PID alone does not establish ownership; inspect native records and the owner before explicit recovery, and prefer a fresh run after uncertain effects.

## Validation boundary

`validate` checks definition resolution, supplied input and the pure initial XState snapshot. It creates no beads and starts no live actor. It does not prove later paths, guards or action implementations. Workflow code remains trusted executable code, including imports and calculations performed during validation; see [definition validation](../../docs/busybee-workflows.md#validate-a-definition).

The retained [native integration tests](./tests/integration/native.test.ts) exercise repository tracker selection, schema discovery without a database and executable JSON errors; the [failure test](./tests/integration/failure.test.ts) covers initial actor failure before native tasks are created. Closure, hierarchy, concurrency and publication-failure checks are deferred in the [Busy Bee coverage record](../../docs/test-cases/busybee.md), with original assertions and restoration pointers. [Package agent guidance](./AGENTS.md#verification) maps the remaining checks. Update the relevant evidence when changing these decisions.
