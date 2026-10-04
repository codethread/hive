# Hive

Shared vocabulary for Hive's agents, work tracking and repository tooling. Use these terms consistently in code, documentation and beads.

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

**Bee**: A running agent spawned by Colony. Also the name of the CLI used to submit and inspect spawn requests.

**Bee kind**: A named set of defaults describing how a bee runs, distinct from the identity of any bee using it.

**Colony**: Hive's scheduling and execution product, including its control CLI and hosting daemon. A repository's colony is its scheduling and reconciliation activity, which can be awake or asleep. _Avoid_: Daemon when referring to one repository's colony.

**Colony daemon**: The server hosting colonies for registered repositories, distinct from any one colony or running bee.

**Requester**: The human or agent identity that requested a bee, recorded as provenance rather than ownership.

**Recipe**: The effective instructions and execution attributes captured for a spawn request, including its bee kind, harness, model, effort and execution directory.

**Formula**: A named harness invocation template applied to a recipe when an execution attempt starts. Changing a formula does not change the captured recipe.

**Execution attempt**: One launch to fulfil a spawn request. A retry is a new attempt using the same request and friendly identity.

**Colony observation**: A timestamped report of what a colony last observed about a spawn request or its execution. It is historical evidence, not proof of present daemon or process availability.

## Beads

**Task bead**: A bead describing a unit of work, not a request to run a bee.

**Spawn request**: A request for a bee to complete specified task beads, carrying a captured recipe and friendly identity. It can exist before any bee runs and span several execution attempts.

**Spawn bead**: The Beads record representing a spawn request, distinct from its task beads and execution attempts.

**Actor**: The identity credited with a change to a bead, distinct from its owner and assignee.

**Owner**: The human accountable for a bead, giving collaborators a clear point of responsibility separate from whoever is assigned to do the work.

**Assignee**: The human or agent identity assigned to work on a bead, distinct from its owner or the actor making a particular change.

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
