# Bee and Colony

Bee opens configured agent roles directly with `bee run`, or submits workflow assignments with `bee spawn` for Colony to manage. A spawn request is distinct from the durable Busy Bee run and stage beads it executes. Each request carries a captured recipe and a friendly assignee; Colony applies the current named harness formula in the canonical worktree's `.hive/bees.toml`.

## Install and try it

Requirements: Bun for building, Git, `br`, `honeycomb`, `busybee`, and a native harness executable with working model access. Default ranking also needs `bv`; set `ranking = "fifo"` in `.hive/bees.toml` to run without BV. `colony init` writes a Codex formula, so its default quickstart needs native Codex on `PATH`. Other harnesses need a formula using their supported flags. See [harness evidence](../../docs/harness-capabilities.md) for verified versions and limits.

From a Hive checkout:

```sh
bun install
bun run --filter @hive/colony build
bun run --filter @hive/colony install:bin
bun run --filter @hive/busybee build
bun run --filter @hive/busybee install:bin
bee --help
colony --help
```

The build writes standalone `bee`, `colony`, `colony-runtime`, `colony-worker` and `colony-watchdog` executables under `lib/colony/dist`. The installer copies all five to `~/.local/bin`; put that directory on `PATH`. Keep the companions together: Colony launches its daemon and supervisors from that directory, and assessment prompts use the matching Bee and Colony. Use `install:bin --directory /path/to/bin` for a separate destination. Building alone leaves installed commands untouched. This installs commands only; it does not install or start a service.

Start with a disposable Git repository that already has an initialized Beads tracker. Select that repository and database explicitly; do not use your working task tracker for an experiment. Choose a model available to your native Codex account:

```sh
REPO=/path/to/disposable-repository
DB="$REPO/.beads/beads.db"
STATE="$REPO/.colony-smoke-state"

colony init --repo "$REPO" --owner operator --model YOUR_MODEL
bee kinds --repo "$REPO"
bun add --cwd "$REPO" xstate@5 zod@4
busybee --repo "$REPO" init
# Create the original work and retain its native ID as WORK_ID.
br create --title "Write smoke result" --owner operator --actor operator --db "$DB" --json
WORK_ID=YOUR_WORK_ID
cat > "$REPO/work.json" <<'JSON'
{"title":"Write smoke result","request":"Write a short smoke-result.txt","acceptance":["The file exists and explains what ran"]}
JSON
bee spawn worker --parent "$WORK_ID" --input-file "$REPO/work.json" --repo "$REPO" --beads-db "$DB" --actor operator --json
# Copy the returned request.id into SPAWN_ID.
SPAWN_ID=YOUR_SPAWN_ID
colony wake --repo "$REPO" --beads-db "$DB" --state "$STATE"
colony inspect --repo "$REPO" --beads-db "$DB" --state "$STATE"
bee status "$SPAWN_ID" --repo "$REPO" --beads-db "$DB"
bee stop "$SPAWN_ID" --repo "$REPO" --beads-db "$DB" --actor operator
# While awake, Colony reconciles closure and stops any owned execution.
colony inspect --repo "$REPO" --beads-db "$DB" --state "$STATE"
colony sleep --repo "$REPO" --beads-db "$DB" --state "$STATE"
colony daemon stop --state "$STATE"
```

Before sleeping or deleting disposable state, inspect until the request checkpoint has settled and its attempts have stopped. Sleep and daemon stop leave detached workers alive; closing the request while awake is the cancellation path. A task may finish before `bee stop`; stopping an already-closed request preserves its closure reason. The automated native probe below performs bounded cleanup and retains evidence.

## Bundled agent guidance

Each executable includes version-matched guidance, available offline even outside a repository:

```sh
bee skills --help
colony skills --help
```

Discover metadata first, then load instructions and supporting files on demand. Command help covers reads and JSON output. These commands require no configuration, tracker, daemon, credentials or Hive source checkout. Application repository policy and commands remain authoritative.

## Discover bee kinds

Read `bee --help` for the delegation sequence and `bee kinds --help` for discovery filters, configuration expansion and schemas. Kind descriptions explain when to choose each role; `bee list` lists requests instead.

Visibility is selection guidance, not runtime authorization. A hidden or omitted kind remains spawnable, allowing testing and flexible workflows. The caller comes from `--as`, then `BR_AGENT_NAME`; without either, discovery shows all non-hidden kinds. Unknown callers and selectors fail visibly. Kind names, rather than models, determine the policy.

Optional `allow` and `deny` lists belong to the caller kind and are mutually exclusive. `allow` shows exactly its named kinds, overriding their `hidden` setting; `deny` subtracts from the non-hidden baseline. Empty `allow` shows none, while empty `deny` preserves that baseline. The sole special selector, `"#self"`, refers to the caller kind; self-hiding is explicit.

These fragments omit the required execution fields (`harness`, `model` and `effort`); both prompt fields are optional:

```toml
[kinds.drone]
description = "Inspect activity when Colony requests an inactivity review."
hidden = true

[kinds.librarian]
description = "Advise on architecture and curate settled intent."
allow = ["honeybee", "drone"] # Explicitly includes the hidden drone.

[kinds.reviewer]
description = "Review code, tests and documentation against repository standards."
deny = ["#self"]
```

## Talk to a bee

Run `bee run KIND` from a terminal for a direct conversation; see `bee run --help` for session overrides. Agents delegate through `bee spawn`.

The harness inherits the shell's directory and environment. Bee supplies a fresh identity and removes Colony attempt credentials; an inherited tracker is untouched by the launcher. Each [harness formula](#harness-formulas) provides shared interactive arguments and optional managed/headless arguments.

## Create requests

Read `bee spawn --help` for workflow input, directory selection, overrides and recovery after partial submission. Initialize an execution checkout with `colony init` and `busybee init` as shown in the quickstart. Its workflow imports (`xstate` and `zod` for `do-work`) must be available there.

Submission creates `original work -> workflow run -> stages`. The external parent's claim and completion remain separate. The driver executes the saved run; independently dispatched workers execute individual stages. Busy Bee owns progression and group/run closure. For task completion mechanics, see [Busy Bee delegation](../busybee/README.md#delegate-a-workflow-to-bee).

| Instruction source              | Responsibility                                   |
| ------------------------------- | ------------------------------------------------ |
| Kind `system_prompt`            | Role, expertise and authority                    |
| Kind `prompt`                   | Optional execution direction                     |
| Workflow input and stage briefs | Assignment, context, deliverables and acceptance |

Bee composes [runtime delivery guidance](../../docs/agents/responses.md#runtime-guidance) at launch; captured recipes retain the original role. Attempt receipts retain the actual invocation. Private assessments and inactivity drones use separate protocols.

Requests bind to the submitting hostname; only that host's Colony executes them. The requester actor, configured human owner and generated bee identity are distinct. See the [spawn contract](../../docs/agents/spawn-requests.md#facts-and-authority) for provenance and lifecycle rules.

## Kind files

Configuration lives in the canonical worktree's `.hive/bees.toml`. Keep repository policy, formulas and any inline `[kinds.NAME]` definitions there. You can also place each kind in an immediate subfolder of `.hive/bees/`:

```text
.hive/
  bees.toml
  bees/
    code-review/
      bee.toml
      system_prompt.md  # optional reusable role/protocol
      prompt.md         # optional execution direction
```

The folder name is organizational; `name` in `bee.toml` declares the kind:

```toml
name = "reviewer"
description = "Review code changes against repository standards."
harness = "codex"
model = "gpt-6-astra"
effort = "high"
```

Every immediate kind directory requires `bee.toml`. Sibling `system_prompt.md` and `prompt.md` independently supply their fields verbatim; either may be absent or empty. Folder definitions use these files rather than inline `system_prompt` or `prompt` fields. Central `[kinds.NAME]` definitions may set either field inline or omit it. An omitted field becomes empty text. Discovery is nonrecursive and includes real directories, not directory symlinks. The central file is required, but its `kinds` table and the entire `bees/` directory may be omitted.

A central `[kinds.NAME]` definition replaces the **whole** matching folder definition, not individual fields. `bee kinds` reports these conflicts as warnings (in JSON, the `warnings` array). Duplicate folder definitions without a central winner fail. Missing `bee.toml`, malformed definitions and errors reading existing prompt files fail even when a central definition shadows them.

Spawn, retry, manual launch and Colony policy loading share this discovery path. Worktree-local configuration and root-level `bees.toml` are not read. Existing captured recipes remain unchanged when configuration or prompt files are edited.

## Retry an unsuccessful request

Read `bee retry --help` to replace failed work using current kind defaults. Retries retain the workflow run/stage; [workflow recovery](../busybee/README.md#resume-and-failures) covers incompatible or abandoned runs. `bee result --help` explains selection of the replacement's answer.

## Acknowledge a failure

Read `bee ack --help` when failed work no longer needs follow-up. The [acknowledgment contract](../../docs/agents/spawn-requests.md#acknowledge-an-accepted-failure) defines persisted authority and recovery.

## Report completion from a bee

Managed workers follow `bee finish --help`. The [self-report contract](../../docs/agents/spawn-requests.md#report-your-own-execution-finished) defines settlement and injected provenance.

## Inspect or close requests offline

Bee inspection uses the selected tracker without a daemon or kind configuration. Use `bee list` to find requests, `bee status` for recorded execution facts, and `bee result` for an authored answer. Read each command's help before acting; `bee response --help` covers publication and historical evidence.

Request closure and observations do not prove current process state. An awake Colony reconciles `bee stop`; a sleeping Colony waits for wake. The [spawn contract](../../docs/agents/spawn-requests.md) owns outcome/resolution labels, native queries and interrupted publication recovery.

`status` and `list` also show the latest recorded stdout activity for the most recently observed execution attempt. JSON exposes `stdoutActivity` with `attemptId`, `attemptNumber`, `lastOutputAt` and `recordedAt`. Before an attempt is observed, `stdoutActivity` is `null`; an attempt with no observed output has `lastOutputAt: null`. A new attempt starts with unknown activity instead of inheriting the previous attempt's timestamp.

`lastOutputAt` is the last modification time of the attempt's nonempty stdout log, formatted as UTC ISO 8601 with milliseconds and `Z`, for example `2026-10-04T10:55:31.000Z`. Empty log creation, stderr and daemon polling do not count as stdout activity. `recordedAt` uses the same format and records publication time; native Beads timestamps retain their own format. Log contents are not parsed or copied into Beads. Silence does not establish that a bee is idle, stalled or dead.

An awake Colony publishes the first actual output on reconciliation, then changed activity at most once per 30 seconds per attempt. Settlement flushes the final observation immediately. Unchanged output adds no comments. While Colony sleeps or its daemon is unavailable, workers keep writing local logs but publication waits for reconciliation after wake or recovery. The source write time survives that delay; it is never replaced by wake or publication time. These timestamps describe the owned stdout log, so leave execution logs unmodified while an attempt is active.

## Review quiet bees with a drone

In canonical `.hive/bees.toml`, set the top-level `inactivity_drone = "inspector"` and define `[kinds.inspector]` with a selection `description`, your chosen `harness`, `model` and `effort`, and its role in `system_prompt`. Its harness needs a matching formula. No model is hardcoded. Omitting `inactivity_drone` disables reviews; fresh wake/reset loads changes. `colony config show --json` exposes the active kind as `active.inactivityDrone`, or `null` when disabled. For example, merge these settings into the existing configuration:

```toml
inactivity_drone = "inspector"

[kinds.inspector]
description = "Inspect a running execution for activity when Colony requests a review."
harness = "example"
model = "YOUR_MODEL"
effort = "low"
system_prompt = "Inspect the target's logs and process evidence, including legitimate waits."
```

After **15 minutes without stdout**, an awake Colony launches one drone for an unreconciled running attempt with unfinished tasks. A never-written stdout log uses attempt creation as the quiet interval's starting point. Actual log activity, rather than the potentially delayed public timestamp, drives the trigger. The drone receives the exact target attempt, log/process-evidence directory, review ID and deadline, and runs in the target's recorded execution directory. Silence or PID existence alone does not prove inactivity or progress.

The drone uses `bee report SPAWN_ID active|inactive`. **Active** leaves the target running and postpones the next review for 15 minutes from Colony's acceptance, independently of actual stdout time. **Inactive** enters the normal attempt-failure policy: verified stop, release only its own unfinished claims, retry within `max_retries`, then failed/unresolved on exhaustion. This adds no request outcome or resolution value.

Each review gets **one launch attempt and at most five minutes of runtime**, with no automatic drone retry. Launch failure, exit without a valid verdict and timeout all apply inactive consequences, with distinct `launch_failed`, `exited_without_verdict`, `timeout` and inspected `inactive` diagnostics. The detached supervisor enforces its deadline even while Colony sleeps or the daemon is stopped; target settlement waits for awake reconciliation. A valid verdict durably submitted before the deadline can be consumed after wake. Duplicate, stale, replaced-attempt and late reports are rejected. Reviews already authorized for execution survive daemon recovery without launching another drone. Missing or ambiguous process authority remains a visible failure rather than permission to signal or release claims.

A crash before execution permission makes the interrupted preparation `launch_failed`. Colony never resumes or repeats that launch. It stops any supervisor with a verifiable handoff; a handoff published later cannot start the harness and its permission waiter expires at the existing deadline.

Drones are auxiliary inspections of existing attempts, with no task claims or independent task request; they do not consume task-dispatch capacity or enter the request scheduler. Colony keeps the kind's `system_prompt` separate from its optional `prompt` plus generated target and reporting instructions. Each target has at most one outstanding review, and drones cannot trigger recursive inactivity reviews. Completing, cancelling or blocking the target stops its pending drone through the same ownership checks. Task closure alone still leaves a live target time to finish cleanup and self-report.

`bee status` and native spawn comments retain review identity, deadline and diagnostics alongside ordinary execution observations. Review launch receipts, stdout, stderr, process ownership and `verdict.json` remain in the private state directory named by the review ID; the starting observation gives its path. See the [drone report authority contract](../../docs/agents/spawn-requests.md#report-an-inactivity-verdict) before automating verdict submission.

## Inspect finished bees

Set `post_run_drone = "post-run-drone"` in canonical `.hive/bees.toml` and define that kind using the [kind-file format](#kind-files). Omitting the setting disables new assessments. Fresh wake/reset loads configuration; an already-running daemon needs a restart to load newly installed runtime code.

When a launched request settles, Colony queues one advisory assessment across its attempts, including failed and cancelled requests. It does not backfill old terminal requests or inspect zero-launch closures. Assessments have no task claims or independent spawn beads and cannot recursively schedule themselves. The queue runs one inspector per repository with one launch and a five-minute deadline; it is separate from ordinary task-dispatch capacity. There is no automatic assessment retry.

The inspector receives its kind's role/protocol separately from optional execution direction and generated assessment instructions. Its evidence bundle separates the inspected bee's captured role (`source.systemPrompt`), optional execution direction (`source.brief`) and task snapshots read at settlement. An empty brief is valid; the task beads define the assignment, and settlement snapshots are not immutable copies of their launch-time text. The bundle also contains execution evidence, private source pointers and a report contract. The inspector submits with `bee assess --file PATH`, using injected assessment authority rather than an inactivity verdict. A failed, missing or late assessment stays visible as missing coverage; it cannot fail or retry the original work. Awake reconciliation resumes recorded inspections after daemon recovery; detached deadlines still apply while asleep. Disabling new assessments does not abandon an inspector already running.

Inspect retained assessments without contacting or starting a daemon:

```nu
colony assessments --json
colony assessments --limit 50 --json
colony assessments --request SPAWN_ID --json
colony assessments --request SPAWN_ID --source --json
colony assessments --schema --json
```

For Codex, accounting reads bounded stdout plus the unique native rollout matching its recorded thread ID, under `CODEX_HOME/sessions` (or Codex's default `~/.codex/sessions`). It reads no unrelated transcript. Rollout counters can survive self-report termination before a final stdout usage event. First-call input includes all initial context, not just orientation. Native rollout fields were verified with Codex 0.161.0; missing, ambiguous or unsupported telemetry and logs over 16 MiB remain explicit coverage limits.

Task-snapshot read failures are retained as `source.unavailableTasks` with reasons, rather than blocking terminal request settlement or inventing empty task data. Persistence and process-ownership failures still surface as infrastructure errors.

Default output contains the most recent 20 complete summaries, with identity, lifecycle phase and queued timestamp. Failed assessments include their diagnostics; `coverage` appears when task snapshots are unavailable or omitted. `--request` adds the full selected report, including evidence and uncertainty. Add `--source` with `--request` to include the supporting bundle (captured instructions, task snapshots, attempts, usage and source path); a missing source artifact is returned as `source: null` with its expected path. Use `--repo`, `--beads-db` and `--state` for an explicit repository/tracker/server selection. Inspection is read-only and does not create missing state. Raw transcripts remain private; neither report listing nor normal Beads work views receive copied logs or an extra task per assessment.

### Ask the nurse

Hive configures a cheap Codex Luna post-run drone and a hidden Codex Astra/xhigh `nurse`. Both use [welcoming hive](../../docs/agents/welcoming-hive.md): whether a crisp assignment leads through appropriate guidance to productive work and cohesive delivery, without excessive orientation overhead. Native measured usage is separate from estimated or unavailable onboarding attribution; repeated cumulative counters and cached input must not be double-counted.

Ask for a nurse briefing through an explicit report task describing the question and period to examine:

```nu
bee kinds nurse --verbose
bee spawn nurse --parent REPORT_TASK_ID --input-file nurse.json --cwd RETAINED_WORKTREE --actor REQUESTER --json
```

Read the delivered briefing with `bee result REQUEST_ID` using the request returned by spawn. Hidden keeps the nurse out of ordinary discovery, not out of explicit named invocation. She synthesizes coverage, recurring friction and supported improvements for ct; she creates change tasks only with ct's approval. Automatic assessments stay in Colony's private state. Filing selected specialist evidence is a separate authorized operation under the [existing stewardship contract](../../docs/beads-labels.md#specialist-evidence-and-label-stewardship); no new evidence label is granted by this feature.

## Run a colony

Wake a repository on an explicitly selected local server:

```sh
bun run lib/colony/bin/colony.ts wake \
  --repo /path/to/repository --beads-db "$BEADS_DB" \
  --state /path/to/server-state --json
bun run lib/colony/bin/colony.ts daemon status --state /path/to/server-state --json
bun run lib/colony/bin/colony.ts daemon stop --state /path/to/server-state --json
```

`wake` starts the selected server lazily when needed and registers the repository's canonical root together with its tracker. Repeated wake calls reuse the server. Each registered repository has its own loop and configuration. Workers receive that repository's selected tracker even when the daemon or worker runs elsewhere.

`colony add` registers a repository asleep; `colony list` shows membership, intended activity and observed state. `add`, `wake`, `sleep` and `remove` all accept `--repo` and `--beads-db`. Adding existing membership preserves its activity. Durable awake colonies resume after daemon restart; sleeping ones remain asleep. Each fresh wake reloads canonical `.hive/bees.toml`.

`colony sleep` drains the current scheduling pass before acknowledging. It then performs no polling, dispatch or reconciliation, while detached workers continue. `colony remove` also drops registry membership and retains execution records; its result lists those attempts. Re-adding the same repository uses the same tracker authority while those records exist.

For disposable work, use `colony wake --temp`. Temporary membership stays awake even with an empty queue and ends only on sleep, removal or daemon exit. It is never restored. Ordinary `wake` or `add` promotes a temporary entry to durable membership; `wake --temp` refuses an already durable entry.

The default server state directory is `$XDG_STATE_HOME/hive/colony`, or `~/.local/state/hive/colony` when that variable is unset. The socket defaults to `colony.sock` in the selected state directory. An explicit `--socket` requires an explicit `--state` so selecting another endpoint cannot accidentally reuse default state. Use private state and socket paths for disposable runs.

`daemon status` and `daemon stop` contact the selected server without starting one. Stopping the daemon leaves detached workers running. To run the server in the foreground, including under a service manager, use `colony daemon serve` with the same state/socket options. No service is installed automatically.

One daemon owns a state directory at a time, including when callers choose different sockets. After a daemon is killed, `wake` can recover its recorded stale socket and restore durable membership. An unknown socket or a file at the selected path is left intact and reported as an error. Status identifies the daemon instance, PID, socket and state directory; CLI commands reject a socket whose daemon uses a different selected state directory.

Recovery adopts verified surviving executions without launching duplicates. A dead execution follows the same completion, retry and claim-release rules as an ordinary exit. Closing a request while its colony sleeps leaves its worker and claims alone until wake; an awake colony stops the owned execution before releasing its unfinished claims. Removal retains these records, so re-add and wake can reconcile work that outlived membership. Missing or ambiguous ownership evidence fails visibly.

## Health notifications

The independent watchdog reads public daemon status every 30 seconds. It alerts through `cc-notify` when any registered colony fails, even while the daemon is running, or when the daemon has been unreachable for at least 60 seconds. Poll and delivery time can add to that delay. Asleep colonies are normal; the watcher never wakes, repairs or starts Colony.

Failure alerts share a 30-minute cooldown per watched state/socket target, measured from the last successful notification. A new failure or sustained daemon outage observed during the cooldown alerts once the window expires, only if it is still present. Each repository/tracker failure episode and sustained daemon outage alerts at most once, even if its diagnostic changes; ongoing incidents do not send periodic reminders.

Recovery of an alerted incident notifies immediately, bypassing the failure cooldown and starting a fresh 30-minute window. An explicitly observed awake or asleep state produces one failure-cleared notification. A missing registration does not prove recovery. Daemon reachability recovery is reported separately and does not clear retained colony failures. Eligible changes observed together share one notification; initial healthy startup and incidents that clear before their alert is delivered are silent.

Build and install the Colony artifacts first. Run the Mise watcher from one retained Hive checkout. Install [Mise](https://mise.jdx.dev/daemons.html), [Pitchfork](https://pitchfork.jdx.dev/reference/configuration.html), and `cc-notify`; its local notification service must also be available. These executables must be discoverable in the Mise environment, including at login. The daemon command adds `~/.local/bin` to its own `PATH` so user-installed `cc-notify` works without shell initialization. The root `mise.toml` enables Mise's experimental daemon support and defines `colony-watchdog` with indefinite failure retries and boot startup. It has no shell-entry autostart, shell-leave autostop, or dependency that starts Colony.

From the chosen checkout:

```sh
mise daemons ls --json                     # inspect without starting anything
mise daemons start colony-watchdog
mise daemons status colony-watchdog
mise daemons logs colony-watchdog
mise daemons stop colony-watchdog           # planned maintenance
mise daemons start colony-watchdog          # resume monitoring
```

For login startup, register this checkout and enable Pitchfork's user-level boot integration:

```sh
mise daemons register
pitchfork boot enable
pitchfork boot status
```

Mise-generated registrations retain the project's Mise environment at boot. No custom launchd plist is needed. `pitchfork boot enable` configures the shared supervisor: other registered `boot_start` daemons can also start at login. Stopping the watchdog does not disable its next boot start. To disable its boot startup, override `boot_start = false` under `[daemons.colony-watchdog]` in this checkout's `mise.local.toml`, then run `mise daemons register` and `mise daemons stop colony-watchdog`. Keep the selected checkout until activation is moved; disable its boot registration before enabling another checkout so two watchers do not compete.

Configuration was checked with Mise 2026.10.4 and Pitchfork 2.29.0. Pitchfork 2.29.0 supports daemon retries and boot registration, but lacks the supervisor launchd crash-restart support introduced in 2.30: a crashed supervisor itself may require manual restart. Boot/login operation and real notification delivery need verification on the installation host.

The watcher uses the same state/socket defaults as `colony`. To select a different daemon, override `run` in `mise.local.toml`, or run the foreground entry directly:

```sh
colony-watchdog --state /path/to/server-state --socket /path/to/server.sock
```

An explicit socket requires explicit state. Status calls and notification commands have ten-second deadlines. Notification bodies go to `cc-notify "Colony health"` through stdin. Delivery failures, malformed responses and checkpoint errors fail visibly in the watcher logs; Pitchfork retries the process. Planned daemon shutdown looks like an outage while monitoring is enabled, so stop the watchdog first.

Delivery bookkeeping lives in `<state>/watchdog/<sha256-of-absolute-socket>.json`, separate from Colony's database. It retains outage onset, successfully notified repository/tracker incidents and the last successful notification time across watcher restarts. A successful delivery precedes atomic checkpoint replacement. A crash between delivery and save can repeat a notification; exactly-once delivery is not guaranteed. Preserve this file during restarts to retain deduplication.

## Inspect runtime and retained history

```sh
bun run lib/colony/bin/colony.ts inspect \
  --repo /path/to/repository --beads-db "$BEADS_DB" \
  --state /path/to/server-state --json
```

`inspect` queries the selected running daemon without starting it. It returns current colony membership or `null`, the last reconciled request checkpoints, attempt history, policy revision metadata and local receipt/log paths. Request checkpoints can lag native Beads changes while a colony sleeps; use `bee status` for current tracker facts. `observedAt` is the inspection time, not the last reconciliation time.

Each attempt identifies its request, friendly identity, attempt number, model, harness, execution directory, capacity bucket and policy revision. The returned `paths` locate the private launch receipt, worker receipt, stdout, stderr and supervisor log. Files may not yet exist for an attempt still starting. Generic inspection omits prompt text, invocation arguments and ownership tokens; the local launch receipt contains the complete private invocation.

Removing a colony retains request checkpoints, attempts and revision history. Inspect those records with the same repository and tracker selection. `colony add` restores durable membership asleep; `colony wake` restores awake reconciliation and reloads canonical policy. Neither removal nor inspection closes requests or terminates workers.

Explicit targets are independent. For example, `colony daemon status --state /tmp/colony-a --socket /tmp/colony-a.sock` and the equivalent command with `colony-b` address different servers. `daemon stop` affects only its selected target. `daemon serve --state /path/to/state --socket /path/to/socket` is the foreground entry for a service manager: signals are forwarded, and the process remains attached until the server exits. Hive does not install a service.

## Inspect operation and failure evidence

```sh
colony events --repo "$REPO" --beads-db "$DB" --state "$STATE"
colony events --repo "$REPO" --beads-db "$DB" --state "$STATE" --request SPAWN_ID --failures --json
```

`events` reads the selected local state database even when the daemon is stopped. It does not contact Beads or the daemon, wake a colony, refresh inventory, retry, reconcile or acknowledge failures. Repository discovery still uses Honeycomb. A missing database or history table fails visibly; inspection never creates or upgrades state. SQLite may update its shared-memory reader coordination, but history performs only SELECTs and does not change database records or WAL contents.

Records cover daemon request preparation, claim acquisition, launch handoff and reconciliation/settlement, plus repository dispatch failures. They identify the operation and last boundary target, before/last-recorded-after checkpoints, confirmed completed effects, native error code/message and exit status when available, and retained artifact paths. `--request` selects a spawn request; `--failures` includes handled native claim conflicts as well as thrown failures. It excludes unfinished operations with no recorded error: omit that filter to see interrupted work. A completed operation is a completed boundary, not a claim that the worker or task succeeded. Effect entries confirm successful boundary returns, including publication that was already current.

Sequence numbers order operation starts within one daemon database; timestamps are informational. A request ID correlates lifecycle operations and checkpoint attempt IDs identify executions. Nested operations can finish in a different order; sequence gaps are normal. Successful polls with no projected checkpoint change or recorded effects are discarded. Retention keeps the newest 1,000 finished operations and 100 unfinished operations across all repositories in the selected state directory. The separate unfinished allowance prevents routine polls from displacing completed evidence. Retention bounds rows, not artifact storage or database file bytes; SQLite reuses freed pages. These records are diagnostic history, not a complete audit log.

Each progress update is atomic. External effects and checkpoint/history writes are separate commits: a crash after an effect but before its evidence write leaves that effect **unknown**, even if it happened. `unfinished` means no final result was recorded; it does not prove the operation is still running. `after` is the last saved checkpoint projection, which may predate the interruption. A failed step may have partially changed external state; only `completedEffects` are confirmed. History write failures propagate without retrying effects. The latest failure is retained if cleanup itself subsequently fails. Existing receipts, Beads records and logs remain the source evidence; paths can refer to artifacts not yet created, and foreground daemons need not have a `daemon.log`.

History excludes recipes, full prompts, checkpoint free text, raw command output, environment and receipt tokens. Native diagnostics reuse the structured command error, including wrapped label-publication failures; messages are limited to 2,048 characters with credential assignments, bearer credentials and URL passwords redacted. Unstructured failures retain a source-evidence pointer instead of copying arbitrary error text. Old blank tracker failures cannot be reconstructed, and manual `colony launch`, Bee submission/control commands and administrative policy changes are outside this capture scope.

## Output for people and scripts

Without `--json`, successful commands print readable results on stdout and diagnostics on stderr. With `--json`, each finite command emits one JSON object on stdout and leaves stderr empty. Successful payloads retain their fields at the top level with `ok: true` and a `kind`; failures have `ok: false`, `kind: "error"`, `reason` and `message`. Exit status is zero for success, one for operational failure and two for CLI usage errors.

Bee JSON defaults are command-sized. Workflow submission returns `request: {id, identity}` and `workflow: {runId, status, parentId?}`; stage submission and retry return `request: {id, assignee}`. `status` and `list` omit captured prompts; their help covers expansion and history. `stop` acknowledges native request closure; use `status` for subsequent observations and `colony explain` for live process evidence.

| Command result | `kind` |
| --- | --- |
| Bee workflow or stage submission | `workflow_spawn_created`, `spawn_created` |
| Bee self-report | `finish_submitted` |
| Bee inactivity verdict | `drone_verdict_submitted` |
| Bee status, list, stop, ack | `request_status`, `request_list`, `request_stopped`, `request_acknowledged` |
| Daemon status or colony list | `status` |
| Offline operation/failure history | `events` |
| Repository runtime inspection | `inspection` |
| Configuration operations | `config` |
| Init or manual launch | `initialized`, `launched` |
| Wake, add, sleep, remove | `awake`, `registered`, `slept`, `removed` |
| Daemon stop or successful foreground exit | `stopped`, `daemon_completed` |

Failure reasons are Commander usage codes, `daemon_unavailable`, a native subprocess exit code, or `operation_failed` for an otherwise unclassified error. Branch on `ok`, `kind` and `reason`, not message wording. Foreground `daemon serve --json` captures diagnostics and emits its one result only when the server exits; use a separate `daemon status` call to check readiness. Help remains ordinary command help.

## Manual launch

For a single attempt without the daemon scheduler:

```sh
bun run lib/colony/bin/colony.ts launch <spawn-id> \
  --repo /path/to/repository \
  --beads-db /path/to/tracker/beads.db \
  --state /path/to/colony-state \
  --json
```

This command waits for the child process and writes its actual invocation, recipe, formula, tracker, identity and outcome to an execution receipt. Child stdout and stderr go to separate files in that receipt's directory. A successful process exit does not establish that the requested tasks are complete.

The request must be open, assigned to a friendly identity, and carry the [spawn labels](../../docs/agents/spawn-requests.md#facts-and-authority); use `bee spawn` to publish them consistently. The driver links exactly its workflow run with a `related` edge; a stage worker links exactly its stage. The unfinished anchor must be ready and available to the captured identity. The request description captures the execution recipe, host and assignment:

```json
{
	"assignment": { "kind": "driver", "runId": "RUN_ID" },
	"host": "example-host",
	"kind": "worker",
	"harness": "example",
	"model": "selected-model",
	"effort": "low",
	"system_prompt": "Implement the linked task beads and verify their outcomes.",
	"prompt": "",
	"cwd": null
}
```

`cwd: null` selects the canonical worktree. An explicit directory changes only where the child runs; configuration and tracker selection remain tied to the selected repository. `BEADS_DB` and the supplied identity reach child tool processes through the launch environment.

## Harness formulas

The canonical `.hive/bees.toml` maps harness names to executable and argument tokens:

```toml
owner = "ct"
humans = ["ct"]
ranking = "bv-pagerank"
max_retries = 3
retry_delay_ms = 250

[limits]
colony = 4
kind = 2
worktree = 2

[limits.kinds]
reviewer = 1

[kinds.worker]
description = "Implement the linked task beads and verify their outcomes."
harness = "example"
model = "selected-model"
effort = "low"
system_prompt = "Implement the linked task beads and verify their outcomes."

[formulas.example]
executable = "/path/to/harness"
headless = ["--print"]
argv = ["--model", "{{model}}", "--effort", "{{effort}}", "{{#if system_prompt}}--system-prompt{{/if}}", "{{system_prompt}}", "{{prompt}}"]
```

`headless` defaults to an empty array and contains argument templates prepended only for managed workers, inactivity reviews and post-run inspections. `bee run` uses `argv` alone. The caller selects the mode explicitly; a missing TTY fails instead of switching modes. Both arrays use the same template rules.

Replace the illustrative arguments with the selected harness's supported native flags. Route `system_prompt` to its role-instruction input and `prompt` to its execution-message input. Tokens use ordinary Handlebars syntax with strict missing-value checking and no HTML escaping. Empty rendered argv tokens are omitted: condition both an optional flag and its value so an empty role leaves neither behind. The `json` helper JSON-quotes a value for native configuration arguments; ordinary argv string values remain raw.

Configuration loading validates templates with both prompt fields present and absent, and with canonical and explicit execution directories. Arguments are passed directly to the executable; recipe text is never evaluated as a shell command. Unknown recipe/configuration fields and absent named formulas fail explicitly.

### Native formula examples

The shared-argument layout and role delivery were verified with Codex CLI 0.161.0 and native Pi 1.0.0 in both interactive terminals and headless runs. Replace an existing section with the same name rather than declaring it twice. Select the actual native Pi executable, not a wrapper that dispatches to another daemon.

```toml
[formulas.codex]
executable = "codex"
headless = ["exec", "--json", "--sandbox", "workspace-write", "--ephemeral"]
argv = ["--model", "{{model}}", "-c", 'model_reasoning_effort="{{effort}}"', "-c", 'shell_environment_policy.inherit="all"', "{{#if system_prompt}}-c{{/if}}", '{{#if system_prompt}}developer_instructions={{json system_prompt}}{{/if}}', "--", "{{prompt}}"]

[formulas.pi-native]
executable = "/absolute/path/to/native-pi"
headless = ["--print", "--mode", "json", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-session", "--offline", "--tools", "bash,read"]
argv = ["--model", "{{model}}", "--thinking", "{{effort}}", "{{#if system_prompt}}--append-system-prompt{{/if}}", "{{system_prompt}}", "--", "{{prompt}}"]
```

Codex receives the role through a JSON-quoted `developer_instructions` configuration value, replacing any existing value for that field. Pi receives raw role text through `--append-system-prompt`. These are different native instruction mechanisms, not a promise of identical system-role precedence. The headless Pi profile deliberately isolates extensions and context files and limits tools to the probe's Bash/read path. It does not demonstrate Scent or a general-purpose production context setup. Submit with the matching native model syntax, for example:

```sh
bee spawn worker --parent "$WORK_ID" --input-file "$REPO/work.json" --repo "$REPO" --beads-db "$DB" --actor operator \
  --harness pi-native --model openai-codex/gpt-6-astra --effort low
```

The interactive/headless role checks used `gpt-6-luna` for Codex and `openai-codex/gpt-6-astra` for Pi, both at low effort. Pi may require a provider-qualified model when multiple providers are authenticated. Model availability and authentication belong to your account. See [dated native results](../../docs/harness-capabilities.md#current-native-probe-evidence) for the separate managed tool-process checks.

## Scheduling

All unfinished linked tasks must be ready and available to the request's identity. Closed tasks count as satisfied; if every task is closed, Colony closes the request without starting an agent. Eligible requests use the highest urgency among their linked tasks: P0 before P1.

Within a priority tier, the default `bv-pagerank` mode uses the best linked task's PageRank from BV's complete insights map. It does not use the capped triage recommendation list. BV reads the explicitly selected SQLite tracker directly in read-only mode, using BV’s complete visible graph, including closed and ephemeral tasks and unflushed database edits; invalid or incomplete rankings fail visibly. Ranking does not export, flush, or reconcile the tracker. SQLite readers may use locks and shared-memory coordination files, and the native multi-query read is not an atomic snapshot across concurrent commits. Install `bv` for this mode. Set `ranking = "fifo"` to order ties by request creation time and then ID without BV.

Colony invokes BV only when individually feasible requests at the same priority cannot all fit the remaining colony, kind and launch-location limits. It skips ranking when no request can start, only one is feasible, or all feasible requests fit together. Higher-priority requests are admitted first; lower priorities use the capacity left by successful reservations. A later ranking failure remains visible and does not undo earlier launches.

The default maxima are four attempts per repository, two per kind, and two per launch location. `[limits.kinds]` overrides individual kind maxima. Zero prevents new launches. The location bucket is the Git worktree containing the recorded launch directory, or the canonicalized external directory; later process directory changes do not move the bucket. `colony list` exposes the active policy.

Edit canonical limits and run `wake` to apply them. Lowering a maximum never stops existing workers. New work waits until live occupancy falls below every applicable maximum, including workers retained across sleep or registration removal.

## Completion and retries

Colony acquires ready task claims using the request's friendly identity immediately before launch. The worker receives that identity and the selected tracker. If another actor reserves a task before acquisition, the request waits. A conflict after acquiring part of a multi-task request stops that request and releases only its own acquired claims.

A live bee owns its completion point: task closure alone does not terminate it. After exit or `bee finish success`, tasks determine completion. Unfinished work consumes a retry even when its exit code is zero or it reported success. An explicit blocked report instead settles for caller attention without automatic retry. `max_retries = 3` permits four total attempts. `retry_delay_ms` defaults to 250 and accepts 0–60000; the next awake polling pass after that deadline can dispatch a replacement. Sleeping pauses this progression.

Before replacement or terminal cleanup, Colony verifies that the old owned execution has stopped. It follows native parent-child links beneath its recorded claims and clears unfinished assignments still held by that identity. Closed tasks, human reservations (`hitl`), native blocked states and other actors' assignments remain intact, including independently spawned workflow workers. Related tasks outside that hierarchy are untouched. Conditional revision checks make concurrent changes fail visibly; settlement replay can continue after partially completed releases. Automatic replacement attempts keep the friendly identity and receive a new attempt ID; explicit `bee retry` creates a new identity that can claim the released work. Exhaustion closes the request with an explicit reason; logs and detailed process receipts remain in server state.

The supervisor records process fingerprints and observed descendant lineage, including children in separate process groups. Cleanup refuses ambiguous ownership. Sampled PID/start-time identity, token and lineage checks are not a race-free OS process handle; command text is diagnostic because a harness can change its process title. This covers descendants observed during execution; it does not promise to capture every process that immediately detaches and escapes observation. Retained request records pin their tracker authority, and changing a captured request's identity or task relationships fails visibly.

## Live configuration

Inspect or change an awake colony through the selected server:

```sh
colony config show --repo /path/to/repository --beads-db "$BEADS_DB" --state /path/to/server-state --json
colony config update --repo /path/to/repository --beads-db "$BEADS_DB" --state /path/to/server-state --actor <operator> --file formula.json --json
colony config history --repo /path/to/repository --beads-db "$BEADS_DB" --state /path/to/server-state --json
colony config reset --repo /path/to/repository --beads-db "$BEADS_DB" --state /path/to/server-state --actor <operator> --json
```

`update` reads one strict JSON change. A named formula change looks like:

```json
{
	"kind": "formula",
	"name": "example",
	"formula": {
		"executable": "/path/to/harness",
		"headless": ["--print"],
		"argv": [
			"--model",
			"{{model}}",
			"{{#if system_prompt}}--system-prompt{{/if}}",
			"{{system_prompt}}",
			"{{prompt}}"
		]
	}
}
```

A capacity change replaces all four limit settings:

```json
{
	"kind": "limits",
	"limits": { "colony": 4, "kind": 2, "kinds": { "reviewer": 1 }, "worktree": 2 }
}
```

Only formulas and limits can change this way. Recipe defaults and captured requests stay independent of the running daemon. Invalid updates leave the effective policy intact. Updates wait for the current scheduling pass to finish before activating; existing workers continue when limits decrease.

`--actor` takes precedence over `BD_ACTOR` for updates and resets. Each accepted change has an immutable policy revision, and each daemon attempt records the revision it actually used beside its rendered invocation. Generic inspection lists formula names and revision metadata without printing executable arguments. Full snapshots and execution receipts remain in private server state.

Overrides last until a fresh wake, daemon recovery wake or explicit reset reloads canonical `.hive/bees.toml`. History survives those resets. Canonical loads record their source without inventing a file author. Configuration commands do not start a daemon; update and reset require an awake colony.

## Verification

Native failure and confirmed partial-effect evidence: `bun test lib/colony/src/history.smoke.test.ts`. Bounded-retention, crash-uncertainty and retry checks were parked during the timing cleanup; their scenarios and restoration pointers are in the [Colony coverage record](../../docs/test-cases/colony.md).

Run from the Hive checkout. Installed Bee/Colony commands run on Bun. The repository check includes the full test suite:

```sh
bun run check
bun test lib/colony/src
```

The smoke fixtures use real disposable Git repositories, Beads databases, sockets and processes. Scripted workers make failure and timing cases reproducible; those results do not by themselves prove a native provider launch.

| Boundary | Focused command |
| --- | --- |
| Offline bundled instructions and resources | `bun test lib/colony/src/skills.smoke.test.ts` |
| Native failure and partial-effect history | `bun test lib/colony/src/history.smoke.test.ts` |
| Filesystem kind discovery and invalid layout | `bun test lib/colony/src/config-discovery.smoke.test.ts` |
| Interactive terminal input rejection | `bun test lib/colony/src/run.smoke.test.ts` |
| Native usage-counter recovery | `bun test lib/colony/src/postrun-evidence.smoke.test.ts` |

Offline submission, daemon lifecycle, scheduling, self-report, claims/retry, recovery, request authority, policy revisions and runtime-inspection smoke coverage is parked in the [coverage record](../../docs/test-cases/colony.md). The record preserves the removed assertions; runtime behavior is unchanged.

For a real, authenticated native harness, run the opt-in probe separately:

```sh
bun run lib/colony/scripts/native-smoke.ts \
  --harness codex --executable /absolute/path/to/codex \
  --model YOUR_MODEL --output /path/to/new-evidence-directory
# For native Pi, select --harness pi and its actual executable and model.
```

This requires Bun, Git, br and Honeycomb on `PATH`, an absolute native executable, and working account authentication. The output directory must not exist. The runner creates it privately, uses an isolated repository/tracker/daemon, applies a 180-second native deadline, and retains evidence on success or failure. Cleanup closes the request, reconciles owned work, and stops the private daemon. Select the native Pi executable explicitly: an unrelated `pi` wrapper may dispatch work to another daemon and has different ownership semantics.

See the [capability reference](../../docs/harness-capabilities.md) for dated native results. No Scent hooks, provider subscription, or service installation is supplied by these commands.

## Explain request progress

```sh
colony explain <spawn-id> --repo . --beads-db "$BEADS_DB"
colony explain <spawn-id> --repo . --beads-db "$BEADS_DB" --state /path/to/state --socket /path/to/colony.sock --json
```

`explain` reads native request/task facts and direct dependency edges, native ready membership, claims and human reservations, the selected daemon's retained checkpoint and active capacity policy, and fresh verified process ownership. It uses the same eligibility and capacity decisions as dispatch. Bee `status` remains Beads-only inspection.

JSON returns `ok: true`, `kind: "explanation"`, `id`, `repository`, `tracker`, `runtime`, `capacity`, `processes`, and `diagnostics`. Evidence groups contain `source`, `observedAt`, `freshness`, and `result`: either `available` with `value`, or `unavailable` with `reason` and `message`. Source/freshness applies to every enclosed fact. Native request, task and dependency revisions carry `updatedAt`; the last Colony comment retains its original timestamp. `observedAt` is the end of a read, not an atomic snapshot across sources. Runtime checkpoint and capacity evidence uses `checkpoint_age_unknown`: the store does not retain reconciliation timestamps. Colony membership and active policy are sampled from the daemon at read time; attempt creation time is not an attempt-state update time.

Each diagnostic has `code`, `kind` (`blocker`, `progress`, `disagreement`, or `unknown`), `message`, `nextTransition`, and `evidence` references. These are conditions, not another request state enum. Native outcome/resolution keeps its [documented vocabulary](../../docs/agents/spawn-requests.md). An eligible request with available capacity is only runnable at those samples: ranking, claims, formula preparation and another dispatch pass must still succeed. Capacity counts retained starting/running reservations, even if a fresh process check disagrees. `running_observed` means verified owned execution is live, possibly a supervisor awaiting launch; it does not prove useful work. Stopped execution does not by itself imply successful task completion.

An absent/unreachable daemon produces partial diagnostics with `daemon_unavailable`; it is never started. An asleep or failed colony reports the wake/failure condition and still permits process observations when retained attempt evidence is available. Missing, mismatched or unverifiable ownership remains unknown, never assumed stopped. Closed-native/live-process and checkpoint/process disagreements are explicit. There is no offline database fallback. `ok: true` means the diagnostic report was produced, not that the request is healthy or every source was available; read failures remain in the evidence. Invalid CLI arguments or endpoint discovery failures use the ordinary `ok: false` error contract.

Inspection does not wake, retry, repair labels, acquire claims, reconcile, reserve capacity or update attempt checkpoints. It reads one request, its related tasks and direct dependencies, one native ready query, one repository inspection response, and ownership artifacts/process snapshots for the request's retained attempts. It does not read worker logs or return captured prompts/tokens. Costs grow with linked tasks/dependencies, retained attempts and native ready query size. The existing socket timeout is ten seconds; a raced supervisor handoff can take up to five seconds to observe. Results can change immediately after sampling; queue position and future scheduling order are deliberately not predicted.
