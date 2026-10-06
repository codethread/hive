# Busy Bee specification

Agreed intent for a general-purpose engine: code review, shopping and other domains supply charts and briefs, not different engine rules. [Busy Bee](./README.md) implements this contract; the [agent walkthrough](./POV.md) shows concrete calls.

## Decisions and reasons

- **Sequence is progression; nesting is parenthood.** XState owns transitions and joins; final states mark completion rather than native work. Native Beads records the resulting hierarchy: stages at the same level are siblings; nested tasks belong to their nearest bead-bearing container. Dynamic work names its containing group. Following a task does not make the next task its child.

- **A bead represents one visit.** Create work at published frontiers and preserve its brief. Accepted worker completion retires that visit even if a loop returns to the same state; untouched parallel tasks retain theirs. This projection does not track every XState microstep: unsubmitted states that exit and re-enter within one macrostep may retain their visit.

- **Workers close; the workflow advances.** Native Beads normally blocks parent closure while children remain open and applies configured acceptance rules. Therefore `next` and `choice` require an already-closed worker task; they must not close it themselves. This delegates completion policy to Beads, including worker-created subtasks. The visit must still be active and its result valid. Automatic collection follows the same principle. [Native integration checks](./tests/native-probe.ts).

- **Containers outlive their tasks.** A container groups work without its own worker outcome. The engine closes it when its stage finishes, and closes the outer workflow run on completion. Reject transitions that would create children beneath an existing closed bead, including the workflow root, before publishing effects; do not reopen that parent. This keeps completed work from unexpectedly becoming an active container.

- **Discover contracts, rather than duplicate them.** Zod schemas drive input validation and read-only CLI discovery in readable and machine-readable forms. State context may impose additional constraints, which discovery explains. Task briefs describe the work rather than repeat JSON payload templates. Author outcome names and runner operations have separate identities, so no outcome names are reserved by the engine. [Input contract guide](./README.md#author-a-definition).

- **Separate readable work from machine state.** Beads has no general-purpose issue metadata field suitable for a workflow checkpoint; its description, design and notes serve human-facing work. Store the checkpoint on a separate `system` bead, excluded from ordinary task selection. Connect it with a nonblocking `related` edge so the runner can discover state without creating a work prerequisite. Beads supports relationship metadata, but that is distinct from checkpoint storage. [Checkpoint representation](./README.md#checkpoint-and-failure-boundary).

- **Serialize updates, not workers.** Use an atomic, per-invocation lock around fresh-state validation and publication. Agents perform work concurrently outside that short boundary. Contenders must share one live database; [tracker synchronization](../../docs/beads-integration.md) does not provide a distributed lock. [Lock and failure boundary](./README.md#checkpoint-and-failure-boundary).

- **Use the selected native tracker.** An explicit `--db` overrides `BEADS_DB` and native repository discovery. Delegate selection to `br`, including environment configured by mise. The execution directory defaults to the current directory and remains independent of tracker storage.

- **Keep identity roles distinct.** Require the calling agent’s `--actor` or `BD_ACTOR` for mutations and a human `--owner` when starting. Assign the run and manual work to the initiating actor or explicit assignee. Later tasks inherit the run’s native owner/assignee; grouping and system checkpoint beads remain unassigned. Audit attribution follows the current caller, not ownership.

## Definition catalogue

Definitions live at the caller checkout root in `.workflows/<name>/busybee.toml`. Required description and relative `run = "./workflow.ts"` (or another `.js`/`.ts` filename) identify the entry; optional version text is descriptive. `list` reads validated metadata without executing code. `run NAME` and `input-schema NAME` resolve that catalogue from Git's checkout root, including nested callers and explicit `--repo`. Explicit-path `start` and `input-schema --source` remain authoring tools.

Named runs resolve their name in the caller's current checkout and compare a fingerprint of the definition folder before importing. This permits continuation from an unchanged copy after deleting a worktree. The check includes local helpers but not external imports or installed packages. Resuming after definition changes is unsupported: it may work or fail, with no compatibility or migration promise. Version metadata is not a compatibility mechanism.

## Definition validation

`validate PATH` imports a trusted definition, parses supplied input (default `{}`), resolves the XState definition and computes a pure initial transition, rejecting error snapshots. It performs no native resolution or writes and starts no live actor. Success proves those limited checks, not all reachable paths or action implementations. Modules and callbacks must leave stdout and stderr to Busy Bee to preserve CLI output. Imports, context, assign and guards remain executable author code; this requirement does not sandbox other I/O. Strict TypeScript checks Busy Bee itself; native JSON enters through schemas and process execution through the Shared adapter.

## Limits

Closure records completion; it does not independently verify the work and can be explicitly overridden outside the engine. Locking does not make external effects transactional. The current implementation retains uncertain failed ownership, without automatic expiry or partial-effect recovery.

Keep this specification and its linked verification evidence aligned when a decision changes.
