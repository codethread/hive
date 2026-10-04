# beads_rust command and source map

All paths in this document are relative to the `beads_rust` repository root. `beads_rust` is vendored on this machine.

This map follows the vendored source at version 0.7.0 (`Cargo.toml`). An installed `br` can be older or built with different features. For executable behavior, compare `br --version`, `br capabilities --format json`, and focused `--help` output with the source.

## Where the API comes from

| Question | Authoritative starting point | Follow-up |
| --- | --- | --- |
| What commands and flags exist? | `src/cli/mod.rs` (`Cli`, `Commands`, argument structs, subcommand enums) | `br capabilities --format json`, focused `--help` |
| Which handler runs? | `src/main.rs` command dispatch | Matching file in `src/cli/commands/` |
| What data exists? | `src/model/mod.rs` | `src/format/output.rs` for public output projections |
| How is it stored or queried? | `src/storage/schema.rs`, `src/storage/sqlite.rs` | Focused tests under `tests/` |
| How does persistence/sync work? | `src/sync/`, `src/cli/commands/sync.rs` | `docs/CLI_REFERENCE.md` sync section |
| How are workflows constrained? | `src/close_policy.rs` | transition enforcement in `src/storage/sqlite.rs` |
| What can automation parse? | `src/cli/commands/capabilities.rs`, `src/cli/commands/schema.rs` | `src/output/`, `src/error/structured.rs`, `docs/agent/` |
| What does MCP expose? | `src/mcp/mod.rs` | `src/mcp/tools.rs`, `src/mcp/resources.rs`, `src/mcp/prompts.rs` |

`docs/CLI_REFERENCE.md` is the main narrative command reference. It is useful but not exhaustive; the Clap tree in `src/cli/mod.rs` and generated capabilities are the inventory contract.

## Global CLI controls

Declared on `Cli` in `src/cli/mod.rs` and applied during startup in `src/main.rs`:

| Flag                  | Effect                                                         |
| --------------------- | -------------------------------------------------------------- |
| `--db <PATH>`         | Override database discovery; also available through `BEADS_DB` |
| `--actor <NAME>`      | Attribute audit/event mutations                                |
| `--json`              | Request global JSON output                                     |
| `--no-daemon`         | Compatibility no-op in the current direct-process design       |
| `--no-auto-flush`     | Skip post-mutation JSONL export                                |
| `--no-auto-import`    | Skip startup freshness import                                  |
| `--allow-stale`       | Permit operation despite stale-database detection              |
| `--lock-timeout <MS>` | Set SQLite busy/write-lock timeout                             |
| `--no-db`             | Use JSONL-only fallback mode                                   |
| `-v`, `-vv`           | Increase diagnostic logging                                    |
| `-q`, `--quiet`       | Suppress non-error human output                                |
| `--no-color`          | Disable terminal color                                         |

Output format can also be command-specific through `--format`, `--robot`, `BR_OUTPUT_FORMAT`, and `TOON_DEFAULT_FORMAT`. Resolve precedence through `src/output/context.rs` and `src/cli/mod.rs` rather than assuming all commands expose the same flags.

## 1. Workspace and configuration

| Command | Shape and purpose | Implementation |
| --- | --- | --- |
| `init` | Create a `.beads` workspace; accepts prefix and force controls | `src/cli/commands/init.rs` |
| `where` | Print the resolved active `.beads` directory after discovery and redirects | `src/cli/commands/where.rs` |
| `info` | Report workspace, schema, engine, projection, release, and diagnostic metadata | `src/cli/commands/info.rs` |
| `config` (`list`, `get`, `schema`, `set`, `delete`, `edit`, `path`) | Inspect or mutate layered configuration; `delete` has alias `unset`; `schema` enumerates recognized keys and defaults | `src/cli/commands/config.rs`, `src/config/mod.rs` |
| `agents` | Check, add, remove, or update the generated workflow section in `AGENTS.md`; supports dry-run | `src/cli/commands/agents.rs` |

Workspace discovery, route redirects, and precedence:

- `src/config/mod.rs`: `.beads` discovery, CLI/environment overrides, path resolution, project/user/default layer merging.
- `src/config/routing.rs`: redirect files and multi-project route resolution.
- `src/sync/path.rs`: sync path containment and external-path safety.
- `docs/ARCHITECTURE.md`: narrative architecture and configuration precedence.
- `docs/TROUBLESHOOTING.md`: discovery and configuration failure diagnosis.

## 2. Issue lifecycle and content

| Command | Shape and purpose | Implementation |
| --- | --- | --- |
| `create` | Create one issue with status/type/priority, long-form fields, dates, labels, parents/dependencies, source routing, and inherited agent context | `src/cli/commands/create.rs` |
| `q` | Quick capture: create and print an ID-focused result | `src/cli/commands/q.rs` |
| `show` | Hydrate detailed issue output, relations, comments/events, checklist items, inherited context, and subtree rollup | `src/cli/commands/show.rs`, `src/format/output.rs` |
| `update` | Batch field edits, claim, assignment, status transitions, labels, parent, checklist edits, transition comments, and attribution | `src/cli/commands/update.rs` |
| `close` | Policy-aware close, optional force/bypass evidence and next-work suggestions | `src/cli/commands/close.rs` |
| `reopen` | Reopen terminal work through transition policy | `src/cli/commands/reopen.rs` |
| `delete` | Create a tombstone rather than silently dropping issue history | `src/cli/commands/delete.rs` |
| `defer` | Move issues to deferred status and optionally set a time gate | `src/cli/commands/defer.rs` |
| `undefer` | Return deferred issues to active workflow; dispatched to `defer.rs` | `src/cli/commands/defer.rs` |
| `comments` (`add`, `list`) | Append or list issue comments; bare `comments <ID>` also lists; top-level alias `comment` | `src/cli/commands/comments.rs` |

Model and mutation internals:

- `src/model/mod.rs`: `Issue`, `Status`, `Priority`, `IssueType`, `Dependency`, `DependencyType`, `Comment`, `Event`.
- `src/model/acceptance.rs`: Markdown acceptance checklist parsing and item edits.
- `src/storage/sqlite.rs`: transactional create/update, policy enforcement, relation hydration, events, and comments.
- `src/format/output.rs`: detailed and summary output DTOs; output projections are narrower than storage models.

## 3. Selection, triage, and reporting

| Command | Shape and purpose | Implementation |
| --- | --- | --- |
| `list` | Broad filtering, sorting, pagination, labels, hierarchy, dates, selected fields, and human/JSON/TOON/CSV projections | `src/cli/commands/list.rs`, `src/cli/commands/list_fields.rs` |
| `ready` | Canonical actionable-work query; supports assignee, AND/OR labels, type, priority, parent recursion, configurable ready statuses, and `--brief` | `src/cli/commands/ready.rs` |
| `blocked` | List blocked issues and blocker evidence | `src/cli/commands/blocked.rs` |
| `search` | Search IDs, titles, descriptions, and comments with list-style filters | `src/cli/commands/search.rs` |
| `count` | Count filtered issues, optionally grouped | `src/cli/commands/count.rs` |
| `stale` | Find issues whose update age exceeds a threshold | `src/cli/commands/stale.rs` |
| `stats` / `status` | Project totals, breakdowns, recent activity, and configured capacity evidence | `src/cli/commands/stats.rs` |
| `scheduler` | Read-only deterministic ranking over ready candidates with evidence; alias `schedule` | `src/cli/commands/scheduler.rs` |
| `coordination status` | Read-only claim-health diagnosis using local issue evidence and optional offline snapshots; top-level alias `coord` | `src/cli/commands/coordination.rs`, `src/coordination.rs` |
| `query` (`save`, `run`, `list`, `delete`) | Persist and execute named list-filter sets; no free-form query language | `src/cli/commands/query.rs` |
| `orphans` | Find open issues referenced in commits; optional repair flow | `src/cli/commands/orphans.rs` |
| `changelog` | Render closed issues as changelog output | `src/cli/commands/changelog.rs` |
| `lint` | Check issues against expected template sections | `src/cli/commands/lint.rs` |

Canonical readiness and blocking code:

- `src/model/mod.rs`: `DependencyType::affects_ready_work` and `DependencyType::is_blocking`.
- `src/storage/sqlite.rs`: `get_ready_issues*`, `query_ready_issue_candidates_with_projection`, `get_blocked_issues`, blocker cache maintenance.
- `src/storage/schema.rs`: ready indexes and `blocked_issues_cache` schema.
- `src/close_policy.rs`: configurable ready status group validation.

Selection caveats:

- `scheduler` ranks; it does not claim or mutate.
- `coordination status` advises; it does not reclaim or contact an external service.
- `ready --brief` changes columns, not membership or order.
- `search`, `list`, `ready`, and `blocked` do not necessarily share the same output envelope. Inspect `br schema commands`.

## 4. Dependencies, hierarchy, and labels

| Command | Shape and purpose | Implementation |
| --- | --- | --- |
| `dep add` | Add a typed edge: source issue depends on target; accepts edge JSON metadata | `src/cli/commands/dep.rs` |
| `dep import` | Bulk-import edge objects or issue records containing dependencies from JSONL | `src/cli/commands/dep.rs` |
| `dep remove` | Remove a typed edge; type is required when the pair is ambiguous; alias `dep rm` | `src/cli/commands/dep.rs` |
| `dep list` | Inspect down, up, or both directions and optionally filter by type | `src/cli/commands/dep.rs` |
| `dep tree` | Traverse from a root with direction/depth controls; text or Mermaid output | `src/cli/commands/dep.rs` |
| `dep cycles` | Detect blocking cycles; archived cycles can be included | `src/cli/commands/dep.rs` |
| `graph` | Render the dependents graph for one issue or all active components; compact or DOT output | `src/cli/commands/graph.rs` |
| `epic status` | Report child completion and close eligibility | `src/cli/commands/epic.rs` |
| `epic close-eligible` | Dry-run or atomically close eligible epics, optionally with transition comments | `src/cli/commands/epic.rs` |
| `label` (`add`, `remove`, `list`, `list-all`, `rename`) | Maintain indexed issue labels and global label vocabulary/counts | `src/cli/commands/label.rs` |

Storage details:

- `src/storage/schema.rs`: `dependencies` and `labels` tables; label indexes on label and issue ID; dependency indexes by source, target, type, and blocking lookup.
- `src/storage/sqlite.rs`: label candidate queries use equality/`IN` plus grouping for AND filters.
- `src/model/mod.rs`: dependency edge metadata is stored as optional JSON text and survives JSONL interchange.
- `src/format/output.rs`: `IssueDetails` uses `IssueWithDependencyMetadata`, which carries target identity/status/type but not arbitrary edge metadata despite the DTO name.

Do not design routing around edge metadata: there is no public metadata predicate in `dep list`, `list`, `ready`, or saved queries. Prefer namespaced labels for indexed routing.

## 5. Workflow policy, gates, and capacity

| Command | Shape and purpose | Implementation |
| --- | --- | --- |
| `gate report` | Append a pass/fail result from a named provider for a gate and target transition | `src/cli/commands/gate.rs` |
| `gate list` | Show recorded results and computed requirements for upcoming transitions | `src/cli/commands/gate.rs` |
| `capacity exempt` | Grant an audited, issue-specific exemption for one named status/group capacity | `src/cli/commands/capacity.rs` |
| `capacity renew` | Extend an active exemption | `src/cli/commands/capacity.rs` |
| `capacity revoke` | End an exemption while retaining audit history | `src/cli/commands/capacity.rs` |
| `capacity exemptions` | List current state and optional append-only exemption history | `src/cli/commands/capacity.rs` |

Policy source map:

- `src/close_policy.rs`: policy YAML model and validation; custom statuses/transitions; class transitions; required fields; status groups; gates; capacity limits, scopes, counting, and exemptions.
- `src/storage/sqlite.rs`: `enforce_workflow_transition_batch_in_tx`, gate-result storage, capacity evaluation, occupancy, warnings, and atomic mutations.
- `src/cli/commands/create.rs`, `update.rs`, `close.rs`: command-facing validation and policy evidence.
- `docs/CLI_REFERENCE.md`: detailed `ready`, `gate`, and `capacity` examples.
- `docs/GH384_ACCEPTANCE_MATRIX.md`: capacity acceptance matrix.

Policy-backed storage is not uniform: issue state and relations travel through JSONL, while gate results, capacity exemption history, and scoped occupancy are local database state.

## 6. SQLite/JSONL synchronization and recovery

`sync` is flag-driven rather than subcommand-driven. Its argument contract is `SyncArgs` in `src/cli/mod.rs`; orchestration is in `src/cli/commands/sync.rs`; mechanics live under `src/sync/`.

| Mode | Purpose |
| --- | --- |
| `sync --flush-only` | Export SQLite issues and relations to JSONL, with overwrite guards and backup history |
| `sync --import-only` | Validate and additively import JSONL |
| `sync --import-only --skip-invalid-records` | Salvage valid records with protected source backup and detailed rejection receipt |
| `sync --import-only --rebuild` | Treat JSONL as authoritative and remove database-only records, preserving applicable tombstones |
| `sync --merge` | Three-way merge base snapshot, SQLite state, and JSONL; conflict policy must be explicit |
| `sync --reconcile [--dry-run]` | Lossless additive timestamp-based repair that never deletes or rewrites JSONL |
| `sync --reconcile-additive` | Exact-ID, hash-bound, read-only-by-default recovery planning; apply requires reviewed token |
| `sync --migrate-source-repo-path` | Reconcile while planning portable workspace path normalization; reviewed apply |
| `sync --status` | Read-only freshness, hash, coverage, and workspace-health report; does not probe Git |
| `sync --witness` | Read-only deterministic chunk/root hashes over JSONL bytes |

Associated commands:

| Command | Shape and purpose | Implementation |
| --- | --- | --- |
| `history [list]` | List JSONL backups; bare `history` means list | `src/cli/commands/history.rs`, `src/sync/history.rs` |
| `history diff <FILE>` | Compare one backup with its target JSONL | same |
| `history restore <FILE>` | Restore a selected backup with overwrite protection | same |
| `history prune` | Enforce count, age, and optional byte budgets | same |
| `vcs-status` | Explicit read-only inspection of JSONL visibility in Git; bounded and no-prompt | `src/cli/commands/vcs.rs` |

Sync source map:

- `src/main.rs`: startup auto-import and post-mutation auto-flush phases.
- `src/cli/commands/mod.rs`: shared auto-import/auto-flush context and warning reporting.
- `src/sync/mod.rs`: staleness, JSONL reading/writing, import/export, merge, and reconciliation primitives.
- `src/sync/history.rs`: pre-export backup snapshots and pruning.
- `src/sync/path.rs`: path authorization and secure snapshots.
- `src/sync/witness.rs`: Merkle-style JSONL witnesses.
- `tests/e2e_sync_git_safety.rs`: verifies sync modes perform no Git mutation.
- `tests/e2e_vcs_status.rs`: validates the separate VCS observation surface.

## 7. Diagnostics and maintenance

| Command | Shape and purpose | Implementation |
| --- | --- | --- |
| `doctor` | Read-only diagnostics by default; flat flags include `--quick`, `--robot-triage`, `--selftest`, `--bundle`, and explicit repair modes | `src/cli/commands/doctor.rs` |
| `doctor capabilities` | Emit doctor-specific detector/fixer/write-scope contract | `src/cli/commands/doctor_subsystems/capabilities_doctor.rs` |
| `doctor robot-docs` | Print the doctor automation handbook | `src/cli/commands/doctor_subsystems/surface.rs` |
| `doctor health` | Cheap liveness summary | `src/cli/commands/doctor_subsystems/surface.rs` |
| `doctor ls` | List retained doctor runs | `src/cli/commands/doctor_subsystems/run_dir.rs` |
| `doctor undo` | Dry-run or restore a retained doctor run | `src/cli/commands/doctor_subsystems/surface.rs` |
| `doctor explain` | Explain one finding, live evidence, fixers, and next commands | `src/cli/commands/doctor_subsystems/surface.rs` |
| `doctor migrate-schema` (`recover`, `plan`, `apply`, `undo`, `heal`) | Receipt-bound legacy storage recovery and schema migration lifecycle | `src/cli/commands/doctor_subsystems/schema_migration.rs`, `schema_heal.rs` |
| `version` | Build/version information and optional update check | `src/cli/commands/version.rs` |
| `upgrade` | Check/install release updates; available with `self_update` feature | `src/cli/commands/upgrade.rs` |
| `completions` | Generate Bash, Zsh, Fish, PowerShell, or Elvish completions; alias `completion` | `src/cli/commands/completions.rs` |

Other doctor subsystem files under `src/cli/commands/doctor_subsystems/` separate bundle creation, execution engine, mutation chokepoints, refusal gates, exit codes, run directories, and self-tests. Treat doctor receipts and dry-run/apply tokens as operational contracts; do not bypass them with direct database edits.

## 8. Agent and machine contracts

| Command | Shape and purpose | Implementation |
| --- | --- | --- |
| `capabilities` | Emit global flags, features, command tree/details, aliases, safety, environments, and exit-code categories; filter with `--command "path"` | `src/cli/commands/capabilities.rs` |
| `schema` | Emit JSON Schemas and command envelope paths; explicitly unstable | `src/cli/commands/schema.rs` |
| `robot-docs guide` | Emit concise automation guidance; top-level alias `robot_docs` | `src/cli/commands/robot_docs.rs` |
| `audit` (`record`, `coordination`, `label`, `log`, `summary`) | Maintain append-only agent interaction records in `.beads/interactions.jsonl` | `src/cli/commands/audit.rs` |
| `serve` | Start the optional stdio MCP server; available only with the `mcp` feature | `src/mcp/mod.rs` |

Machine-output source map:

- `src/output/context.rs`: mode detection, JSON/TOON rendering, stdout behavior.
- `src/format/output.rs`: serializable public DTOs.
- `src/error/structured.rs`: stable error codes, exit category mapping, human/JSON rendering.
- `docs/agent/ROBOT_MODE.md`: format selection and stdout/stderr contract.
- `docs/agent/SCHEMA.md`: schema generation and TOON folding.
- `docs/agent/ERRORS.md`: structured errors, lock timeouts, and partial-batch behavior.
- `docs/AGENT_INTEGRATION.md`: agent workflows and MCP overview; treat ecosystem integrations as optional context rather than core `br` behavior.

MCP surface:

- Tools in `src/mcp/tools.rs`: `list_issues`, `show_issue`, `create_issue`, `update_issue`, `close_issue`, `manage_dependencies`, `project_overview`.
- Resources in `src/mcp/resources.rs`: project info, issue-by-ID through `beads://issue/{id}`, schema, labels, ready/blocked/in-progress/deferred/bottleneck issue views, coordination status, graph health, and recent events.
- Prompts in `src/mcp/prompts.rs`: `triage`, `status_report`, `plan_next_work`, `polish_backlog`.
- `tests/e2e_mcp_protocol.rs`: discovery-surface assertions.

## Dispatch exceptions, aliases, and feature gates

- `status` is a separate top-level variant dispatched to `stats.rs`.
- `undefer` dispatches to `defer.rs`.
- `vcs-status` dispatches to `vcs.rs`.
- `serve` bypasses `src/cli/commands/` and enters `src/mcp/mod.rs`.
- Top-level aliases: `comment`, `completion`, `coord`, `robot_docs`, `schedule`.
- Nested aliases: `dep rm`, `config unset`, `doctor robot_docs`.
- `serve` requires Cargo feature `mcp`.
- `upgrade` requires Cargo feature `self_update`, enabled in the default feature set.

## Documentation gaps to expect

When auditing the vendored 0.7.0 tree, do not treat the CLI reference table of contents as a complete API index:

- `scheduler`, `coordination status`, and `vcs-status` have body sections but are omitted from its table of contents.
- `dep import`, `config schema`, several `doctor` subcommands/flags, Elvish completion, and convenience forms such as bare `history` are incompletely represented in the hand-written command tables.
- `src/cli/mod.rs` and generated `capabilities` are therefore the safer inventory sources.

## Focused investigation recipe

When asked whether `br` supports a capability:

1. Check the installed command path with `br capabilities --format json --command "<path>"`.
2. Find the command/argument declaration in `src/cli/mod.rs`.
3. Find the dispatch arm in `src/main.rs`.
4. Read the complete handler in `src/cli/commands/` or `src/mcp/`.
5. Follow model, policy, storage, sync, or output types named by the handler.
6. Confirm with focused tests and the generated schema when output shape matters.
7. Distinguish stored data, publicly projected data, and queryable/indexed data; they are not equivalent.
