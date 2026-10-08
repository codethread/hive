# Bee and Colony

Colony launches agents from spawn requests stored in Beads. A spawn request is distinct from the task beads it asks an agent to work on. Each request carries a captured recipe and a friendly assignee; Colony applies the current named harness formula in the canonical worktree's `.hive/bees.toml`.

## Install and try it

Requirements: Bun, Bash (for installed wrappers), Git, `br`, `honeycomb`, and a native harness executable with working model access. Default ranking also needs `bv`; set `ranking = "fifo"` in `.hive/bees.toml` to run without BV. `colony init` writes a Codex formula, so its default quickstart needs native Codex on `PATH`. Other harnesses need a formula using their supported flags. See [harness evidence](../../docs/harness-capabilities.md) for verified versions and limits.

From a Hive checkout you intend to retain:

```sh
bun install
bun run --filter @hive/colony install:bin
bee --help
colony --help
```

The installer writes `bee` and `colony` wrappers to `~/.local/bin`; put that directory on `PATH`. The wrappers point to this checkout and resolve Bun through `PATH`, so retain the checkout and its installed dependencies. Use `install:bin --directory /path/to/bin` for a separate destination. This installs commands only; it does not install or start a service.

Start with a disposable Git repository that already has an initialized Beads tracker. Select that repository and database explicitly; do not use your working task tracker for an experiment. Choose a model available to your native Codex account:

```sh
REPO=/path/to/disposable-repository
DB="$REPO/.beads/beads.db"
STATE="$REPO/.colony-smoke-state"

colony init --repo "$REPO" --owner operator --model YOUR_MODEL
br create --db "$DB" --actor operator --owner operator \
  --title "Write a short smoke-result.txt and close this task" --json
# Copy the returned task ID into TASK_ID.
TASK_ID=YOUR_TASK_ID
bee spawn worker "$TASK_ID" --repo "$REPO" --beads-db "$DB" --actor operator --json
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

## Discover bee kinds

Start with `bee --help` for the delegation runbook, then `bee kinds` for the configured names and descriptions. Discovery reads canonical configuration under `.hive/` and needs neither a tracker nor a daemon. `bee list` instead lists submitted requests.

```sh
bee kinds
bee kinds --as librarian
bee kinds reviewer --verbose
bee kinds --all --json
bee kinds --schema --json | jq '.schema'
```

Every kind requires a nonempty `description` explaining when to choose it. Default output contains only names and descriptions; `--verbose` includes the full prompt and execution defaults. An explicit kind name inspects it directly. `--all` includes every kind, independently of verbosity.

`--schema` returns JSON describing the success and failure response shapes without reading configuration. Combine it with `--verbose` to inspect the full-detail schema. Normal `--json` results stay concise; schemas and prompts are opt-in.

Visibility is selection guidance, not runtime authorization. A hidden or omitted kind remains spawnable, allowing testing and flexible workflows. The caller comes from `--as`, then `BR_AGENT_NAME`; without either, discovery shows all non-hidden kinds. Unknown callers and selectors fail visibly. Kind names, rather than models, determine the policy.

Optional `allow` and `deny` lists belong to the caller kind and are mutually exclusive. `allow` shows exactly its named kinds, overriding their `hidden` setting; `deny` subtracts from the non-hidden baseline. Empty `allow` shows none, while empty `deny` preserves that baseline. The sole special selector, `"#self"`, refers to the caller kind; self-hiding is explicit.

These fragments omit the required execution fields (`harness`, `model`, `effort` and `prompt`):

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

## Create requests

Initialize configuration once in a repository with an existing Beads tracker:

```sh
bun run lib/colony/bin/colony.ts init \
  --repo /path/to/repository --owner ct --model gpt-6-astra
bun run lib/colony/bin/bee.ts spawn worker <task-id> \
  --repo /path/to/repository --beads-db "$BEADS_DB" --actor <requester> --json
```

`init` creates `.hive/bees.toml` in the canonical worktree and refuses to overwrite an existing file. `spawn` works while Colony is unavailable or asleep. It captures the kind's effective recipe on a new spawn bead without claiming its task beads. Later edits to defaults do not change that captured recipe.

Use `--model`, `--effort`, `--harness`, `--prompt` or `--cwd` to change the recipe for one request. `--prompt` replaces the kind instructions rather than appending; put ordinary task-specific guidance on the task bead. Bee automatically mints a friendly name and records it as the assignee. The requester is the actor creating the bead, selected by `--actor` or `BD_ACTOR`; the human owner comes from configuration. Neither is the spawned agent's identity.

Repository discovery defaults to the current directory and can be selected with `--repo`. Tracker selection is explicit through `--beads-db` or `BEADS_DB`. Blocked tasks can be submitted and wait for eligibility. Unknown kinds, human reservations and overlapping open spawn requests fail. A named harness may be supplied by a later Colony formula update; Bee does not require it to exist in the current file's formula map.

## Kind files

Configuration lives in the canonical worktree's `.hive/bees.toml`. Keep repository policy, formulas and any inline `[kinds.NAME]` definitions there. You can also place each kind in an immediate subfolder of `.hive/bees/`:

```text
.hive/
  bees.toml
  bees/
    code-review/
      bee.toml
      prompt.md
```

The folder name is organizational; `name` in `bee.toml` declares the kind:

```toml
name = "reviewer"
description = "Review code changes against repository standards."
harness = "codex"
model = "gpt-6-astra"
effort = "high"
```

The sibling `prompt.md` supplies the prompt verbatim. It must exist and be nonempty; folder definitions accept neither inline `prompt` nor `prompt_file`. Every immediate kind directory must contain both files. Discovery is nonrecursive and includes real directories, not directory symlinks. The central file is required, but its `kinds` table and the entire `bees/` directory may be omitted.

A central `[kinds.NAME]` definition replaces the **whole** matching folder definition, not individual fields. `bee kinds` reports these conflicts as warnings (in JSON, the `warnings` array). Duplicate folder definitions without a central winner fail. Malformed definitions and missing prompts fail even when a central definition shadows them.

Spawn, retry, manual launch and Colony policy loading share this discovery path. Worktree-local configuration and root-level `bees.toml` are not read. Existing captured recipes remain unchanged when configuration or prompt files are edited.

## Retry an unsuccessful request

```sh
bun run lib/colony/bin/bee.ts retry <spawn-id> \
  --repo /path/to/repository --beads-db "$BEADS_DB" --actor <requester> --json
```

`retry` accepts an unresolved request closed as `exhausted`, `claim_failed` or `blocked`. It carries only unfinished related tasks and the old kind choice into a new request. The entire recipe comes from [current canonical kind defaults](#kind-files), including file-backed prompts, followed by explicit `--model`, `--effort`, `--harness`, `--prompt` and `--cwd` overrides. Use `--kind` to select another kind. No captured old recipe values are merged, including execution directory or prompt. The new request gets a new automatically generated friendly identity and its own fresh automatic retry budget under Colony policy.

Human reservations and overlapping open requests still refuse admission. No unfinished tasks also refuses retry. Creation records a native `supersedes` relationship from replacement to original, separately from `related` task links. A failed submission leaves the original unresolved. The old closure reason, recipe, identity, observations and execution history remain unchanged.

`status <old-id>` shows `resolution: {kind: "superseded", replacementIds: [...]}` and the replacement ID in human output. Replacement status exposes `supersedes` IDs. Completed and intentionally cancelled requests resolve automatically; `exhausted`, `claim_failed` and `blocked` requests with unresolved resolution have `needsAttention: true`. A replacement that fails needs attention independently of its resolved predecessor. `--all` retains resolved requests in discovery.

For the complete outcome/resolution label values, valid combinations, native attention/history queries and publication recovery, read the [spawn state and query reference](../../docs/agents/spawn-requests.md). Explicit acknowledgment remains separate planned work (hv-45f.4).

## Report completion from a bee

Inside a Colony-launched execution, use `bee finish success` after closing tasks and completing cleanup and tracker synchronization. If work remains blocked, first complete everything possible, record the remaining findings and next actions, then use `bee finish blocked --reason "TASK_ID needs a credential; operator must supply it, then retry"`.

Blocked handoff preserves native task states, records the reason on the spawn, and pauses automatic retries. `bee status` shows the reason and failed/unresolved attention. Once the blocker is resolved and native tasks are ready, `bee retry` creates a linked replacement for unfinished work. See the [self-report contract](../../docs/agents/spawn-requests.md#report-your-own-execution-finished) for completion ownership, injected provenance, durable submission and recovery.

## Inspect or close requests offline

```sh
bun run lib/colony/bin/bee.ts status <spawn-id> --repo /path/to/repo --beads-db /path/to/beads.db
bun run lib/colony/bin/bee.ts list --all --repo /path/to/repo --beads-db /path/to/beads.db --json
bun run lib/colony/bin/bee.ts stop <spawn-id> --repo /path/to/repo --beads-db /path/to/beads.db --actor operator
```

These commands use only Beads and repository discovery. They need neither `.hive/bees.toml` nor a running daemon. `list` defaults to open requests and unresolved failures; `--all` also includes resolved history. `status` reports the captured recipe, friendly identity, linked task status and native readiness, request closure and the timestamp of the latest recorded Colony observation. Native task readiness is separate from Colony's capacity and claim decisions.

For native listings, run `br query run bee-attention --db "$BEADS_DB" --json` after [installing the preset](../../docs/agents/spawn-requests.md#saved-presets). It includes closed unsuccessful requests that remain unresolved. Bee status also exposes the finite `disposition` and whether its native label publication is current.

Observations may be stale. A request can be closed while its last observation still says running; neither `status` nor `list` queries a process or daemon. `stop` closes a validated spawn request using `--actor` or `BD_ACTOR` and preserves an already-closed request's reason. An awake colony then stops the owned execution and releases eligible claims. An asleep colony does that only after wake. Colony writes changing, minimal observations as native comments; full output and execution logs stay local.

`status` and `list` also show the latest recorded stdout activity for the most recently observed execution attempt. JSON exposes `stdoutActivity` with `attemptId`, `attemptNumber`, `lastOutputAt` and `recordedAt`. Before an attempt is observed, `stdoutActivity` is `null`; an attempt with no observed output has `lastOutputAt: null`. A new attempt starts with unknown activity instead of inheriting the previous attempt's timestamp.

`lastOutputAt` is the last modification time of the attempt's nonempty stdout log, formatted as UTC ISO 8601 with milliseconds and `Z`, for example `2026-10-04T10:55:31.000Z`. Empty log creation, stderr and daemon polling do not count as stdout activity. `recordedAt` uses the same format and records publication time; native Beads timestamps retain their own format. Log contents are not parsed or copied into Beads. Silence does not establish that a bee is idle, stalled or dead.

An awake Colony publishes the first actual output on reconciliation, then changed activity at most once per 30 seconds per attempt. Settlement flushes the final observation immediately. Unchanged output adds no comments. While Colony sleeps or its daemon is unavailable, workers keep writing local logs but publication waits for reconciliation after wake or recovery. The source write time survives that delay; it is never replaced by wake or publication time. These timestamps describe the owned stdout log, so leave execution logs unmodified while an attempt is active.

## Review quiet bees with a drone

In canonical `.hive/bees.toml`, set the top-level `inactivity_drone = "inspector"` and define `[kinds.inspector]` with a selection `description` and your chosen `harness`, `model`, `effort` and `prompt`. Its harness needs a matching formula. No model is hardcoded. Omitting `inactivity_drone` disables reviews; fresh wake/reset loads changes. `colony config show --json` exposes the active kind as `active.inactivityDrone`, or `null` when disabled. For example, merge these settings into the existing configuration:

```toml
inactivity_drone = "inspector"

[kinds.inspector]
description = "Inspect a running execution for activity when Colony requests a review."
harness = "example"
model = "YOUR_MODEL"
effort = "low"
prompt = "Inspect the target's logs and process evidence, including legitimate waits."
```

After **15 minutes without stdout**, an awake Colony launches one drone for an unreconciled running attempt with unfinished tasks. A never-written stdout log uses attempt creation as the quiet interval's starting point. Actual log activity, rather than the potentially delayed public timestamp, drives the trigger. The drone receives the exact target attempt, log/process-evidence directory, review ID and deadline, and runs in the target's recorded execution directory. Silence or PID existence alone does not prove inactivity or progress.

The drone uses `bee report SPAWN_ID active|inactive`. **Active** leaves the target running and defers the next review for 15 minutes from Colony's acceptance, independently of actual stdout time. **Inactive** enters the normal attempt-failure policy: verified stop, release only its own unfinished claims, retry within `max_retries`, then failed/unresolved on exhaustion. This adds no request outcome or resolution value.

Each review gets **one launch attempt and at most five minutes of runtime**, with no automatic drone retry. Launch failure, exit without a valid verdict and timeout all apply inactive consequences, with distinct `launch_failed`, `exited_without_verdict`, `timeout` and inspected `inactive` diagnostics. The detached supervisor enforces its deadline even while Colony sleeps or the daemon is stopped; target settlement waits for awake reconciliation. A valid verdict durably submitted before the deadline can be consumed after wake. Duplicate, stale, replaced-attempt and late reports are rejected. Reviews already authorized for execution survive daemon recovery without launching another drone. Missing or ambiguous process authority remains a visible failure rather than permission to signal or release claims.

A crash before execution permission makes the interrupted preparation `launch_failed`. Colony never resumes or repeats that launch. It stops any supervisor with a verifiable handoff; a handoff published later cannot start the harness and its permission waiter expires at the existing deadline.

Drones are auxiliary inspections of existing attempts, with no task claims or independent task request; they do not consume task-dispatch capacity or enter the request scheduler. Each target has at most one outstanding review, and drones cannot trigger recursive inactivity reviews. Completing, cancelling or blocking the target stops its pending drone through the same ownership checks. Task closure alone still leaves a live target time to finish cleanup and self-report.

`bee status` and native spawn comments retain review identity, deadline and diagnostics alongside ordinary execution observations. Review launch receipts, stdout, stderr, process ownership and `verdict.json` remain in the private state directory named by the review ID; the starting observation gives its path. See the [drone report authority contract](../../docs/agents/spawn-requests.md#report-an-inactivity-verdict) before automating verdict submission.

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

| Command result                            | `kind`                                              |
| ----------------------------------------- | --------------------------------------------------- |
| Bee submission                            | `spawn_created`                                     |
| Bee self-report                           | `finish_submitted`                                  |
| Bee inactivity verdict                    | `drone_verdict_submitted`                           |
| Bee status, list, stop                    | `request_status`, `request_list`, `request_stopped` |
| Daemon status or colony list              | `status`                                            |
| Offline operation/failure history         | `events`                                            |
| Repository runtime inspection             | `inspection`                                        |
| Configuration operations                  | `config`                                            |
| Init or manual launch                     | `initialized`, `launched`                           |
| Wake, add, sleep, remove                  | `awake`, `registered`, `slept`, `removed`           |
| Daemon stop or successful foreground exit | `stopped`, `daemon_completed`                       |

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

The request must be open, assigned to a friendly identity, and carry the [spawn labels](../../docs/agents/spawn-requests.md#facts-and-authority); use `bee spawn` to publish them consistently. Link task beads with `related` dependencies. All unfinished tasks must be ready and available to this identity. The request description is a JSON recipe:

```json
{
	"kind": "worker",
	"harness": "example",
	"model": "selected-model",
	"effort": "low",
	"prompt": "Work on the related tasks.",
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
prompt = "Work on the related tasks."

[formulas.example]
executable = "/path/to/harness"
argv = ["--model", "{{model}}", "--effort", "{{effort}}", "{{prompt}}"]
```

Replace the example arguments with the selected harness's supported native flags. Tokens use ordinary Handlebars syntax with strict missing-value checking and no HTML escaping. Configuration loading validates templates by strict rendering against the complete recipe shape, including both canonical and explicit execution-directory cases. Arguments are passed directly to the executable; recipe text is never evaluated as a shell command. Unknown recipe/configuration fields and absent named formulas fail explicitly.

### Native profiles exercised by the probe

These formula sections match the [native probe's argument profiles](./scripts/native-smoke.ts) for Codex CLI 0.160.0 and native Pi 1.0.0. Replace an existing section with the same name rather than declaring it twice. Select the actual native Pi executable, not a wrapper that dispatches to another daemon.

```toml
[formulas.codex]
executable = "codex"
argv = ["exec", "--model", "{{model}}", "-c", 'model_reasoning_effort="{{effort}}"', "-c", 'shell_environment_policy.inherit="all"', "--sandbox", "workspace-write", "--json", "--ephemeral", "{{prompt}}"]

[formulas.pi-native]
executable = "/absolute/path/to/native-pi"
argv = ["--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-session", "--offline", "--model", "{{model}}", "--thinking", "{{effort}}", "--tools", "bash,read", "--mode", "json", "-p", "{{prompt}}"]
```

The Pi profile deliberately isolates extensions and context files and limits tools to the probe's Bash/read path. It does not demonstrate Scent or a general-purpose production prompt setup. Submit with the matching native model syntax, for example:

```sh
bee spawn worker "$TASK_ID" --repo "$REPO" --beads-db "$DB" --actor operator \
  --harness pi-native --model openai-codex/gpt-6-astra --effort low
```

Codex's tested model was `gpt-6-astra` with low effort. Model availability and authentication belong to your account. See [dated native results](../../docs/harness-capabilities.md#current-native-probe-evidence) for precisely what passed.

## Scheduling

All unfinished linked tasks must be ready and available to the request's identity. Closed tasks count as satisfied; if every task is closed, Colony closes the request without starting an agent. Eligible requests use the highest urgency among their linked tasks: P0 before P1.

Within a priority tier, the default `bv-pagerank` mode uses the best linked task's PageRank from BV's complete insights map. It does not use the capped triage recommendation list. BV reads an owned export of the explicitly selected tracker; invalid or incomplete rankings fail visibly. Install `bv` for this mode. Set `ranking = "fifo"` to order ties by request creation time and then ID without BV.

The default maxima are four attempts per repository, two per kind, and two per launch location. `[limits.kinds]` overrides individual kind maxima. Zero prevents new launches. The location bucket is the Git worktree containing the recorded launch directory, or the canonicalized external directory; later process directory changes do not move the bucket. `colony list` exposes the active policy.

Edit canonical limits and run `wake` to apply them. Lowering a maximum never stops existing workers. New work waits until live occupancy falls below every applicable maximum, including workers retained across sleep or registration removal.

## Completion and retries

Colony acquires ready task claims using the request's friendly identity immediately before launch. The worker receives that identity and the selected tracker. If another actor reserves a task before acquisition, the request waits. A conflict after acquiring part of a multi-task request stops that request and releases only its own acquired claims.

A live bee owns its completion point: task closure alone does not terminate it. After exit or `bee finish success`, tasks determine completion. Unfinished work consumes a retry even when its exit code is zero or it reported success. An explicit blocked report instead settles for caller attention without automatic retry. `max_retries = 3` permits four total attempts. `retry_delay_ms` defaults to 250 and accepts 0–60000; the next awake polling pass after that deadline can dispatch a replacement. Sleeping pauses this progression.

Before replacement or terminal cleanup, Colony verifies that the old owned execution has stopped. It clears only recorded, unfinished claims still assigned to that identity, preserving closed tasks, native blocked states and other actors' claims. The replacement keeps the friendly identity and receives a new attempt ID. Exhaustion closes the request with an explicit reason; logs and detailed process receipts remain in server state.

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
		"argv": ["--model", "{{model}}", "{{prompt}}"]
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

Operation evidence, bounded retention and crash uncertainty: `bun test lib/colony/src/history.smoke.test.ts`. The retry smoke additionally checks native failure capture, partial claim cleanup and offline history with the daemon stopped and tracker executable disabled.

Run from the Hive checkout. The process smoke also requires Node on `PATH` to exercise real process-title changes, as used by native Pi; installed Bee/Colony commands still run on Bun. The normal check does not run tests:

```sh
bun run check
bun test lib/colony/src
```

The smoke fixtures use real disposable Git repositories, Beads databases, sockets and processes. Scripted workers make failure and timing cases reproducible; those results do not by themselves prove a native provider launch.

| Boundary | Focused command |
| --- | --- |
| Offline submission and manual launch | `bun test lib/colony/src/producer.smoke.test.ts lib/colony/src/launch.smoke.test.ts` |
| Registry, sleeping, draining and daemon control | `bun test lib/colony/src/daemon.smoke.test.ts lib/colony/src/lifecycle.smoke.test.ts` |
| Eligibility, priority, PageRank and capacity | `bun test lib/colony/src/scheduler.smoke.test.ts lib/colony/src/ranking.smoke.test.ts` |
| Self-report, partial blocking and live completion | `bun test lib/colony/src/self-report.smoke.test.ts` |
| Claims, retry and observed descendants | `bun test lib/colony/src/retry.smoke.test.ts lib/colony/src/processes.smoke.test.ts` |
| Restart, stale sockets and competing daemons | `bun test lib/colony/src/recovery.smoke.test.ts lib/colony/src/server-ownership.smoke.test.ts` |
| Retained tracker and request authority | `bun test lib/colony/src/authority.smoke.test.ts` |
| Policy validation and revision capture | `bun test lib/colony/src/config.smoke.test.ts` |
| Offline facts, runtime inspection and JSON output | `bun test lib/colony/src/bee-inspection.smoke.test.ts lib/colony/src/inspection.smoke.test.ts` |

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
