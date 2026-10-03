# Agent identity: MVP scope

This records the identity and harness-lifecycle scope agreed on 2026-10-03 for the agent identity and bee spawning epic (`hv-3x8`). It is a design reference; scent, bee and colony are not implemented yet. The [harness capability contract](./harness-capabilities.md) tracks the mechanisms, evidence and acceptance cases behind this scope. Terms follow the [ubiquitous language](../UBIQUITOUS_LANGUAGE.md).

The full bee/colony specification remains work on `hv-3x8.12`, after colony design refinement (`hv-3x8.9.1`). This document does not settle daemon routing, recovery, retry or scheduling details.

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

## Evidence and remaining work

- `hv-3x8.2`: versioned identity-hook and lifecycle findings. Claude/Codex clear and compact were source-verified, not captured live; Pi transitions were observed through RPC.
- `hv-3x8.14`: stable Pi composition verified with two handlers over three independent runs; final explicit-attribution decision for native Claude/Codex subagents. End-to-end child tracker attribution remains unimplemented.
- `hv-3x8.1` and `hv-3x8.3`: database discovery and detached-launch findings. Current repository tracker setup is documented in [Beads integration](./beads-integration.md); older spike recommendations are historical evidence, not current configuration instructions.

The adapters still need to demonstrate stale-state cleanup, target-session resume, compaction continuity and parent/child attribution isolation. Production hook trust/installation and colony recovery/descendant ownership remain explicit implementation or design work. Expanding scope requires updating this reference and the capability matrix with the reason and evidence; it does not silently turn an unverified path into a supported one.
