# Bee and Colony

Colony launches agents from spawn requests stored in Beads. A spawn request is distinct from the task beads it asks an agent to work on. Each request carries a captured recipe and a friendly assignee; Colony applies the current named harness formula in the canonical worktree's `bees.toml`.

## Install and try it

Requirements: Bun, Bash (for installed wrappers), Git, `br`, `honeycomb`, and a native harness executable with working model access. Default ranking also needs `bv`; set `ranking = "fifo"` in `bees.toml` to run without BV. `colony init` writes a Codex formula, so its default quickstart needs native Codex on `PATH`. Other harnesses need a formula using their supported flags. See [harness evidence](../../docs/harness-capabilities.md) for verified versions and limits.

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

## Create requests

Initialize configuration once in a repository with an existing Beads tracker:

```sh
bun run lib/colony/bin/colony.ts init \
  --repo /path/to/repository --owner ct --model gpt-6-astra
bun run lib/colony/bin/bee.ts spawn worker <task-id> \
  --repo /path/to/repository --beads-db "$BEADS_DB" --actor <requester> --json
```

`init` creates `bees.toml` in the canonical worktree and refuses to overwrite an existing file. `spawn` works while Colony is unavailable or asleep. It captures the kind's effective recipe on a new spawn bead without claiming its task beads. Later edits to defaults do not change that captured recipe.

Use `--model`, `--effort`, `--harness`, `--prompt` or `--cwd` to change the recipe for one request, and `--identity` to supply its friendly assignee. Otherwise Bee mints a friendly name. The requester is the actor creating the bead; the human owner comes from configuration. Neither is the spawned agent's identity.

Repository discovery defaults to the current directory and can be selected with `--repo`. Tracker selection is explicit through `--beads-db` or `BEADS_DB`. Blocked tasks can be submitted and wait for eligibility. Unknown kinds, human reservations and overlapping open spawn requests fail. A named harness may be supplied by a later Colony formula update; Bee does not require it to exist in the current file's formula map.

## Inspect or close requests offline

```sh
bun run lib/colony/bin/bee.ts status <spawn-id> --repo /path/to/repo --beads-db /path/to/beads.db
bun run lib/colony/bin/bee.ts list --all --repo /path/to/repo --beads-db /path/to/beads.db --json
bun run lib/colony/bin/bee.ts stop <spawn-id> --repo /path/to/repo --beads-db /path/to/beads.db --actor operator
```

These commands use only Beads and repository discovery. They need neither `bees.toml` nor a running daemon. `list` defaults to open requests; `--all` includes closed ones. `status` reports the captured recipe, friendly identity, linked task status and native readiness, request closure and the timestamp of the latest recorded Colony observation. Native task readiness is separate from Colony's capacity and claim decisions.

Observations may be stale. A request can be closed while its last observation still says running; neither `status` nor `list` queries a process or daemon. `stop` closes a validated spawn request using `--actor` or `BD_ACTOR` and preserves an already-closed request's reason. An awake colony then stops the owned execution and releases eligible claims. An asleep colony does that only after wake. Colony writes changing, minimal observations as native comments; full output and execution logs stay local.

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

`colony add` registers a repository asleep; `colony list` shows membership, intended activity and observed state. `add`, `wake`, `sleep` and `remove` all accept `--repo` and `--beads-db`. Adding existing membership preserves its activity. Durable awake colonies resume after daemon restart; sleeping ones remain asleep. Each fresh wake reloads canonical `bees.toml`.

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

## Output for people and scripts

Without `--json`, successful commands print readable results on stdout and diagnostics on stderr. With `--json`, each finite command emits one JSON object on stdout and leaves stderr empty. Successful payloads retain their fields at the top level with `ok: true` and a `kind`; failures have `ok: false`, `kind: "error"`, `reason` and `message`. Exit status is zero for success, one for operational failure and two for CLI usage errors.

| Command result                            | `kind`                                              |
| ----------------------------------------- | --------------------------------------------------- |
| Bee submission                            | `spawn_created`                                     |
| Bee status, list, stop                    | `request_status`, `request_list`, `request_stopped` |
| Daemon status or colony list              | `status`                                            |
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

The request must be open, assigned to a friendly identity, and carry the separate labels `system`, `bee` and `agent:<kind>`. Link task beads with `related` dependencies. All unfinished tasks must be ready and available to this identity. The request description is a JSON recipe:

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

The canonical `bees.toml` maps harness names to executable and argument tokens:

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

Tasks determine completion. An execution that exits with unfinished work consumes a retry even when its exit code is zero. `max_retries = 3` permits four total attempts. `retry_delay_ms` defaults to 250 and accepts 0–60000; the next awake polling pass after that deadline can dispatch a replacement. Sleeping pauses this progression.

Before replacement or terminal cleanup, Colony verifies that the old owned execution has stopped. It clears only recorded, unfinished claims still assigned to that identity, preserving closed tasks and other actors' claims. The replacement keeps the friendly identity and receives a new attempt ID. Exhaustion closes the request with an explicit reason; logs and detailed process receipts remain in server state.

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

Overrides last until a fresh wake, daemon recovery wake or explicit reset reloads canonical `bees.toml`. History survives those resets. Canonical loads record their source without inventing a file author. Configuration commands do not start a daemon; update and reset require an awake colony.

## Verification

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
