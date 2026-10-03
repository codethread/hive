# Hive

Shared vocabulary for agent identity, spawning and work tracking. Use these terms consistently in code, documentation and beads.

## Agents and identity

**Harness**: The agent runtime hosting a model session, such as Claude Code, Codex or Pi. _Avoid_: Model or provider when referring to the runtime.

**Session**: One harness conversation, keyed by the harness's session ID, that survives resume and compaction. A process is not a session; a fork is a new session.

**Native session**: A session a human started directly through a desktop app or terminal CLI. It is not a bee and has no bee kind.

**Identity**: Who an agent is in the audit trail: its friendly name, plus best-effort harness, model and effort. Identity is distinct from ownership and assignment.

**Friendly name**: An agent's three-word adjective-adjective-noun name, such as `amber-quiet-otter`, used for attribution. _Avoid_: Harness names such as `claude` when naming an individual agent.

**Mint**: Derive a friendly name deterministically from a seed, rather than assigning it randomly or looking it up in a registry.

**Nested child**: A session started from inside another agent's session, with its own identity and a recorded parent. It is not a colony-managed bee.

**Native subagent**: A child created by the harness's own agent tool. It is distinct from a separately launched nested CLI and a colony-managed bee.

**Scent**: Hive's per-harness identity integration, responsible for identity attribution and context. It is separate from bee-kind configuration.

**Actor**: The identity recorded on a Beads mutation. It is distinct from the owner and assignee.

## Spawning

**Bee**: An agent colony launches to work on task beads, carrying an identity minted at spawn. The name also denotes the tool for requesting bees, not a harness-native subagent definition.

**Bee kind**: A named configuration selecting how a bee runs. Many bees may share one kind; a kind is not an identity.

**`bees.toml`**: The repository's registry of bee kinds and human users, distinct from harness-native agent definitions.

**Users**: The human assignees whose tasks bees must leave to them. Being a user is distinct from owning a bead.

**Spawn**: A request for a bee, represented by a spawn bead. Requesting a bee is distinct from starting its process.

**Colony**: The single system-wide daemon that turns spawn beads into running bees for registered repositories. _Avoid_: Per-repository daemon or provider CLI.

**Wake**: Register a repository with colony, rather than start colony itself.

**Launch rule**: The condition that all of a bee's open task beads must be ready before it launches; closed task beads count as satisfied.

**`max_retries`**: The limit on relaunching a bee after its process exits while its spawn bead remains open. It is not a retry limit for tracker commands.

**Reap**: End a bee's lifecycle, including one whose tasks were all closed before launch. Reaping is distinct from respawning.

**Tidy up**: Return a bee's claimed tasks to unclaimed, open work after its lifecycle ends. Tidying does not close the tasks.

## Beads

**Task bead**: A bead describing work, claimed and closed by whoever does it. It is not a request for a bee.

**Spawn bead**: A bead representing one bee throughout its lifetime, linked to the bee's task beads. It is distinct from the work itself.

**`system` label**: Marks automation-owned beads, outside ordinary agent work.

**`bee` label**: Marks a spawn bead, not its bee kind.

**`agent:<kind>` label**: Identifies the bee kind requested by a spawn bead, not its harness or identity.

**`outcome:<value>` label**: Records how colony saw a spawn bead end. It belongs to the spawn bead, not its task beads.

**`hitl` label**: Human in the loop: work performed in tandem with the user, which autonomous runners skip. It is neither a handoff to a human assignee nor a blocker.

## Related tools

**Honeycomb**: Hive's Git worktree manager.

**Shared**: The common contract Hive packages may import.

The [identity design reference](./docs/agent-identity-scope.md) records implementation status, bindings and lifecycle policy; the [harness capability contract](./docs/harness-capabilities.md) records verified runtime mechanisms and integration outcomes.
