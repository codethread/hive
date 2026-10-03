# Harness capability contract

Use this reference to evaluate a harness against Hive's identity and bee-launch requirements without redesigning shared behavior for each vendor. The [MVP scope](./agent-identity-scope.md) determines which behaviors are required. This is an adapter and conformance reference, not an implemented wire protocol or runtime capability detector.

## How to record support

A profile identifies a harness version, executable/runtime, platform and entry surface. CLI, RPC, desktop app and daemon-client wrappers are separate surfaces when their behavior differs. Record the runtime that executes the work, not just the version printed by its launcher.

Keep three facts separate:

| Dimension | Values | Meaning |
| --- | --- | --- |
| Capability | Available, unavailable, not applicable, unknown | Whether that exact profile exposes the mechanism; state a reason for unavailable or unknown |
| Evidence | **O** observed; **S** source-verified; **D** documented; **U** unverified | What supports the claim, with version/date and a durable receipt or source reference |
| Hive conformance | Planned, passing, failing, excluded | Whether the adapter has passed the relevant shared cases; a working upstream hook does not mean Hive integration passes |

Native identity requires `I1`, `I4`, `B1` and either `I2` or `I3`; environment injection is optional when explicit actor guidance is available. Lifecycle support applies `T1`–`T3` to the operations the harness exposes. An absent operation is not applicable, while an exposed but unverified operation remains outside that profile's support claim. Native-child support adds `I5` and a child-specific attribution route. Colony support requires `B1` and `L1`–`L5`. A harness may support native identity while colony support remains incomplete. Best-effort metadata never gates identity support.

## Reusable acceptance cases

These IDs are stable names for the shared assertions future adapters must satisfy. They are not existing executable tests. Adapter tests supply event fixtures, launch arguments and evidence; shared identity and lifecycle expectations stay the same.

| ID | Required for | Observable acceptance case |
| --- | --- | --- |
| `I1` Session identity | Native identity | Resolve the actual session key on startup; repeated callbacks produce the same identity. Check the target key rather than relying only on an event reason |
| `I2` Environment attribution | Profiles choosing this route | The owned identity exports reach the relevant tool shell, and a tracker mutation records that actor. Omitted optional metadata does not retain stale values |
| `I3` Explicit attribution | Profiles choosing this route | Context supplies the current identity and explicit actor guidance. A tracker mutation records that actor even with another actor in the inherited environment |
| `I4` Context continuity | Native identity | Identity is available on successive agent runs and within tool loops, preserves other contributions and does not accumulate duplicate blocks |
| `I5` Native child identity | Native-subagent support | Distinct children have distinct native keys and actors. Child context reaches the child; parent and sibling attribution remain unchanged, including children launched with inherited history |
| `I6` Metadata | Optional | Record only model, effort and kind values actually known; verify refresh if the adapter claims to track runtime changes |
| `T1` Clear/new | Native lifecycle | The new session key replaces the old binding; old owned identity state does not leak. A supplied bee identity is preserved while its session binding changes |
| `T2` Resume | Native lifecycle | Select another saved session and recover its identity. Verify CLI and in-process entry points separately when both are claimed |
| `T3` Compact | Native lifecycle | Identity survives compaction with the same session key and is present on the next agent run; a session-start callback is not assumed |
| `B1` Beads endpoint | Tracker-using profiles | From a tool shell in a code worktree, reach the selected repository database and record the expected actor. Code cwd and tracker selection remain independent |
| `L1` Launch inputs | Colony | The harness receives task, kind/policy context and requested supported model/effort through its native argument/configuration API |
| `L2` Launcher environment | Colony | Launcher identity and selected tracker environment reach a real tool subprocess; installed hooks preserve that identity |
| `L3` Detached lifetime | Colony | The bee survives launcher exit; its handle remains usable for liveness and adoption. Distinguish native process ownership from daemon-client ownership |
| `L4` Outcome/logs | Colony | Distinguish successful completion, invocation/provider failure, tool refusal and termination using that output mode's actual evidence; retain readable diagnostics |
| `L5` Reap/recovery | Colony | Stop the owned bee and its work, verify remaining descendants, and demonstrate adoption/replacement after colony restart without affecting unrelated processes |

Use focused adapter fixtures for event mapping and one set of reusable assertions for the behavior above. Retain a small number of real harness/tool-shell probes where schema tests cannot establish delivery, process lifetime or attribution. Store sanitized payloads and expected outcomes with the adapter's tests when it is implemented. User-fork and cache-migration tests are excluded by MVP scope; a harness using a fork internally for `I5` still exercises `I5`.

## Versioned evidence baseline

Findings below were recorded on 2026-10-02/03. Launch probes ran on macOS arm64. A version in one evidence group does not establish another version's behavior.

| Evidence | Exact profile | Durable record |
| --- | --- | --- |
| `H` Identity/hooks | Claude Code **2.1.287**; Codex CLI **0.160.0** with matching `rust-v0.160.0` source; native Pi **1.0.0**, primarily RPC for transitions | `hv-3x8.2` capability matrix, captured samples and source citations |
| `P` Pi composition | Installed native Pi **1.0.0** extension runner; two probe handlers, three runs, 29 assertions | `hv-3x8.14` and the clarification on `hv-3x8.2`; focused runner probe, not a new full CLI test |
| `L` Launch/processes | Claude Code **2.1.288**; Codex CLI **0.160.0**; native Pi **1.0.0** | `hv-3x8.3` launch recipes and 29 final probe reports |
| `W` Wrapper distinction | Installed Pies client dispatching to a daemon using Pi SDK **0.99.1**, despite a launcher version reporting native Pi 1.0.0 | `hv-3x8.3` isolated-daemon findings; not interchangeable with native Pi |
| `B` Tracker | br **0.7.4**, matching source commit `3956ebb` | `hv-3x8.1` discovery findings; `hv-3x8.14` explicit actor precedence; current [repository setup](./beads-integration.md) |

Bead notes contain durable findings and sanitized samples; temporary probe directories are supplemental. Read a record with `br show <id> --json` against the selected tracker. Source verification and observations stay labelled separately even when they support the same design.

### Identity mechanisms

These cells describe upstream mechanisms, not completed Hive conformance.

| Capability | Claude Code (`H`) | Codex (`H`) | Native Pi (`H`, `P`) |
| --- | --- | --- | --- |
| `I1` Session identity | **O** SessionStart provides session ID and lifecycle source | **O** SessionStart provides root session ID; start dispatch waits for an agent turn | **O** Current ID comes from extension context; event supplies a reason. RPC transitions can emit duplicate starts |
| `I2` Environment route | **O** SessionStart environment-file exports reach primary and native-subagent Bash. Session-wide scope, not isolated child state | Unavailable **S**: hook output has no environment channel. Launcher inheritance is separately available under `L2` | **O** Extension process-environment changes reach model Bash, RPC Bash and child processes |
| `I3` Explicit route | **D** SubagentStart can inject child context; **S/B** explicit actor overrides inherited actor. Complete child mutation path **U** | **O** Hook context reaches a developer message; **S/B** explicit actor precedence. Complete child mutation path **U** | Available as ordinary tool arguments, but MVP uses environment attribution; a dedicated explicit-route probe is **U** |
| `I4` Context | **O** SessionStart additional context is delivered; **S** reminder attachment, not a true system role | **O** Additional context is delivered as a developer message | **O/P** Each handler sees the composed prompt; repeating the append on each run is stable and preserves other handlers |
| `I5` Native child key/event | **O** SubagentStart gives separate `agent_id` and parent `session_id`; parent and child share environment exports | **O** SubagentStart gives separate `agent_id` and root `session_id`; **S** fresh and history-forked collaboration children use that event; internal/synthetic children skip it | Not applicable to core Pi: separate child processes get their own startup/ID **O**. Third-party subagent extensions require their own profile |
| `I6` Startup metadata | **O** Model absent in tested startup/resume/fork payloads; effort unavailable there | **O** Resolved model present; no effort field | **O** Model/thinking available through context; thinking-change refresh observed |

Claude subagent context delivery is documented in the [SubagentStart reference](https://code.claude.com/docs/en/hooks#subagentstart). The original pinned-version spike observed child keys and shared environment; it did not demonstrate the complete explicit child-attribution integration. Native Codex cannot dynamically bind identity environment through hook output; separately launched nested children can therefore have incomplete parent linkage. The accepted scope does not add PID-ancestry inference to hide that limitation.

### Lifecycle signals

| Capability | Claude Code (`H`) | Codex (`H`) | Native Pi (`H`) |
| --- | --- | --- | --- |
| `T1` Clear/new | **S** New ID, SessionEnd clear then SessionStart clear; live transition **U** | **S** New ID and queued SessionStart clear; live transition **U** | **O** RPC new session: new ID, shutdown/start with new reason |
| `T2` Resume | **O** CLI retains the target ID and reports resume; interactive switching **U** | **O** CLI retains the target ID and reports resume; interactive switching **U** | **O** RPC switching selects the saved ID and reports resume; initial process startup may report startup |
| `T3` Compact | **S** Same ID, SessionStart compact; live transition **U** | **S** Same ID, queued SessionStart compact; live transition **U** | **O** Same ID, compact event, no session_start; the per-run prompt contribution is reapplied |
| User forks, excluded | **O** CLI fork creates new ID and reports fork; interactive entry **U** | **O** CLI fork creates new ID and reports fork; interactive entry **U** | **O** RPC fork creates new ID; CLI fork exists **S**, that entry path **U** |

Signals establish when an adapter can act. They do not establish stale-state cleanup or resumed actor correctness: those require the `T1`–`T3` assertions. Each interactive/CLI/app entry point retains its own evidence status.

### Colony launch mechanisms

| Capability | Claude Code (`L`) | Codex (`L`) | Native Pi (`L`) |
| --- | --- | --- | --- |
| `L1` Launch inputs | **O** Print mode and appended system instructions deliver kind/policy context | **O** Exec mode and developer-instructions configuration deliver context; the configuration field replaces an existing value | **O** Print mode and repeatable appended-system-prompt arguments deliver context |
| `L2` Launcher environment | **O** Identity metadata reaches a real tool shell | **O** Identity metadata reaches a real tool shell with configured inheritance | **O** Identity metadata reaches a real tool shell |
| `L3` Detached lifetime | **O** Survives launcher exit | **O** Survives launcher exit | **O** Native process survives launcher exit |
| `L4` Outcomes | **O** Invocation/provider errors and signal outcomes captured; tool refusal can still finish successfully | **O** Invocation/provider errors and signal outcomes captured; tool refusal differs from process failure | **O** Provider error exits 1 in text mode but can exit 0 with an error event in JSON mode; exit code alone is insufficient |
| `L5` Reap/recovery | **O** TERM cleaned the tested tool; KILL left it alive. Full recovery **U** | **O** TERM and KILL left tested tools alive. Full recovery **U** | **O** TERM cleaned the tested tool; KILL left it alive. Full recovery **U** |

All three launched tool work in separate process groups. Recorded-descendant cleanup succeeded for the probe trees; that is not proof of race-free ownership of arbitrary daemonized descendants. Colony's ownership/adoption policy remains design work. Pies (`W`) is a separate client/daemon profile: work belongs to the daemon, so client PID cleanup is not the native recipe. Its per-request cancellation and settlement need their own adapter contract.

The launch probes used isolation flags and did not load production scent. They ran tool-shell `br --version`, not actual bead mutations. Combined hooks, correct actor/endpoint (`B1`) and full colony lifecycle conformance remain pending. Tool capability restrictions and model refusal are not evidence of OS sandbox enforcement; a profile must not claim that guarantee from these probes.

### Hive implementation status

| Profile | Native identity | Native child attribution | Colony integration |
| --- | --- | --- | --- |
| Claude Code | Planned: `hv-3x8.7.1` | Planned explicit route, same bead | Planned: `hv-3x8.9.2`; `L5` design unresolved |
| Codex | Planned: `hv-3x8.7.3` | Planned explicit route, same bead | Planned: `hv-3x8.9.2`; `L5` design unresolved |
| Native Pi | Planned: `hv-3x8.7.2` | Separate-process identity path; third-party native-like tools unverified | Planned: `hv-3x8.9.2`; `L5` design unresolved |
| Pies / other wrappers | No dedicated Hive conformance | Unknown for wrapper-owned work | No selected wrapper integration; `W` is evidence, not approval |
| Other GUI or hosted runtimes | Unknown until profiled | Unknown until profiled | Unknown until profiled |

## Adding or upgrading a harness

1. Add its exact version, runtime, platform and entry surface to the profile table. Select the intended integration scope: native identity, native children, colony, or a combination.
2. Fill each applicable capability with a mechanism or a concrete limitation and evidence status. Use unknown for missing evidence; use not applicable only where the concept does not exist. Unsupported optional capabilities reduce that profile's advertised scope; missing required capabilities prevent claiming that scope.
3. Implement event/argument/output mapping in the adapter. Reuse the shared identity rules, explicit-attribution guidance and acceptance IDs. Add recorded fixtures for its wire shapes and focused live receipts for delivery/process claims.
4. Run the same applicable conformance cases. A skipped case retains its reason and unverified/excluded status; it does not become a pass. Populate passing cells with test/receipt links as implementations land.
5. On upgrade, rerun the affected adapter cases and shared regression checks. Keep previous version evidence; do not generalize a pass to another launch surface or silently change shared semantics to accommodate a vendor.

Change the shared contract only when a new required behavior cannot be expressed by an existing case. Record that decision once, then reassess only the affected profiles and cases. Adding a harness that fits the contract should add an adapter, profile and fixtures without changing existing harness policies or duplicating their test logic.
