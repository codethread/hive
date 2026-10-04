# Architecture

Hive's product packages are independently replaceable tools. Bee submits and inspects requests through Beads. Colony controls repository scheduling and its hosting daemon. Ghost executes that runtime. Honeycomb manages Git worktrees, and Waggle runs repository-owned semantic classifiers.

Product packages do not import one another. `@hive/shared` is the only permitted cross-package import, and it imports no product package. `.oxlintrc.json` enforces that direction. Runtime cooperation uses explicit command or protocol interfaces instead of reaching into another package's implementation.

## Package responsibilities and seams

| Package | Owns | Interface to other packages |
| --- | --- | --- |
| `lib/colony` | Public `bee` and `colony` CLIs, request submission and offline inspection, daemon client and presentation | Imports Shared models; invokes Ghost's command entry to launch or start the server; sends typed requests over the selected Unix socket |
| `lib/ghost` | Daemon ownership, repository colony lifecycle, scheduling, task claims, retries, execution supervision and private persistence | Implements the Shared control protocol; consumes spawn beads through native `br`; launches native harness executables |
| `lib/shared` | Contracts used by both CLI and runtime: recipes, formulas, spawn requests, repository endpoints and daemon messages; common native Beads I/O | Exports types, boundary parsers and small shared operations; owns no daemon, scheduler or CLI presentation |
| `lib/honeycomb` | Worktree discovery and lifecycle, including canonical-root decisions | Public command interface; Bee and Colony obtain the canonical root through `honeycomb root` |
| `lib/waggle` | Classifier discovery and execution | Independent `waggle` CLI; it does not decide runtime scheduling or mutate requests |
| `lib/tooling` | Repository maintenance commands | Development tooling, independent of the Bee execution path |

Shared is used where two actual consumers need the same meaning. It is not a home for code merely because it could be reusable. A new Ghost scheduling rule stays in Ghost; a terminal formatter stays in Colony. A change to the representation of a spawn request belongs in Shared because submission, offline inspection and runtime execution must agree.

## Bee and Colony request flow

```text
bee spawn -> canonical bees.toml + selected Beads database
                 | capture recipe, identity, related tasks
                 v
             spawn bead <----------------------- bee status/list/stop
                 |                                    Beads only
                 v
Ghost: awake colony -> prepare -> rank -> claim -> reserve attempt
                                                |
                                                v
                                  detached supervisor -> native harness
                                                |
                                                v
                            local receipt, ownership evidence and logs
                                                |
                      awake reconciliation <----+
                          | stop, release claims, retry or settle
                          v
                minimal native Beads observations and closure
```

The [spawn-request model](../lib/shared/src/spawn-request.ts) owns the Beads representation: discovery labels, kind label, captured recipe, friendly assignee and related task links. Consumers decode that representation before making their own decisions. The [glossary](../GLOSSARY.md) distinguishes the request from a running bee, an execution attempt and a historical observation.

Bee submission reads kind defaults from canonical `bees.toml` and captures a recipe. Bee inspection and closure need only the selected Beads endpoint, not configuration or a daemon. Closing the request does not directly signal a process: an awake colony reconciles the closure, while an asleep colony waits for wake. Last-recorded observations are deliberately separate from native request state and are never used as execution authority.

Colony control commands cross a different seam. The [client](../lib/colony/src/client.ts) selects a socket and state directory and speaks the [Shared protocol](../lib/shared/src/colony-protocol.ts). The [Ghost server](../lib/ghost/src/server.ts) owns registration, awake intent and policy changes. Only `add` and `wake` start an absent server. The client launches the Ghost command entry as a subprocess; it does not import Ghost modules.

Inside Ghost, [Colony's XState machine](../lib/ghost/src/colony.ts) owns awake, draining and asleep transitions. [Dispatch](../lib/ghost/src/dispatch.ts) performs one ordered preparation, ranking and launch pass. [The request machine](../lib/ghost/src/request.ts) owns claims, execution, settlement and bounded retries across passes. Those are different lifetimes: sleeping drains the current pass without cancelling its effects, then disables polling and reconciliation while detached workers continue.

## Authority and persistence

| Data | Authority and owner | What a reader may conclude |
| --- | --- | --- |
| Task state and assignment | Native Beads, changed by task actors and Ghost's explicit claim/release operations | Whether work is complete or available to the request identity |
| Spawn request and closure | Native Beads; Bee creates/closes requests, Ghost consumes and settles them | The requested recipe, identity, work links and request outcome; closure alone does not prove a worker has stopped |
| Last Colony observation | Native timestamped Beads comment published by Ghost | What was last observed; it may be stale while asleep or unavailable |
| Canonical defaults and policy | Canonical `bees.toml` | Defaults for new recipes and policy loaded on wake/reset; existing captured recipes do not change |
| Registration, checkpoints and revision history | Ghost's private SQLite store | Durable awake intent, attempts and recovery checkpoints; transient policy is reloaded from canonical configuration on recovery |
| Attempt receipt and process artifacts | Ghost and its detached supervisor | Captured invocation and ownership evidence for one attempt; process fingerprints must be verified before adoption or signalling |
| Child stdout and stderr | Per-attempt local log files | Execution diagnostics; they are not copied into Beads |

Repository discovery, tracker selection and execution directory are independent. The canonical root identifies repository-wide configuration and registration. The selected absolute Beads path identifies tracker authority. The recipe's optional execution directory controls the harness working directory and capacity bucket. Choosing one never implicitly replaces another.

The supervisor owns only its process tree and local artifacts; it does not reconcile Beads or write the daemon database. Ghost reserves an attempt before starting the supervisor and persists the verified supervisor handoff before granting execution permission. Recovery uses the same ownership checks before adoption, cleanup or replacement. Detailed commands, defaults and supported limitations are in the [Bee and Colony guide](../lib/colony/README.md).

## Honeycomb's execution boundary

```text
Human / automation / shell picker
                |
                v
CLI -> command dispatch -> lifecycle workflows
                               |          |
                               v          v
                         Domain policy   Injected services
                                              |
                                              v
                                      Git / files / hooks
```

The [CLI](../lib/honeycomb/src/cli.ts) composes live dependencies and handles terminal output and process exit. Commands coordinate add, remove, finish and query operations; application helpers handle reusable repository, branch and pool workflows. Domain code holds models and pure policy decisions. Workflows access external state through the [service interfaces](../lib/honeycomb/src/services.ts), allowing tests to replace Git, filesystem, hooks, interaction and time without replacing the lifecycle logic.

## Honeycomb state and safety

Honeycomb has no application database. Git's registered worktrees, branches and working-tree status provide repository state; filesystem markers record successful pool initialization. Configuration supplies policy, not a second registry of existing worktrees.

The canonical checkout anchors configuration and default-branch decisions and is protected from removal. Regular worktrees are created and removed; pooled worktrees retain their directories and switch between working branches and reserved placeholder branches. Destructive operations check observed Git state before proceeding rather than trusting shell-session state.

## Engine and shell responsibilities

The engine owns worktree policy and lifecycle mutations. `shell-init zsh` and `shell-init nu` generate a single `wk` function that runs `honeycomb --interactive pick` with a temporary `HONEYCOMB_CD_FILE` and changes the shell's directory when the engine writes one; it holds no worktree, git, multiplexer, or prompt logic. Agents call the CLI directly and never pass `--interactive`, so they cannot move the user's focus or close sessions.

Configured setup and its rollback run inside the engine, so every caller gets the same ready-or-rolled-back result. Multiplexer state never determines whether a worktree exists or is safe to remove; sessions are an integration that only `--interactive` may touch.

## Waggle's classification boundary

[Waggle](../lib/waggle/README.md) discovers checkout-owned `classifiers/*.toml`. Each definition contains a when-to-use description, required string inputs and named choice questions. Discovery is local; execution validates supplied evidence before a single Typesafe SDK request. Filesystem, environment, transport and terminal access are injected at the CLI boundary. It imports no other Hive product package.

Waggle does not collect code context, publish PR comments or enforce review thresholds. Its answers direct review attention; the caller verifies findings. The POC prints readable JSON for successes and follows the machine-mode failure contract below when `--json` is supplied.

## CLI output contract

Every Hive CLI has two audiences. Humans and TTY usage get readable output: results on stdout, progress and errors on stderr. Machine callers pass `--json` and get exactly one JSON document on stdout, whether the command succeeds or fails; stderr stays silent, so a caller never has to read or interleave two streams.

- The document is an object with a boolean `ok`. Success payloads carry `ok: true` and a `kind`. Failures carry `ok: false`, a `kind`, a machine-readable `reason`, a human `message` and whatever the command knew before failing, such as the target it resolved or the steps that already completed. Callers branch on `ok`, `kind` and `reason`, never on message text.
- Output that would otherwise reach the terminal, such as setup-command lines and warnings, is captured into the document.
- Exit codes keep their meaning in both modes.
- Commands do not format their own failures. They throw typed errors that carry their `kind` and `reason`, attaching context as they unwind, and one handler at the command boundary formats anything thrown for the active mode. An unrecognized throw is normalized into the same shape.

Honeycomb's [`dispatch`](../lib/honeycomb/src/main.ts) is the reference implementation, with its error model in [`errors.ts`](../lib/honeycomb/src/errors.ts).
