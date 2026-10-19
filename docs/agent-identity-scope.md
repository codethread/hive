# Agent identity: MVP scope

This preserves the native identity scope agreed on 2026-10-03 for `hv-3x8`, while distinguishing implemented behavior from remaining verification. Scent implements a native Pi 1.2.0 extension and Claude Code/Codex session and child command hooks. Bee and Colony are implemented under `hv-e8i`; their current commands, scheduling and recovery behavior are documented in the [guide](../lib/colony/README.md) and [architecture](./architecture.md).

The [harness capability contract](./harness-capabilities.md) keeps dated upstream observations separate from current Hive verification. Terms follow the [glossary](../GLOSSARY.md). Repository contributors continue to follow the root `AGENTS.md` actor rules; Colony workers receive their captured friendly identity through the launcher.

## System attribution

Caller-driven CLI mutations retain the human or agent caller's identity. Native claim acquisition uses the bee's identity because `br update --claim` sets the assignee to the actor. Other automatic work uses these system actors:

| Actor | Attribution scope |
| --- | --- |
| `sys-beeswax` | Beeswax setup and tracker plumbing when no caller actor is supplied |
| `sys-colony` | Colony observations, automatic claim release, spawn request settlement and request-label reconciliation |
| `sys-memory` | In-memory Beads adapter default when neither the operation nor adapter supplies an actor |

Hive UI is read-only and supplies no actor. Any future UI mutations must use the human user's identity, such as `ct`.

## Native identity paths

| Runtime surface | Attribution | Boundary |
| --- | --- | --- |
| Native Pi 1.2.0 session | Scent exports identity to tool environment and contributes one named `scent` prompt section on each agent run | Uses `systemPromptOptions.sections`; preserves other named sections |
| Primary Claude Code session | SessionStart writes quoted identity exports to the session environment file and adds identity context | These exports are shared with native subagent Bash calls |
| Native Codex session | Identity context directs every tracker mutation to use `--actor <own-friendly-name>` | Hooks cannot export dynamically minted identity into later tool shells |
| Native Claude Code or Codex subagent | Child identity context uses the same explicit actor guidance as native Codex | Use the distinct `agent_id`, not the shared parent/root `session_id`; leave the parent's environment unchanged |
| Colony-launched bee | Launcher supplies the bee identity; scent adopts it where available | Identity belongs to the spawn bead and survives colony respawns; a bee is not a harness-native subagent |

Explicit actor arguments take precedence over inherited `BD_ACTOR`. Shared guidance belongs to the attribution behavior; event parsing and context delivery remain harness-specific. Missing model or effort metadata is omitted rather than invented.

Pi's per-run prompt composition is ordinary supported API behavior. It can keep identity stable without accumulating copies or introducing a separate prompt-persistence mechanism. Repeated lifecycle callbacks must resolve the same session consistently.

## Lifecycle boundary

These rows describe the shared lifecycle contract, not proof of adapter conformance. A changed session ID alone is insufficient to classify an event as a nested child.

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

## Considered and intentionally parked

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

## Current implementation and planned bindings

Colony owns the CLI and runtime in one package. Bee remains the request interface within that package:

| Location | Current responsibility |
| --- | --- |
| `lib/colony` | Bee request interface and Colony commands, daemon hosting independent repository colonies, dispatch, claims, retries, supervision and recovery |
| `lib/beads` | Consumed native Beads contract and injected native/in-memory adapters |
| `lib/shared` | Shared recipes, formulas, spawn-request representation and protocol |
| `lib/honeycomb` | Git worktree manager and canonical-root discovery |
| `lib/scent` | Reusable identity resolver and explicit-actor prompt, native Pi 1.2.0 extension and Claude Code/Codex session and child command hooks; independent of `.hive/bees.toml` |

The following bindings define the shared identity direction. Pi and primary Claude sessions bind name, actor, current session and best-effort metadata through the environment; Codex and native children use explicit attribution context. Parent attribution remains unimplemented. Current Bee names are minted at submission or supplied by the requester; execution attempts retain that name.

Friendly names are recorded as actors. Native sessions use their harness session ID as the mint seed; native subagents use a distinct child key; bees receive a name minted at spawn. A separately launched nested CLI resolves its own session identity; the planned parent binding below remains separate. Claude Code and Codex native children expose a distinct agent ID while retaining the parent/root session ID, so their attribution uses explicit actor guidance.

Bee clears `HIVE_AGENT_SESSION` before launch. Pi and Codex adopt `HIVE_AGENT_NAME` when `HIVE_AGENT_SOURCE=bee` or the inherited session binding is absent/empty. Pi retains Bee provenance across conversation changes; Codex applies this selection to hook context without environment writes.

Claude adopts `HIVE_AGENT_NAME` only when the inherited `HIVE_AGENT_SESSION` is absent/empty. Its SessionStart hooks retain the original launcher environment: exports written to `CLAUDE_ENV_FILE` affect later tool shells. Same-process lifecycle hooks therefore retain the supplied Bee name. A separately launched CLI inherits the populated binding, resolves its actual session and clears inherited kind, model and effort, even with `HIVE_AGENT_SOURCE=bee`; the event can supply the current model. This is an adapter-local lifecycle mechanism, without ancestry inference or changes to the shared resolver or launcher provenance.

Native child hooks always resolve `agent_id` independently of the supplied parent name.

| Variable | Set by | Carries |
| --- | --- | --- |
| `HIVE_AGENT_NAME` | colony, scent | Friendly name |
| `HIVE_AGENT_SESSION` | scent, where environment binding is supported | Session the name is bound to; lifecycle context distinguishes a new conversation from a nested child. A mismatch alone does not establish parentage |
| `HIVE_AGENT_PARENT` | scent, planned | Parent's friendly name in a nested child; no current ancestry inference |
| `BD_ACTOR` | colony, scent | Friendly name, used by `br` as the actor; `--actor` explicitly selects attribution |
| `BR_HARNESS`, `BR_MODEL`, `BR_AGENT_NAME` | colony, scent | Harness, model and bee kind recorded on `br` mutations |

### Bee configuration and lifecycle

Canonical `.hive/bees.toml` separates kind defaults from named harness formulas. Bee captures a recipe, friendly identity and related task links at submission. An awake colony applies current policy, acquires task claims, and starts an execution attempt. `colony wake` may lazily start the selected daemon; explicit repository, tracker and server targets remain independent.

Task completion determines success. Colony closes a satisfied request, reconciles external request closure, stops verified owned execution before releasing eligible claims, and retries unfinished work within configured limits. Sleeping drains the active dispatch pass, then pauses reconciliation while detached workers continue. Removal retains request and attempt history. These behaviors have real process/tracker smoke coverage; they do not establish native Scent hooks or arbitrary daemonized-descendant ownership.

Spawn beads carry the exact labels `system`, `bee` and `agent:<kind>`, a friendly assignee and `related` links. Shared's [spawn-request model](../lib/shared/src/spawn-request.ts) owns that representation. Current outcomes use native closure reasons, local checkpoints and timestamped observations; the earlier proposed `outcome:<value>` labels are not the implemented contract. A historical observation does not prove current process availability. See the [guide](../lib/colony/README.md) for commands, retries and cleanup boundaries.

## Evidence and remaining work

- `hv-3x8.2`: original versioned identity-hook and lifecycle findings. That spike source-verified Claude/Codex clear and compact without capturing them live; Pi transitions were observed through RPC.
- `hv-3x8.14`: stable Pi composition verified with two handlers over three independent runs; final explicit-attribution decision for native Claude/Codex subagents. That probe did not establish end-to-end child tracker attribution.
- `hv-3x8.1` and `hv-3x8.3`: database discovery and detached-launch findings. Current repository tracker setup is documented in [Beads integration](./beads-integration.md); older spike recommendations are historical evidence, not current configuration instructions.

The [Scent guide](../lib/scent/README.md) covers installation for all three harnesses. The capability contract records [Codex conformance](./harness-capabilities.md#codex-scent-evidence) and the [exercised Claude paths and remaining verification](./harness-capabilities.md#claude-scent-evidence) under `hv-3x8.7.1`. Parent tracking remains outstanding. Colony recovery and process ownership are implemented and tested separately; their limitations are documented in the guide. Expanding scope requires updating this reference and the capability matrix with the reason and evidence; it does not silently turn an unverified path into a supported one.
