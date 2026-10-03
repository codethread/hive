# Agent identity: MVP scope

This records the identity and harness-lifecycle scope agreed on 2026-10-03 for the agent identity and bee spawning epic (`hv-3x8`). It is a design reference; scent, bee and colony are not implemented yet. The [harness capability contract](./harness-capabilities.md) tracks the mechanisms, evidence and acceptance cases behind this scope. Terms follow the [glossary](../GLOSSARY.md).

The full bee/colony specification remains work on `hv-3x8.12`, after colony design refinement (`hv-3x8.9.1`). The recorded implementation notes below preserve existing design constraints; they do not settle the remaining daemon routing, recovery, retry or scheduling details. Current tracker operations continue to follow the Beads / br rules in the root `AGENTS.md`, including harness-name actors, until the planned identity integration lands.

## Supported identity paths

| Runtime surface | Planned attribution | Boundary |
| --- | --- | --- |
| Native Pi session | Extension sets identity environment variables and composes identity into the system prompt on every agent run | Each handler preserves the prompt it receives; a base-prompt renderer runs before appenders |
| Primary Claude Code session | SessionStart writes quoted identity exports to the session environment file and adds identity context | These exports are shared with native subagent Bash calls |
| Native Codex session | Identity context directs every tracker mutation to use `--actor <own-friendly-name>` | Hooks cannot export dynamically minted identity into later tool shells |
| Native Claude Code or Codex subagent | Child identity context uses the same explicit actor guidance as native Codex | Use the distinct `agent_id`, not the shared parent/root `session_id`; leave the parent's environment unchanged |
| Colony-launched bee | Launcher supplies the bee identity; scent adopts it where available | Identity belongs to the spawn bead and survives colony respawns; a bee is not a harness-native subagent |

Explicit actor arguments take precedence over inherited `BD_ACTOR`. Shared guidance belongs to the attribution behavior; event parsing and context delivery remain harness-specific. Missing model or effort metadata is omitted rather than invented.

Pi's per-run prompt composition is ordinary supported API behavior. It can keep identity stable without accumulating copies or introducing a separate prompt-persistence mechanism. Repeated lifecycle callbacks must resolve the same session consistently.

## Lifecycle boundary

These rows describe intended Hive behavior, not completed adapter verification. A changed session ID alone is insufficient to classify an event as a nested child.

| Transition | Meaning | MVP behavior |
| --- | --- | --- |
| Start | Begin a native session or launch a bee | Resolve the native identity from its session, or adopt the supplied bee identity |
| Clear/new | Replace the current conversation with a fresh session, possibly inside the same process | Support the transition. Replace Hive-owned session bindings and prompt contributions; resolve against the new session ID. Preserve unrelated environment and launcher-supplied bee identity |
| Resume | Select a saved session, from a CLI or within the harness | Support the transition. Restore the target session's identity rather than retaining the identity of the session being left |
| Compact | Shorten history within the same session | Support it without changing identity; maintain or reapply the identity contribution through the harness's supported mechanism |
| Native subagent start | The harness creates a child agent, possibly with copied history | Support identity attribution through the child-start event and distinct child key; this does not create a colony spawn bead |
| Separately launched nested CLI | An agent starts another harness process | Keep the existing nested-child identity path. Known Codex parent-binding limitations remain explicit in the capability reference |
| Fork-in-session | A user forks conversation history through a harness command or UI | Outside MVP support |
| New-fork | A CLI starts a new session from existing conversation history | Outside MVP support |

For native sessions, deterministic session-based names mean a clear/new session gets a new friendly name; resume and compact retain the existing one. The hook's reason is supporting evidence, not a universal source of session identity: a fresh Pi process can report `startup` when loading session material. The capability contract records which entry paths have actually been exercised.

Clearing owned state means replacing this integration's identity state. It does not mean clearing all environment variables, editing old conversation history, or removing another extension's prompt contribution. The precise cleanup mechanics and bee-session rebinding are adapter acceptance work.

## Considered and intentionally deferred

| Considered behavior | Why it is outside MVP |
| --- | --- |
| User fork-in-session and new-fork support | Bead handoff is the preferred work-transfer mechanism. Retaining old conversation instructions makes identity migration a separate problem with limited immediate value |
| Reusing the original identity for a user fork | Independent sessions would share audit attribution. We have not chosen that tradeoff to preserve cache |
| Rewriting a fork's early identity prompt | It can reduce cached-prefix reuse and requires a deliberate history/identity policy |
| Appending an automated identity-change message to a user fork | Plausible later support, but placement, authority, repetition and cache effects have not been verified across harnesses |
| Cache-preserving identity migration or cache-hit guarantees | The spikes measured hook and launch behavior, not cache reuse. Preserving text alone does not establish a cache hit |
| Automatic support for ChatGPT, Claude.ai or other GUI orchestration | No generic GUI contract was tested. A particular app/runtime must be entered and verified as its own surface |
| Treating native subagents as colony-managed bees | Native identity attribution does not give colony ownership of their launch, queue, retries or reap lifecycle |
| A runtime capability-negotiation framework | A documented contract and adapter-specific evidence are sufficient for this MVP; no discovery service, plugin registry or fallback framework is required |

Outside MVP means that Hive does not claim correct identity migration or conformance for those user-fork flows. It does not disable the harness command or grant permission to reuse an identity. Incidental hook behavior is not a support guarantee.

Native subagents remain separate from user forks. The Codex 0.160.0 source routes both fresh and history-forked collaboration children through `SubagentStart`; Claude's native Agent children also expose a child-start event. Internal copying of history does not by itself put a supported child into the excluded user-fork category.

## Recorded implementation notes

These notes preserve the planned bindings and policies formerly kept alongside the vocabulary. They are design context, not claims of implemented behavior.

### Modules and identity bindings

Until the package rename lands, `lib/colony` holds the old provider CLI scaffold and `lib/ghost` the daemon scaffold. Planned responsibilities are:

| Location | Responsibility |
| --- | --- |
| `lib/scent` | Claude Code and Codex session/child-start hooks and a Pi extension; resolve identity from harness context and inherited environment, export it where supported and inject it into the prompt. Scent does not read `bees.toml` |
| `lib/bee` | Module and CLI for requesting bees |
| `lib/colony` | Single system-wide daemon for registered repositories |
| `lib/shared` | Shared contract: environment names, `mintName` and the `bees.toml` schema |
| `lib/honeycomb` | Git worktree manager |

Friendly names are recorded as actors. Native sessions use their harness session ID as the mint seed; native subagents use a distinct child key; bees receive a name minted at spawn. A separately launched nested CLI, such as `pi --print` run by Claude, gets its own friendly name and records its parent. Claude Code and Codex native children expose a distinct agent ID while retaining the parent/root session ID, so their attribution uses explicit actor guidance.

| Variable | Set by | Carries |
| --- | --- | --- |
| `HIVE_AGENT_NAME` | colony, scent | Friendly name |
| `HIVE_AGENT_SESSION` | scent, where environment binding is supported | Session the name is bound to; lifecycle context distinguishes a new conversation from a nested child. A mismatch alone does not establish parentage |
| `HIVE_AGENT_PARENT` | scent | Parent's friendly name in a nested child |
| `BD_ACTOR` | colony, scent | Friendly name, used by `br` as the actor; `--actor` explicitly selects attribution |
| `BR_HARNESS`, `BR_MODEL`, `BR_AGENT_NAME` | colony, scent | Harness, model and bee kind recorded on `br` mutations |

### Bee configuration and lifecycle

The repository-root `bees.toml` registry selects each bee kind's harness CLI, model, effort, arguments and system prompt. It also lists human users; bee refuses tasks assigned to those users. Bee kinds replace harness-native subagent definitions for colony-managed work, not native-child identity support.

- `bee spawn <kind> <task-id>...` creates a spawn bead; colony starts the process. Run `colony wake` where the repository's `bees.toml` lives to register it, not to start colony itself.
- Colony launches a bee only when all its open task beads are ready; closed tasks count as satisfied. A dependency graph that never becomes ready is a mistake to fix.
- A bee closes its own spawn bead when done or when its task claim fails.
- Closing a spawn bead stops its bee's process. If all tasks close before launch, colony closes the spawn bead unlaunched.
- `max_retries` limits relaunches after a process exits while its spawn bead remains open. Relaunches retain the same identity; exhaustion closes the spawn bead and triggers cleanup.
- After a reap or retry exhaustion, colony returns each task the bee claimed to `open` and removes its claim. It does not close the tasks.

### Spawn-bead labels and links

Spawn beads carry `system`, `bee` and `agent:<kind>`, are assigned to the bee's friendly name and link to their task beads with `related` dependencies. Colony selects `--label system --label bee`.

`system` marks automation-owned beads excluded from ordinary work with `--exclude-label system`. Label filters match exactly; `system:bee` would not be excluded. `agent:<kind>` denotes the requested bee kind, not the harness or identity.

Only colony sets `outcome:<value>` on spawn beads:

| Value        | Meaning                                         |
| ------------ | ----------------------------------------------- |
| `exhausted`  | Closed after `max_retries`                      |
| `reaped`     | Closed by someone else while waiting or running |
| `unlaunched` | Every task closed before launch                 |

No outcome label means the bee closed its own spawn bead. These labels do not belong on task beads and are not set by bees. A `hitl` task is worked in tandem with the user and skipped by autonomous runners; a deliberate human handoff instead assigns `ct`.

## Evidence and remaining work

- `hv-3x8.2`: versioned identity-hook and lifecycle findings. Claude/Codex clear and compact were source-verified, not captured live; Pi transitions were observed through RPC.
- `hv-3x8.14`: stable Pi composition verified with two handlers over three independent runs; final explicit-attribution decision for native Claude/Codex subagents. End-to-end child tracker attribution remains unimplemented.
- `hv-3x8.1` and `hv-3x8.3`: database discovery and detached-launch findings. Current repository tracker setup is documented in [Beads integration](./beads-integration.md); older spike recommendations are historical evidence, not current configuration instructions.

The adapters still need to demonstrate stale-state cleanup, target-session resume, compaction continuity and parent/child attribution isolation. Production hook trust/installation and colony recovery/descendant ownership remain explicit implementation or design work. Expanding scope requires updating this reference and the capability matrix with the reason and evidence; it does not silently turn an unverified path into a supported one.
