# Architecture

Hive's product packages are independently replaceable. They cooperate through commands and protocols; `@hive/shared` and `@hive/beads` are the permitted cross-package imports. Shared may consume Beads; Beads imports no Hive package, and Shared imports no product package. [Import rules](../.oxlintrc.json) enforce this direction and prohibit cross-package relative imports.

## Package responsibilities and seams

| Package | Owns | Interface to other packages |
| --- | --- | --- |
| `lib/beads` | The subset of the native Beads contract consumed by Hive, with native and in-memory adapters | Exports an injected service; owns no Hive scheduling or workflow policy |
| `lib/colony` | Bee request interface and Colony CLI, daemon ownership, repository scheduling, task claims, retries, supervision and private persistence | Imports Shared contracts; consumes spawn beads through native `br`; launches native harness executables |
| `lib/shared` | Consumed contracts: recipes, formulas, spawn requests, repository endpoints, daemon messages, workflow preview payloads and changelogs | Exports types, boundary parsers and small shared operations; owns no daemon, scheduler or product-specific CLI presentation |
| `lib/honeycomb` | Worktree discovery and lifecycle, including canonical-root decisions | Public command interface; Bee and Colony obtain the canonical root through `honeycomb root` |
| `lib/waggle` | Classifier discovery and execution | Independent `waggle` CLI; it does not decide runtime scheduling or mutate requests |
| `lib/busybee` | Workflow navigation, task visits and per-run checkpoints | XState chooses transitions; native `br` stores work and checkpoints; optional Bee requests delegate execution to Colony |
| `lib/hive-ui` | Read-only work-board HTTP projections, route-driven browser snapshots and presentation | Imports Beads services and Shared contracts; selects repository/database pairs explicitly or through public Colony status and calls Busy Bee's public preview command |
| `lib/scent` | Harness identity attribution and context | Installed command protocols and bundled Pi runtime; resolves native identity or adopts supplied Bee identity and preserves the selected tracker |
| `lib/beeswax` | Consumer repository setup, Beads environment/publication, tracker alerts and recovery guidance, JSONL merging/validation, Git/harness adapters and executable installation | Installed CLI; imports Shared/Beads contracts and invokes installed Honeycomb and Scent |
| `lib/tooling` | Repository test selection and release maintenance | Development tooling, independent of the Bee execution path |
| `lib/qlock` | Ticketed local command admission, queue state and foreground child execution | Independent CLI; merge-target queues obtain repository identity through `honeycomb root` |

Use Shared when actual consumers need the same contract. Spawn-request representation belongs there because submission, reads from the selected database and execution must agree; scheduling and request-specific terminal formatting stay in Colony. The consumed changelog schema, pure query and plain content formatter belong in Shared; records retain Markdown bodies alongside summaries, source revisions, breaking details and reviewed adoption notes. Product packages own their histories, Commander registration, streams/I/O and product-specific CLI presentation. Tooling parses the [authored commit records](releases.md#author-tool-changelog-records) into release candidates. Busy Bee's workflow rules remain independent of Colony execution; its [specification](../lib/busybee/SPEC.md) defines progression and checkpoint authority.

Beads' native adapter owns CLI arguments and output parsing. Consumer entry points inject that adapter; behavior tests inject its in-memory counterpart. Native conformance tests belong to Beads; filesystem, Git and process-boundary tests stay with the modules owning those effects.

Hive UI owns browser/API schemas and read models. Its startup endpoint allowlist comes from explicit configuration or Colony's public status command, without daemon lifecycle effects or access to Colony's private store. Native Beads supplies task/request facts; BV supplies hierarchy topology from the native-selected JSONL export. Hive UI owns BV invocation, source validation, ordinary-family membership and native card hydration; the [hierarchy source contract](design/hive-ui.md#hierarchy-source) defines this read boundary.

Busy Bee's public checkpoint identity and update time supply workflow provenance and freshness checks. The UI server calls `busybee system checkpoint`, `system preview` or `system simulate` with its selected repository/database pair and validates the Shared [checkpoint/inspection](../lib/shared/src/workflow-preview.ts) and [simulation](../lib/shared/src/workflow-simulation.ts) schemas. Busy Bee owns checkpoint interpretation, instruction rendering and stateless simulation. The browser holds user-supplied input, original event data and display snapshots; raw saved context and executable metadata stay in Busy Bee. This boundary needs no Colony state or simulation store. The [preview](../lib/busybee/SPEC.md#saved-state-preview) and [simulation](../lib/busybee/SPEC.md#simulation) contracts own projection and execution limits; the [UI design](design/hive-ui.md#workflow-preview) owns polling and local presentation.

## Bee and Colony request flow

Bee's [interactive launcher](../lib/colony/src/run.ts) composes a kind role and delivery protocol, mints an identity and renders a Shared harness formula. Direct runs have no request, claim, attempt or Colony authority; see `bee run --help`.

Managed delegation follows the separate request flow below:

```text
bee spawn -> canonical .hive configuration + selected Beads database
                 | capture recipe, identity, related tasks
                 v
             spawn bead <----------------------- bee status/result/stop
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

Bee submission starts a Busy Bee workflow and captures its driver request. Bee-dispatched visits create stage requests within that run. Shared owns the driver/stage assignment contract; launch receipts and explicit retries retain the assigned run or stage. Workflow definitions own work and acceptance, while captured recipes describe execution.

Workflow drivers consume ordinary capacity while waiting for workers. Colony neither suspends them nor reserves extra worker capacity; the user must raise quotas if drivers starve workers.

Bee binds each request to the submitting host. Only that host's Colony may execute or automatically reconcile it. Missing host provenance confers no execution authority. The [spawn state contract](./agents/spawn-requests.md) owns request states, query projections, retries and recovery.

The Shared [spawn-request model](../lib/shared/src/spawn-request.ts) owns native representation and decoding. Query labels project native facts; scheduling uses those facts and private checkpoints. The [glossary](../GLOSSARY.md) distinguishes requests, bees, attempts and observations.

Colony owns [configuration discovery and precedence](../lib/colony/src/config.ts); Shared owns shape and effective-configuration validation. Canonical configuration supplies defaults for new recipes and runtime policy.

Bee captures role and execution direction separately. Colony composes the [delivery protocol](../lib/colony/src/response-protocol.ts) and assignment instructions at launch; Shared supplies the producing-task pointer used by Colony and Busy Bee. [Response delivery](./agents/responses.md) owns the distinction between authored answers, progress and machine outcomes. Private drones retain separate protocols.

Bee inspection and closure use only the selected Beads endpoint. Closure records intent for an awake Colony to reconcile; it does not directly signal a process.

Colony's [client](../lib/colony/src/client.ts) uses the [Shared protocol](../lib/shared/src/colony-protocol.ts) to reach its [server](../lib/colony/src/server.ts), which owns registration, awake intent and policy changes. Detached [supervisors](../lib/colony/bin/worker.ts) outlive CLI calls and daemon exits.

[Colony's machine](../lib/colony/src/colony.ts) owns awake, draining and asleep states; [dispatch](../lib/colony/src/dispatch.ts) prepares, ranks and launches; the [request machine](../lib/colony/src/request.ts) owns claims, execution, settlement and retries. Sleeping disables reconciliation after the current pass while detached workers continue.

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
| Tracker alert and clearance | Beeswax's persistent user-local receipt, keyed by selected database path independently of Beads | Whether this endpoint has a recorded incident or verified clearance; not a distributed writer lock or proof of quiescence |

Repository discovery, tracker selection and execution directory are independent. The canonical root identifies repository-wide configuration and registration. The selected absolute Beads path identifies tracker authority. The recipe's optional execution directory controls the harness working directory and capacity bucket. Choosing one never implicitly replaces another.

The supervisor owns its process group and local artifacts; it does not reconcile Beads or write the daemon database. The harness inherits that group; processes that detach or create separate groups are outside managed cleanup. Colony reserves an attempt before starting the supervisor and persists the verified supervisor handoff before granting execution permission. Recovery uses the same ownership checks before adoption, cleanup or replacement. Detailed commands, defaults and supported limitations are in the [Bee and Colony guide](../lib/colony/README.md).

## Post-run advice

Post-run assessments reuse detached supervision but have separate report authority and lifecycle. Assessment failure does not alter the target request, claims or retry budget; auxiliary inspections cannot enroll themselves.

Colony's [nurse reconciler](../lib/colony/src/nurse.ts) selects completion-ordered batches and submits ordinary Bee/Busy Bee work. An explicitly configured ongoing health parent in native Beads holds the shared control record; conditional writes reserve one batch for its repository/tracker/host/state binding. This is local database coordination, not exclusion across independently synchronized trackers. The private store retains completion order and a resumable projection of native control and accepted coverage.

The ordinary audit task holds its frozen manifest and typed coverage receipt, separate from workflow outcome notes. Colony advances coverage only after verifying that receipt, the completed workflow, successful current request, exact authored response and delivered investigation tree. Unfinished or failed audits retain their batch. The [operator guide](../lib/colony/README.md#automatic-nurse-audits) owns activation and recovery.

Native [nurse health records](beads-labels.md#nurse-health-records) hold sourced provisional inquiries. A bounded snapshot supplies later drones with advisory evidence; their heuristic, deadline and mutation limits remain unchanged. Requests beneath the retained health parent are excluded from assessments by task lineage, including investigators of other kinds. The nurse uses the [welcoming-hive heuristic](agents/welcoming-hive.md) within its granted curation/investigation scope; fixes and changes to examined work require ct's separate authorization.

## Beeswax's setup boundary

Beeswax owns reusable setup and tracker publication. Product policy stays with its product: Bee owns its attention-query preset, and Hive's setup recipe composes the two CLIs.

Beeswax owns installation, regeneration and removal of selected harness integrations. Scent remains the replaceable identity runtime behind an installed command boundary; neither product imports the other. Claude Code and Codex callbacks invoke Scent directly. Beeswax's small Pi loader obtains Scent's bundled Node-compatible module through the CLI and runs its factory inside Pi, where it can update environment and register callbacks. Runtime bytes belong to Scent; repository adapters and ownership markers belong to Beeswax.

The committed Beeswax configuration and lock are accepted project intent; machine receipts only record local observations. Application policy stays in application hook files. Beeswax owns its marked validation sections, using the same configured actual hook pair in the application and permanent tracker checkout. Setup preserves the tracker's accepted files and history.

The [Beeswax guide](../lib/beeswax/README.md) owns setup, synchronization, tracker-alert delivery and installed recovery routes. Beeswax owns the reusable recovery procedure; [Beads integration](beads-integration.md) owns Hive's tracker exchange checkpoints, endpoint conventions and recovery authorization policy.

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

The engine owns worktree policy and mutations. Shell integration changes directory from the engine's result; worktree, Git and multiplexer decisions stay in the engine. Agents call the CLI without `--interactive`, leaving user focus and sessions untouched. See `honeycomb shell-init --help` for integration.

Configured setup and its rollback run inside the engine, so every caller gets the same ready-or-rolled-back result. Multiplexer state never determines whether a worktree exists or is safe to remove; sessions are an integration that only `--interactive` may touch.

## Waggle's classification boundary

[Waggle](../lib/waggle/README.md) discovers repository-owned classifiers and validates supplied evidence before a Typesafe SDK request. Filesystem, environment, transport and terminal access are injected at the CLI boundary.

The caller supplies context and verifies findings; Waggle's answers direct review attention without enforcing thresholds or publishing comments.

## CLI output contract

Human output uses stdout for results and stderr for progress and errors. With `--json`, success and failure each produce exactly one stdout document; stderr stays silent.

- Success has `ok: true` and `kind`. Failure has `ok: false`, `kind`, `reason`, `message` and known context, such as the target or completed steps. Callers branch on `ok`, `kind` and `reason`, never message text.
- Output that would otherwise reach the terminal, such as setup-command lines and warnings, is captured into the document.
- Exit codes keep their meaning in both modes.
- Commands throw typed errors carrying `kind`, `reason` and context. One boundary handler formats failures for the selected mode, normalizing unrecognized throws into the same shape.

Honeycomb's [`dispatch`](../lib/honeycomb/src/main.ts) is the reference implementation, with its error model in [`errors.ts`](../lib/honeycomb/src/errors.ts).
