# Ubiquitous language

Shared vocabulary for agent identity and spawning. Use these terms, exactly, in code, docs and beads. Scent, bee and colony are designed but not yet built; until the package rename lands, `lib/colony` holds the old provider CLI scaffold and `lib/ghost` the daemon scaffold.

## Agents and identity

| Term | Means | Is not | Lives in |
| --- | --- | --- | --- |
| **Harness** | The agent runtime hosting a model session: Claude Code, Codex or Pi. | The model or the provider. | `BR_HARNESS` |
| **Session** | One harness conversation, keyed by the harness's session id; survives resume and compaction. | A process; a fork is a new session. | harness |
| **Native session** | A session a human started directly: a desktop app or a CLI in a terminal. | A bee; it has no bee kind. | — |
| **Identity** | Who an agent is in the audit trail: its friendly name, plus best-effort harness, model and effort. | The owner (always `ct`) or the assignee. | scent, colony |
| **Friendly name** | A three-word adjective-adjective-noun name such as `amber-quiet-otter`, recorded as the actor. Derived from the session id for native sessions or a distinct child key for native subagents; minted at spawn for bees. | A harness name: `claude` is not an identity. | `BD_ACTOR`, `HIVE_AGENT_NAME` |
| **Mint** | Derive a friendly name deterministically from a seed. | Random assignment or a lookup in a registry. | `mintName` in `lib/shared` |
| **Nested child** | A session started from inside another agent's session, such as `pi --print` run by Claude. It gets its own friendly name and records its parent. | A bee. | `HIVE_AGENT_PARENT` |
| **Native subagent** | A child created by the harness's own agent tool. Claude Code and Codex expose a distinct agent id while retaining the parent/root session id; identity attribution uses explicit actor guidance. | A separately launched nested CLI or a colony-managed bee. | harness child-start hooks |
| **Scent** | Per-harness identity plugins: Claude Code and Codex session/child-start hooks and a Pi extension. They resolve identity from harness context and inherited environment, export it where supported and inject it into the prompt. | A reader of `bees.toml`. | `lib/scent` |
| **Actor** | The identity recorded on a `br` mutation. | The owner or the assignee. | `BD_ACTOR`, `--actor` |

## Spawning

| Term | Means | Is not | Lives in |
| --- | --- | --- | --- |
| **Bee** | An agent colony launches to work on task beads, carrying an identity minted at spawn. Also the module and CLI that request bees. | A native subagent definition; those are being retired. | `lib/bee` |
| **Bee kind** | A named entry in `bees.toml`, such as `scout`, choosing the harness CLI, model, effort, arguments and system prompt. | An identity: many bees share a kind. | `bees.toml`, `agent:<kind>`, `BR_AGENT_NAME` |
| **`bees.toml`** | The repository-root registry of bee kinds and users. | Harness-native agent files. | repo root |
| **Users** | Human names listed in `bees.toml`; bee refuses tasks assigned to them. | Owners. | `bees.toml` |
| **Spawn** | Request a bee: `bee spawn <kind> <task-id>...` creates a spawn bead. | Starting a process; colony does that. | `lib/bee` |
| **Colony** | The single system-wide daemon that turns spawn beads into running bees, for every registered repository. | A per-repository process or the old provider CLI. | `lib/colony` |
| **Wake** | Register a repository with colony by running `colony wake` where its `bees.toml` lives. | Starting colony itself. | `lib/colony` |
| **Launch rule** | Colony launches a bee only when all of its open task beads are ready; closed ones count as satisfied. A dependency graph that never becomes ready is a mistake to fix. | A launch while only some task beads are ready. | `lib/colony` |
| **`max_retries`** | How many times colony relaunches a bee, with the same identity, after its process exits while its spawn bead is still open. When exhausted, colony closes the spawn bead and tidies up. | A retry of a failed `br` command. | `lib/colony` |
| **Reap** | End a bee: closing its spawn bead stops its process, and a spawn bead whose tasks all closed before launch is closed unlaunched. | Respawning. | `lib/colony` |
| **Tidy up** | After a reap or `max_retries`, colony returns each task the bee claimed to `open` and removes the claim. | Closing the tasks. | `lib/colony` |

## Beads

| Term | Means | Is not | Lives in |
| --- | --- | --- | --- |
| **Task bead** | A bead describing work, claimed and closed by whoever does it. | A request for a bee. | `.beads/` |
| **Spawn bead** | A bead representing one bee for its whole life: labelled `system`, `bee` and `agent:<kind>`, assigned to the bee's friendly name and linked to its task beads by `related` dependencies. The bee closes it when done, or when its task claim fails. | The work itself. | `.beads/` |
| **`system` label** | Marks automation-owned beads, which ordinary work excludes with `--exclude-label system`. | A prefix: label filters match exactly, so `system:bee` would not be excluded. | labels |
| **`bee` label** | Marks a spawn bead; colony selects `--label system --label bee`. | A bee kind. | labels |
| **`agent:<kind>` label** | The bee kind a spawn bead requests. | The harness or the identity. | labels |
| **`outcome:<value>` label** | How colony saw a spawn bead end: `exhausted` (closed after `max_retries`), `reaped` (closed by someone else while waiting or running) or `unlaunched` (every task closed before launch). Only colony sets it; no label means the bee closed its own spawn bead. | A label on task beads, or one set by bees. | labels |
| **`hitl` label** | Human in the loop: the bead is worked in tandem with the user, so autonomous runners skip it. | A handoff to a human (assignee `ct`) or a blocker. | labels |

## Environment

| Variable | Set by | Carries |
| --- | --- | --- |
| `HIVE_AGENT_NAME` | colony, scent | Friendly name. |
| `HIVE_AGENT_SESSION` | scent, where environment binding is supported | Session the name is bound to; lifecycle context distinguishes a new conversation from a nested child. A mismatch alone does not establish parentage. |
| `HIVE_AGENT_PARENT` | scent | Parent's friendly name in a nested child. |
| `BD_ACTOR` | colony, scent | Friendly name, used by `br` as the actor. |
| `BR_HARNESS`, `BR_MODEL`, `BR_AGENT_NAME` | colony, scent | Harness, model and bee kind recorded on `br` mutations. |

## Related tools

| Term | Means | Lives in |
| --- | --- | --- |
| **Honeycomb** | The Git worktree manager. | `lib/honeycomb` |
| **Shared** | The contract other packages may import: environment names, `mintName` and the `bees.toml` schema. | `lib/shared` |

The [identity MVP scope](./docs/agent-identity-scope.md) defines supported session transitions and exclusions. The [harness capability contract](./docs/harness-capabilities.md) records which runtime mechanisms and integration outcomes have been verified.
