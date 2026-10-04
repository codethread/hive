# Hive

Shared vocabulary for Hive's agents, work tracking and repository tooling. Use these terms consistently in code, documentation and beads.

_To be built_ marks planned Hive capabilities from the agent identity and bee-spawning epic (`hv-3x8`); the cited beads record their scope.

## Agents and identity

**Agent**: A coding assistant operating through a harness, whether started directly or through automation.

**Harness**: The runtime hosting an agent, such as Claude Code, Codex or Pi. _Avoid_: Model or provider when referring to the runtime.

**Session**: A harness conversation, distinct from an agent identity or an operating-system process.

**Harness subagent**: An agent created through a harness's built-in delegation mechanism rather than through Colony.

**Identity**: Who a human or agent is for attribution, independent of agent attributes, ownership and assignment. An identity ordinarily distinguishes one individual, but uniqueness is not guaranteed.

**Friendly name**: An agent's human-readable, three-word attribution name, such as `amber-quiet-otter`. _Avoid_: Harness names such as `claude` when naming an individual agent. _To be built — hv-3x8.6._

**Agent attributes**: Best-effort observations of how an agent runs, such as its harness, model and reasoning effort. They describe an identity's execution, not the identity itself, and are not guaranteed to remain unchanged or accurate.

**Scent**: Hive's per-harness integration for agent identity attribution and context, independent of bee-kind configuration. _To be built — hv-3x8.7._

## Bees

**Bee**: A running agent spawned by Colony through `bee`. Also the name of the CLI used to request bees. _To be built — hv-3x8.8, hv-3x8.9._

**Bee kind**: A named configuration describing how a bee runs, distinct from the identity of any bee using it. _To be built — hv-3x8.6._

**Colony**: The system-wide daemon for running bees across registered repositories. _Avoid_: Per-repository daemon or provider CLI. _To be built — hv-3x8.9._

**Requester**: The human or agent identity that requested a bee, recorded as provenance rather than ownership. _To be built — hv-3x8.8._

## Beads

**Task bead**: A bead describing a unit of work, not a request to run a bee.

**Spawn bead**: A bead recording a request for a bee to work on specified task beads. _To be built — hv-3x8.8._

**Actor**: The identity credited with a change to a bead, distinct from its owner and assignee.

**Owner**: The human accountable for a bead, giving collaborators a clear point of responsibility separate from whoever is assigned to do the work.

**Assignee**: The human or agent identity assigned to work on a bead, distinct from its owner or the actor making a particular change.

## Work modes

**Human-in-the-loop (HITL) work**: Work undertaken by an agent and a human together, distinct from work handed off to a human.

**Away-from-keyboard (AFK) work**: Work planned by a human with an agent, then carried out autonomously without ongoing human participation. This is the intended default mode for bees. _To be built for bees — hv-3x8.9._

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
