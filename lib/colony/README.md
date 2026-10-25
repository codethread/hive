# Bee and Colony

Bee opens configured agent roles with `bee run` or delegates them with `bee spawn`. Busy Bee supplies the task workflow; Colony schedules and supervises execution. Requests capture a recipe and friendly identity; run/stage beads hold the work. Canonical `.hive/bees.toml` supplies current harness formulas and runtime policy.

## Install and try it

Follow [CLI artifacts](../tooling/README.md#cli-artifacts) for building and installing the companion executables. Runtime requirements are Git, `br`, `honeycomb`, `busybee`, and a native harness with working model access. Default ranking also requires `bv`; [FIFO](#scheduling) does not. Installation supplies no service.

Deploy version-matched Busy Bee, Bee, Colony and Hive UI/Shared consumers together only after approval. Format-1 workflow anchors cannot be resumed by format-2 tools; follow [Busy Bee adoption](../busybee/README.md#breaking-adoption) before upgrading active work. Installing a binary does not authorize daemon restart, migration or retirement.

Read `colony init --help` to create canonical configuration for Codex, Claude or both, preserving an existing `.hive/bees.toml`. Use `colony config schema` for the complete configuration fields and defaults. Prepare the selected workflow in the execution checkout through [Busy Bee](../busybee/README.md#prepare-a-checkout). Use `bee setup --help` to install the [attention preset](../../docs/agents/spawn-requests.md#saved-presets) in the selected database. [Beeswax](../beeswax/README.md#bv-viewer-recipes) manages Hive's BV views independently.

Read `bee --help` for submission and result discovery, then `colony wake --help` to enable execution. For experiments, select a disposable repository, initialized tracker and private Colony state explicitly. Before deleting them, cancel the request while awake and inspect until execution has stopped and settlement completed. Sleep and daemon stop leave detached workers alive. The [native probe](#verification) automates isolated setup and bounded cleanup.

## Bundled agent guidance

`bee skills --help` and `colony skills --help` discover version-matched instructions and supporting resources offline, without configuration, tracker, daemon or source checkout. Load metadata first and content on demand; the application repository's policy remains authoritative.

Use `bee system --help` for Busy Bee's dispatch protocol.

## Discover bee kinds

Use `bee kinds --help` for selection and expanded configuration. Visibility guides discovery, not execution authority. Caller `allow` and `deny` lists are mutually exclusive: `allow` selects exactly its named kinds, including hidden ones; `deny` subtracts from the non-hidden baseline. Empty `allow` selects none; empty `deny` changes nothing. `"#self"` refers to the caller kind. Unknown selectors fail.

## Talk to a bee

Users open direct conversations with `bee run KIND`; agents delegate through `bee spawn`. The interactive harness inherits the terminal's directory and environment. Bee supplies a fresh identity and removes Colony attempt credentials while preserving the inherited tracker. See [formulas](#harness-formulas) for interactive versus managed arguments.

## Create requests

Use `bee spawn --help` to select a task-appropriate workflow, supply its input and choose execution settings. It also covers partial-submission recovery. Submission creates `original work -> workflow run -> stages`; the original parent's claim and completion remain separate. Drivers coordinate runs; dispatched workers execute stages. [Busy Bee](../busybee/README.md#delegate-a-workflow-to-bee) owns progression and group/run closure.

Bee adds [delivery guidance](../../docs/agents/responses.md#runtime-guidance) at launch. Captured recipes retain the original role; receipts retain the actual invocation. The [spawn contract](../../docs/agents/spawn-requests.md#facts-and-authority) owns host binding and native lifecycle authority.

## Kind files

Run `colony skills file operations references/configuration.md` for required fields, canonical and folder definitions, prompt placement and precedence. This guide ships with Colony and works outside the Hive checkout.

## Retry an unsuccessful request

Use `bee retry --help` for failed-request recovery or deliberate cancellation resumption, including eligibility and process verification. Replacement retains the workflow assignment; the [spawn contract](../../docs/agents/spawn-requests.md#transitions-and-resolution) defines retained history and replacement provenance. [Workflow recovery](../busybee/README.md#resume-and-failures) covers incompatible or abandoned runs. `bee result --help` explains exact-request answer selection.

## Acknowledge a failure

Use `bee ack --help` when failed work needs no further action. The [acknowledgment contract](../../docs/agents/spawn-requests.md#acknowledge-an-accepted-failure) owns persisted authority and recovery.

## Report completion from a bee

Managed workers follow `bee finish --help`. The [self-report contract](../../docs/agents/spawn-requests.md#report-your-own-execution-finished) owns submission, settlement and injected provenance.

## Inspect or close requests

Discover requests through [native Beads queries](../../docs/agents/spawn-requests.md#find-requests-with-native-beads). `bee status`, `bee result` and `bee stop` use exact request IDs and the selected database; read their focused help. `bee response --help` covers authored delivery and historical evidence.

Stdout activity is historical evidence, not a liveness verdict. `lastOutputAt` records the last modification of a nonempty attempt stdout log; `recordedAt` records publication. Empty log creation, stderr and polling do not count. A new attempt starts with unknown activity. Leave active logs unmodified.

For publication timing and final-flush behavior, see [reconciliation cadence](#reconciliation-cadence). Sleep/outage delays publication while detached workers keep writing; source write time survives that delay.

## Run a colony

Use `colony --help` for membership and daemon commands, then focused help for repository/tracker/state/socket selection. `wake` registers the canonical repository and reloads its policy. `add` creates asleep membership and preserves existing activity. Both lazily start an unavailable daemon through native supervision. Durable awake membership resumes after daemon restart; asleep membership stays asleep.

`sleep` drains the selected repository's current scheduling pass, then stops its polling, dispatch and reconciliation. `remove` also drops that repository's membership while retaining execution history and tracker authority. Other repositories on the daemon remain active. Re-add/wake can reconcile work that outlived registration.

`daemon stop` stops the selected server and pauses all its colonies. Detached workers survive sleep, removal and daemon stop; use repository sleep to pause one colony while keeping the others awake.

For native startup prerequisites, an installed runtime update, or resuming an interrupted restart, follow `colony daemon restart --help`. Its default retry finishes a recorded replacement in place; `--replace-retained` explicitly selects one additional replacement within the same unfinished restart. The help owns admission, retained phases, retry limitations and the result contract; retain the selected state/socket throughout.

Native service registration carries the caller's explicit `PATH`, `CODEX_HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME` and `XDG_STATE_HOME` values into launchd or systemd. These select tool and configuration locations, including where a harness reads its existing authentication. Registration copies neither credential files nor arbitrary session/attempt environment. After changing these paths, deliberately restart the selected daemon from an environment containing the intended values; an already-running daemon keeps its previous environment.

`wake --temp` creates membership that lasts until sleep, removal or daemon exit, including with an empty queue. It is not restored. Ordinary wake/add promotes it to durable; temporary wake refuses an existing durable entry.

Repositories normally share the default daemon. One daemon owns each state directory, even across socket choices. Choosing another `--state` directory selects separate membership and retained runtime history; keep that selection for subsequent commands. An explicit socket requires explicit state. After a crash, wake may recover a recorded stale socket; unknown sockets/files are preserved and reported. Status/stop contact the selected daemon without starting it. Lazy startup and restart register a native service for the selected state; foreground `daemon serve` remains available for an explicitly managed process.

Recovery adopts verified surviving executions without duplication. Dead executions follow ordinary settlement/retry rules. Cancelling while asleep leaves workers and claims until wake; awake cancellation stops owned execution before releasing unfinished claims. Missing or ambiguous process authority fails visibly.

## Health notifications

The independent watchdog reads public daemon status every 30 seconds. It alerts through `cc-notify` on colony failure or daemon unreachability lasting at least 60 seconds; polling/delivery can add delay. Asleep colonies are normal. It never starts, wakes or repairs Colony.

Failure alerts share a 30-minute cooldown per state/socket target. Each repository/tracker incident or sustained outage alerts once, even if diagnostics change. An alerted recovery notifies immediately and starts a fresh cooldown. Explicit awake/asleep observation clears a colony failure; missing registration does not. Daemon recovery is separate from colony recovery. Initial health and incidents resolved before alert delivery remain silent.

Build/install first, then use one retained Hive checkout for the [`mise.toml`](../../mise.toml) watcher. Mise, Pitchfork and `cc-notify` with its notification service must be available in that environment, including at login. Read `mise daemons --help` for start/status/logs/stop and registration; read `pitchfork boot --help` for user-level login activation. Boot activation is shared with other registered `boot_start` daemons.

Stopping the watcher does not disable its next boot start. To disable it, override `boot_start = false` under `[daemons.colony-watchdog]` in `mise.local.toml`, register the changed configuration and stop the watcher. Disable the old checkout's registration before moving activation to another retained checkout. Planned daemon shutdown looks like an outage, so stop monitoring first.

`colony-watchdog --help` covers explicit server selection. Watcher delivery failures, malformed status and checkpoint failures surface in logs; the configured supervisor retries. Delivery precedes atomic bookkeeping under `<state>/watchdog/`; a crash between notification and save can repeat it. Preserve that state for deduplication. Login startup, supervisor recovery and real notification delivery require verification on the installation host.

## Inspect runtime and retained history

`colony inspect --help` selects a running daemon without starting it. Results contain membership or `null`, last-reconciled request checkpoints, attempts, policy revisions and local artifact paths. Checkpoints can lag native tracker facts while asleep; use `bee status` for those facts. `observedAt` is inspection time, not reconciliation time.

Attempt paths locate private invocation receipts, stdout, stderr and supervisor logs; files may not yet exist during startup. Generic inspection omits prompts, invocation arguments and tokens. Removal retains history, inspectable with the same repository/tracker selection; inspection changes neither membership nor execution.

## Workflow execution clearance

Busy Bee's [bounded settlement](../busybee/SPEC.md#bounded-unsuccessful-settlement) uses `colony system execution-clearance` when managed execution could exist. Read its `--help` for exact inventory, endpoint and ownership requirements; `colony system execution-clearance-schema --json` supplies offline schemas. The running owning-host daemon must retain the relevant history and have the repository/database registered. Clearance neither starts the daemon nor stops workers; a successful read can still report `refused` with blockers. The system record's lock and settlement intent fence admission. Every settlement retry needs fresh clearance, including reclosure after previously completed settlement; a retained clearance is not a lease.

## Inspect operation and failure evidence

`colony events --help` covers local operation history and filters. It reads existing state without contacting Beads/daemon, reconciling or creating/upgrading the database. Repository discovery still uses Honeycomb; SQLite may update reader coordination files, not records or WAL contents.

Events cover daemon preparation, claims, launch handoff, reconciliation/settlement and dispatch failures. They record boundary targets, checkpoint projections, confirmed effects, structured errors and artifact paths. `--failures` includes handled claim conflicts but excludes interrupted operations with no recorded error. Omit it to inspect unfinished work. Boundary success does not imply task success.

Sequence orders operation starts; nested completions may reorder and gaps are normal. No-change successful polls are discarded. Retention keeps the newest 1,000 finished and 100 unfinished operations across the selected state directory. This bounds rows, not artifact storage or database bytes; history is diagnostic, not a complete audit log.

External effects and history/checkpoint writes are separate commits. A crash before recording an effect leaves it unknown. `unfinished` means no final result was recorded, not that work is still running. Only `completedEffects` are confirmed; `after` is the last saved projection. History failures propagate without replaying effects; cleanup failures retain the prior failure too. Receipts, tracker facts and logs remain source evidence.

History excludes recipes, prompts, checkpoint free text, raw output, environment and tokens. Structured native messages are bounded and credential-redacted; unstructured failures point to source evidence. Manual launches, Bee controls and administrative policy changes are outside capture scope. [`history.ts`](src/history.ts) owns the record shape and redaction rules.

## Output for people and scripts

Human output uses stdout for results and stderr for diagnostics. Each finite `--json` command emits one result with `ok` and `kind`; errors add `reason` and `message`. Exit codes are 0 for success, 1 for operational failure and 2 for usage errors. Branch on structured fields, not message text; use focused command help for schemas and expansions.

Foreground `daemon serve --json` emits its result when the server exits. Check readiness through a separate `daemon status` call. Request closure receipts do not establish process termination; [explain](#explain-request-progress) supplies live evidence.

## Manual launch

`colony launch --help` runs one eligible captured request without daemon scheduling, waits for the child and retains its actual invocation and separate output logs. Process success does not establish task completion. The [spawn contract](../../docs/agents/spawn-requests.md#facts-and-authority) still governs host and request authority; linked work must be ready and available to the captured identity.

The captured execution directory defaults to the canonical worktree. Selecting another directory changes execution only; configuration and tracker authority remain tied to the selected repository.

## Harness formulas

Run `colony skills file operations references/configuration.md` for matching formulas, token rendering and role/execution delivery in interactive and managed invocations.

### Native formula examples

Hive's [configured formulas](../../.hive/bees.toml) show Codex and Pi role delivery; [`native-smoke.ts`](scripts/native-smoke.ts) supplies isolated execution profiles. [Harness capabilities](../../docs/harness-capabilities.md) records dated evidence and limits. Codex's JSON-quoted `developer_instructions` replaces that configuration field; Pi's `--append-system-prompt` appends role text. These mechanisms do not promise identical precedence. The Pi probe deliberately isolates context/extensions and limits tools; it is not a general production context profile. Use a native executable, supported model syntax and your own authenticated account.

## Scheduling

Unfinished assigned work must be ready and available to the request identity. Colony reads the request's own [workflow anchor](../../docs/agents/spawn-requests.md#workflow-anchors) through Shared's definition-free system/native join. Confirmed success with matching native closure permits completion without launch; confirmed failure/cancellation retains that disposition. Requested intent, reopened/stale projections and unsupported formats fail visibly rather than becoming success or launchable work. Neither labels, close-reason prose nor a done chart supplies completion authority. Requests use their highest task urgency, P0 before P1.

Within a priority tier, default `bv-pagerank` uses the best linked task's score from the complete visible graph, including closed/ephemeral tasks and unflushed edits. The [BV boundary](../../docs/integrations.md#bee-and-colony-runtime) owns database authority and completeness. Its native multi-query read is not atomic across concurrent commits. `ranking = "fifo"` orders ties by creation time, then ID, without BV.

BV runs only when individually feasible same-priority requests cannot all fit remaining colony, kind and launch-location capacity. Higher priorities reserve first; a later ranking failure does not undo earlier launches. The location bucket is the containing Git worktree or canonicalized external execution directory; later process directory changes do not move it.

`colony list` shows active limits; `[limits.kinds]` overrides individual kinds. Zero prevents launches. Lowering limits leaves existing workers running and delays new work until occupancy fits every limit, including workers retained across sleep/removal. Waiting workflow drivers consume ordinary capacity.

### Reconciliation cadence

Each awake colony runs a full fresh native reconciliation pass immediately after watcher setup on wake or recovery. After a completed pass, unchanged stable-running or empty state uses a fixed 60-second quiet delay. Known starting, claiming, waiting, retrying, settling or changed state uses five seconds.

Hints from the selected Beads database/WAL and current local attempt publications (`finish.json`, `worker.json`, `ownership.json`) shorten the idle deadline to five seconds after the previous pass completed, or immediately if that time has elapsed. Hints during a pass request a paced follow-up; repeated hints never postpone the deadline or overlap passes. Watch setup, runtime or unexpected-close failures emit a diagnostic, dispose watches and restore five-second polling until wake or actor replacement. Native reconciliation failures still fail visibly. Hints choose when to read; fresh native facts and existing ownership, claim and settlement checks remain authoritative.

**60 seconds bounds only the quiet post-pass scheduling delay, not end-to-end cancellation or completion.** Missed hints, JSONL-only changes and unobserved worker exits can wait for that fallback plus in-flight, native and process work. JSONL has no fast watch; ingestion still depends on the selected tracker's native configuration. This change does not enable auto-import.

Stdout/stderr do not trigger scans. First stdout activity is published when observed; later changes retain a 30-second minimum publication spacing, not a freshness guarantee. A throttled change can wait the remaining throttle interval plus another quiet interval of up to 60 seconds and processing time. Settlement still flushes the final observation once it runs.

## Completion and retries

Colony acquires claims immediately before launch using the captured friendly identity. A reservation conflict waits; a conflict after partial acquisition stops that request and releases only its own acquired claims. [Finish reporting](../../docs/agents/spawn-requests.md#report-your-own-execution-finished) distinguishes success, unfinished work and blocked handoff.

`max_retries` counts retries after the first attempt. `retry_delay_ms` sets the minimum delay; an awake polling pass dispatches when eligible. Sleep pauses progression. Automatic attempts retain identity and get new attempt IDs; explicit retry creates a new identity.

Before replacement or terminal cleanup, Colony proves the old execution stopped. It follows native child links beneath recorded claims and clears unfinished assignments still held by that identity. Closed tasks, human/HITL reservations, blocked states and other identities remain intact, including independent workflow workers. Related work outside that hierarchy is untouched. Revision checks expose concurrent changes; settlement replay can continue partial releases. Exhaustion preserves logs and receipts with its failure reason.

Managed execution covers the supervisor's process group. The harness inherits that group; processes that detach or create separate groups are outside managed cleanup. Colony verifies the ownership token and supervisor PID/start time before observation or signalling; sampled checks are not race-free OS handles. Cancellation sends TERM, allows one second for exit, then sends KILL if needed and waits up to five seconds for confirmation. Cleanup refuses ambiguous ownership and fails visibly if the group remains. Child exit publishes ownership state without recurring process-table scans or descendant-history rewrites. Process titles are diagnostic only. Retained records pin tracker authority, and changed native identity/task links fail visibly.

## Live configuration

Read `colony config --help` for show/update/history/reset and `colony config update --help` for strict JSON payloads and examples. For diagnosis, authorization and activation/reset behavior, run `colony skills file operations references/recovery.md`.

Invalid changes preserve policy. Each accepted revision is immutable and attempts record the revision used. Generic inspection omits executable arguments; full snapshots and receipts remain private.

Canonical loads record their source without inventing an author. Configuration commands do not start a daemon.

## Verification

Repository test commands and gates are indexed in [repository commands](../../docs/repository-commands.md#test-selection). Current smoke tests under [`src/`](src/) exercise real filesystem, tracker, socket and process boundaries. Scripted workers make failure cases reproducible; they do not prove authenticated provider launches. Removed timing-heavy checks and restoration pointers remain in the [Colony coverage record](../../docs/test-cases/colony.md).

For a real authenticated native harness, read `bun run lib/colony/scripts/native-smoke.ts --help`. The opt-in probe requires Bun, Git, br, Honeycomb and an absolute native executable. It creates a private new output directory, isolated repository/tracker/daemon and a bounded native run, retaining evidence on success or failure. Cleanup cancels and reconciles owned work before stopping the private daemon. It supplies no account access, Scent setup or service installation.

## Explain request progress

`colony explain` combines native request/task/dependency and readiness facts with daemon evidence and fresh verified process ownership. Use `colony explain --help` for selection options. Bee status remains tracker-only.

Runtime evidence contains the selected request's checkpoint and complete retained attempt history, plus colony membership and policy without a second attempts collection. Capacity contains one kind/bucket pair per retained starting/running attempt whose request checkpoint is bound to the daemon's host; duplicate pairs count separately. Diagnostic payload size grows with selected attempts and local-host reservations. Capacity selection scans current starting/running attempts; unrelated terminal history and policy revisions are not loaded.

Evidence groups retain source, read time, freshness and availability. Reads are not one atomic snapshot. Checkpoint age is unknown because reconciliation time is not stored; attempt creation is not a state-update timestamp. Native-closure/live-process and checkpoint/process disagreements stay explicit. Unavailable sources, asleep or failed colonies, and uncertain process ownership yield partial evidence. `ok: true` means a report was produced, not that the request is healthy or every source was available.

An eligible request with capacity is only runnable at the sampled times; ranking, claims and preparation must still succeed. Capacity counts retained reservations even when process evidence disagrees. Verified live execution may be a supervisor awaiting launch and does not prove useful work. Stopped execution does not prove completion.

Explain does not mutate lifecycle state, read worker logs or emit receipt prompts/tokens. It neither starts the daemon nor falls back to an offline database or full inspection. Socket timeout and supervisor-handoff observation can delay results. Samples predict neither queue position nor future scheduling order.
