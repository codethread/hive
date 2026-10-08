# Architecture

Hive's product packages are independently replaceable. They cooperate through commands and protocols; `@hive/shared` is the only permitted cross-package import, and Shared imports no product package. `.oxlintrc.json` enforces this direction.

## Package responsibilities and seams

| Package | Owns | Interface to other packages |
| --- | --- | --- |
| `lib/colony` | Bee request interface and Colony CLI, daemon ownership, repository scheduling, task claims, retries, supervision and private persistence | Imports Shared contracts; consumes spawn beads through native `br`; launches native harness executables |
| `lib/shared` | Contracts used by both CLI and runtime: recipes, formulas, spawn requests, repository endpoints and daemon messages; common native Beads I/O | Exports types, boundary parsers and small shared operations; owns no daemon, scheduler or CLI presentation |
| `lib/honeycomb` | Worktree discovery and lifecycle, including canonical-root decisions | Public command interface; Bee and Colony obtain the canonical root through `honeycomb root` |
| `lib/waggle` | Classifier discovery and execution | Independent `waggle` CLI; it does not decide runtime scheduling or mutate requests |
| `lib/busybee` | Workflow navigation, task visits and per-run checkpoints | XState chooses transitions; native `br` stores work and checkpoints; optional Bee requests delegate execution to Colony |
| `lib/tooling` | Repository maintenance commands | Development tooling, independent of the Bee execution path |

Use Shared when actual consumers need the same contract. Spawn-request representation belongs there because submission, offline inspection and execution must agree; scheduling and terminal formatting stay in Colony. Busy Bee's workflow rules remain independent of Colony execution; its [specification](../lib/busybee/SPEC.md) defines progression and checkpoint authority.

## Bee and Colony request flow

```text
bee spawn -> canonical .hive configuration + selected Beads database
                 | capture recipe, identity, related tasks
                 v
             spawn bead <----------------------- bee status/list/stop
                 |                                    Beads only
                 v
Colony: awake colony -> prepare -> rank -> claim -> reserve attempt
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

The [spawn-request model](../lib/shared/src/spawn-request.ts) owns the Beads representation: labels, captured recipe, friendly assignee and task links. Consumers decode it before making decisions. The [glossary](../GLOSSARY.md) distinguishes requests, running bees, attempts and historical observations.

Outcome and resolution labels project native closure, explicit acknowledgment comments and supersession for native Beads queries. The [spawn state contract](./agents/spawn-requests.md) defines their finite values, authority, saved presets and recovery when publication is interrupted. Scheduling continues to use native lifecycle facts and private checkpoints.

Colony's [configuration loader](../lib/colony/src/config.ts) reads canonical `.hive/bees.toml` and `.hive/bees/*/bee.toml` with sibling prompts. Central definitions take precedence; discovery diagnostics are data for the CLI, not runtime logging. Shared owns shape and effective-configuration validation, while Colony owns filesystem discovery and precedence. Bee submission uses the resulting kind defaults and captures a recipe. Bee inspection and closure need only the selected Beads endpoint, not configuration or a daemon. Closing the request does not directly signal a process: an awake colony reconciles the closure, while an asleep colony waits for wake. Last-recorded observations are deliberately separate from native request state and are never used as execution authority.

Colony control commands cross a different seam. The [client](../lib/colony/src/client.ts) selects a socket and state directory and speaks the [Shared protocol](../lib/shared/src/colony-protocol.ts). The [Colony server](../lib/colony/src/server.ts) owns registration, awake intent and policy changes. Only `add` and `wake` start an absent server. The CLI launches [`runtime.ts`](../lib/colony/bin/runtime.ts) as a separate process communicating over a Unix socket. Detached supervisors start through [`worker.ts`](../lib/colony/bin/worker.ts) and outlive CLI calls and daemon exits.

[Colony's machine](../lib/colony/src/colony.ts) owns awake, draining and asleep states. [Dispatch](../lib/colony/src/dispatch.ts) performs one preparation, ranking and launch pass; the [request machine](../lib/colony/src/request.ts) owns claims, execution, settlement and bounded retries across passes. Sleeping drains the current pass without cancelling its effects, then disables polling and reconciliation while detached workers continue.

## Authority and persistence

| Data | Authority and owner | What a reader may conclude |
| --- | --- | --- |
| Task state and assignment | Native Beads, changed by task actors and Colony's explicit claim/release operations | Whether work is complete or available to the request identity |
| Spawn request and closure | Native Beads; Bee creates/closes requests, Colony consumes and settles them | The requested recipe, identity, work links and request outcome; closure alone does not prove a worker has stopped |
| Last Colony observation | Native timestamped Beads comment published by Colony | What was last observed; it may be stale while asleep or unavailable |
| Canonical defaults and policy | Canonical `.hive/bees.toml` and `.hive/bees/` kind files | Defaults for new recipes and policy loaded on wake/reset; existing captured recipes do not change |
| Registration, checkpoints and revision history | Colony's private SQLite store | Durable awake intent, attempts and recovery checkpoints; transient policy is reloaded from canonical configuration on recovery |
| Attempt receipt and process artifacts | Colony and its detached supervisor | Captured invocation and ownership evidence for one attempt; process fingerprints must be verified before adoption or signalling |
| Child stdout and stderr | Per-attempt local log files | Execution diagnostics; they are not copied into Beads |
| Post-run assessments | Colony-private inspection checkpoints and artifacts | Advisory evidence about a settled request, not task acceptance, request outcome or permission to change work |

Repository discovery, tracker selection and execution directory are independent. The canonical root identifies repository-wide configuration and registration. The selected absolute Beads path identifies tracker authority. The recipe's optional execution directory controls the harness working directory and capacity bucket. Choosing one never implicitly replaces another.

The supervisor owns only its process tree and local artifacts; it does not reconcile Beads or write the daemon database. Colony reserves an attempt before starting the supervisor and persists the verified supervisor handoff before granting execution permission. Recovery uses the same ownership checks before adoption, cleanup or replacement. Detailed commands, defaults and supported limitations are in the [Bee and Colony guide](../lib/colony/README.md).

## Post-run advice

Colony enrolls launched requests for configured post-run inspection at terminal settlement. The auxiliary queue reuses detached supervision and verified process ownership, but owns separate report authority and a bounded lifecycle. Assessment failure does not change the target request, release its claims or spend its retry budget. Auxiliary inspections are not task requests and cannot recursively enroll themselves.

The nurse reads retained assessments through Colony's offline inspection interface and discusses patterns with ct. Both roles use the [welcoming-hive heuristic](agents/welcoming-hive.md). Their observations are not accepted practices or actionable work: ct authorizes change tasks, and filed specialist evidence remains subject to the existing label-stewardship and curation contract. The [operator guide](../lib/colony/README.md#inspect-finished-bees) covers selection and retrieval.

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

The [CLI](../lib/honeycomb/src/cli.ts) composes live dependencies and handles output and exit. Commands coordinate lifecycle operations; domain code holds models and pure policy. Injected [services](../lib/honeycomb/src/services.ts) let tests replace Git, filesystem, hooks, interaction and time while retaining lifecycle logic.

## Honeycomb state and safety

Honeycomb has no application database. Git's registered worktrees, branches and working-tree status provide repository state; filesystem markers record successful pool initialization. Configuration supplies policy, not a second registry of existing worktrees.

The canonical checkout anchors configuration and default-branch decisions and is protected from removal. Regular worktrees are created and removed; pooled worktrees retain their directories and switch between working branches and reserved placeholder branches. Destructive operations check observed Git state before proceeding rather than trusting shell-session state.

## Engine and shell responsibilities

The engine owns worktree policy and lifecycle mutations. `shell-init zsh` and `shell-init nu` generate a single `wk` function that runs `honeycomb --interactive pick` with a temporary `HONEYCOMB_CD_FILE` and changes the shell's directory when the engine writes one; it holds no worktree, git, multiplexer, or prompt logic. Agents call the CLI directly and never pass `--interactive`, so they cannot move the user's focus or close sessions.

Configured setup and its rollback run inside the engine, so every caller gets the same ready-or-rolled-back result. Multiplexer state never determines whether a worktree exists or is safe to remove; sessions are an integration that only `--interactive` may touch.

## Waggle's classification boundary

[Waggle](../lib/waggle/README.md) discovers checkout-owned `classifiers/*.toml`. Each definition contains a when-to-use description, required string inputs and named choice questions. Discovery is local; execution validates supplied evidence before a single Typesafe SDK request. Filesystem, environment, transport and terminal access are injected at the CLI boundary. It imports no other Hive product package.

Waggle does not collect code context, publish PR comments or enforce review thresholds. Its answers direct review attention; the caller verifies findings. Its readable mode prints JSON; `--json` follows the output contract below.

## CLI output contract

Human output uses stdout for results and stderr for progress and errors. With `--json`, success and failure each produce exactly one stdout document; stderr stays silent.

- Success has `ok: true` and `kind`. Failure has `ok: false`, `kind`, `reason`, `message` and known context, such as the target or completed steps. Callers branch on `ok`, `kind` and `reason`, never message text.
- Output that would otherwise reach the terminal, such as setup-command lines and warnings, is captured into the document.
- Exit codes keep their meaning in both modes.
- Commands throw typed errors carrying `kind`, `reason` and context. One boundary handler formats failures for the selected mode, normalizing unrecognized throws into the same shape.

Honeycomb's [`dispatch`](../lib/honeycomb/src/main.ts) is the reference implementation, with its error model in [`errors.ts`](../lib/honeycomb/src/errors.ts).
