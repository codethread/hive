# Hive

Shared vocabulary for Hive's agents, work tracking and repository tooling. Use these terms consistently in code, documentation and beads.

UI presentation names are defined in the nested [Hive UI glossary](./lib/hive-ui/GLOSSARY.md).

_To be built_ marks capabilities still planned beyond the Bee and Colony implementation.

## Agents and identity

**Agent**: A coding assistant operating through a harness, whether started directly or through automation.

**Harness**: The runtime hosting an agent, such as Claude Code, Codex or Pi. _Avoid_: Model or provider when referring to the runtime.

**Session**: A harness conversation, distinct from an agent identity or an operating-system process.

**Harness subagent**: An agent created through a harness's built-in delegation mechanism rather than through Colony.

**Identity**: Who a human or agent is for attribution, independent of agent attributes, ownership and assignment. An identity ordinarily distinguishes one individual, but uniqueness is not guaranteed.

**Friendly name**: An agent's human-readable attribution name, ordinarily three words such as `amber-quiet-otter`. _Avoid_: Harness names such as `claude` when naming an individual agent.

**Agent attributes**: Best-effort observations of how an agent runs, such as its harness, model and reasoning effort. They describe an identity's execution, not the identity itself, and are not guaranteed to remain unchanged or accurate.

**Scent**: Hive's per-harness integration for agent identity attribution and context, independent of bee-kind configuration. _To be built — hv-3x8.7._

## Bees

**Bee**: An agent running as a configured bee kind, either interactively with a user or managed by Colony. Also the name of the CLI used to open those sessions and submit or inspect spawn requests.

**Bee kind**: A named set of defaults describing how a bee runs, distinct from the identity of any bee using it.

**Colony**: Hive's scheduling and execution product, including its control CLI and hosting daemon. A repository's colony is its scheduling and reconciliation activity, which can be awake or asleep. _Avoid_: Daemon when referring to one repository's colony.

**Colony daemon**: The server hosting colonies for registered repositories, distinct from any one colony or running bee.

**Requester**: The human or agent identity that requested a bee, recorded as provenance rather than ownership.

**Recipe**: The effective role/protocol, optional execution direction and execution attributes captured together for one spawn request, including its bee kind, harness, model, effort and execution directory. Linked task beads supply the authoritative assignment and acceptance criteria.

**Formula**: A named template for invoking a harness using a bee's effective instructions and execution attributes. Its `argv` applies to every invocation; optional `headless` arguments are prepended for managed execution. Changing a formula does not change a captured recipe.

**Execution attempt**: One launch to fulfil a spawn request. An automatic retry starts another attempt using the same request and friendly identity.

**Colony observation**: A timestamped report of what a colony last observed about a spawn request or its execution. It is historical evidence, not proof of present daemon or process availability.

**Post-run assessment**: An advisory inspection of a settled request and its execution attempts, distinct from the request outcome or a verdict about a running bee.

**Welcoming hive**: The heuristic that a bee should receive a crisp assignment, reach appropriate guidance efficiently, complete its task and deliver a cohesive response. It examines avoidable token and context overhead in finding that path.

**Nurse**: The colony-health advisor who synthesizes assessment evidence for the human. Recommendations do not authorize changes or new change tasks.

## Beads

**Task bead**: The authoritative assignment, context and acceptance criteria for a unit of work, distinct from a request to run a bee.

**Merge bead**: A reference record for a provider-hosted merge request and the tasks it delivers. _Avoid_: PR bead; the term is provider-neutral.

**System bead**: An automation-owned record of coordination or execution state, distinct from the work assigned to an agent. Spawn beads and workflow system beads are system beads.

**Blocked**: A bead whose recorded status is `blocked`, distinct from waiting on unresolved prerequisites or an unsuccessful spawn outcome.

**Ready**: Eligibility for engine selection: a bead belongs to the configured ready status group (`open` by default), has no unresolved blocking prerequisites or active time gate, and is not excluded as a non-work record. Query filters select among eligible beads; readiness alone does not establish specification completeness.

**Ready for dev**: A task sufficiently specified, with the applicable criteria and details, to begin development. It may still await unresolved blocking prerequisites and therefore be ready for dev without being ready.

**Spawn request**: A request for a bee to complete specified task beads, carrying a captured recipe and friendly identity. It can exist before any bee runs and span several execution attempts.

**Spawn bead**: The system bead representing a spawn request, distinct from its task beads and execution attempts.

**Request outcome**: How a spawn request ended, or whether it remains pending. A replacement does not change its predecessor's unsuccessful outcome.

**Request resolution**: Whether a request still needs follow-up. A failed request can be resolved while its failure remains part of the history.

**Supersession**: Replacement of an unsuccessful request with a newly submitted request. The original and replacement retain separate identities, outcomes and execution histories.

**Actor**: The identity credited with a change to a bead, distinct from its owner and assignee.

**Owner**: The human accountable for a bead, giving collaborators a clear point of responsibility separate from whoever is assigned to do the work.

**Assignee**: The human or agent identity assigned to work on a bead, distinct from its owner or the actor making a particular change.

## Workflows

**Busy Bee**: Hive's workflow engine, which turns a workflow into work beads and advances from their accepted outcomes.

**Workflow**: A definition of work, its possible outcomes and how those outcomes determine subsequent work.

**Workflow run**: One execution of a workflow.

**Workflow run bead**: The work record representing one workflow run and containing its work, distinct from the workflow system bead that records its state.

**Workflow system bead**: The system bead holding a workflow run's saved state and record of generated work.

**Workflow auto bead**: A workflow-generated work bead that can be ready for dev and is recorded as part of that run by its workflow system bead. Its creation provenance is independent of who performs the work.

**Workflow manual bead**: An agent-created bead, distinct from work generated by the workflow. Nesting it beneath a workflow run does not make it a workflow auto bead; within workflow context, _manual_ and _auto_ (or _automatic_) describe creation provenance.

**Grouping bead**: A container for related workflow work, with no worker outcome of its own.

**Workflow driver**: The agent coordinating a run by performing its driver-handled work and collecting completed outcomes. Busy Bee owns progression and run closure.

**Driver-handled work**: Workflow work performed by the coordinating caller or driver without a separate Bee dispatch. _Avoid_: Manual work when referring to dispatch.

**Bee-dispatched work**: Workflow work delegated to a separately requested Bee worker. _Avoid_: Auto or automatic work when referring to dispatch.

## Work modes

**Human-in-the-loop (HITL) work**: Work undertaken by an agent and a human together, distinct from work handed off to a human.

**Away-from-keyboard (AFK) work**: Work planned by a human with an agent, then carried out autonomously without ongoing human participation. This is the intended default mode for bees.

## Repositories and worktrees

**Honeycomb**: Hive's Git worktree manager.

**Repository**: A Git repository shared by its worktrees, not a single checkout. _Avoid_: Project when referring to Honeycomb's unit of management.

**Worktree**: An individual checkout of a repository, with its own working directory and checked-out revision.

**Canonical worktree**: The repository's primary worktree, protected by Honeycomb and used to anchor repository-wide configuration and policy. Its canonical status does not depend on which branch is checked out.

**Canonical root**: The top-level directory of the canonical worktree, not a branch.

**Default branch**: The repository's designated integration branch, commonly `main` or `trunk`, distinct from the canonical worktree and its directory.

**Regular worktree**: A non-canonical worktree that is not part of a worktree pool.

**Worktree pool**: A fixed set of reusable worktree slots for one repository.

**Pool slot**: A fixed position in a worktree pool, reserved for a reusable checkout.

**Pooled worktree**: A reusable worktree occupying a pool slot, whose directory is retained as it moves between working branches.

**Placeholder branch**: A branch reserved for a pool slot when it is not holding a working branch.

**Recycle**: Return a pooled worktree to availability without removing its directory.

**Multiplexer session**: A terminal session associated with a worktree for navigation, distinct from a harness conversation.

Earlier identity and lifecycle proposals are recorded in the [identity design reference](./docs/agent-identity-scope.md); runtime evidence is in the [harness capability contract](./docs/harness-capabilities.md).
