---
name: beads-meta
description: Understand and operate beads_rust (`br`), including its issue model, readiness graph, workflow policy, SQLite/JSONL persistence, machine contracts, coordination diagnostics, and source layout. Use when working with a `.beads` tracker, invoking `br`, designing tracker automation, or investigating beads_rust behavior.
---

# Beads meta

Use `br` as a local-first, dependency-aware task tracker and inspect `beads_rust` when behavior is unclear. `beads_rust` is vendored on this machine.

Treat `br` and the vendored `beads_rust` repository as the sole subject. Do not infer behavior from similarly named trackers or compatibility assumptions.

## Establish the contract

The installed binary and vendored source can be different versions. Start by checking:

```nu
br --version
br capabilities --format json
```

Use this authority order:

1. For the installed executable, use `br capabilities --format json --command "<path>"` and `br <path> --help`.
2. For source behavior, read `src/cli/mod.rs` for Clap declarations and `src/main.rs` for dispatch.
3. Follow dispatch into `src/cli/commands/`, then into the domain or storage module that owns the behavior.
4. Use `docs/CLI_REFERENCE.md` and focused files under `docs/` for explanation, not exhaustive enumeration.

The detailed inventory is in [references/command-source-map.md](references/command-source-map.md). Read it when selecting a command, locating an implementation, auditing API coverage, or building automation.

## Mental model

```text
operator or agent
      |
      +--> CLI (`src/cli/mod.rs`) --> command handlers (`src/cli/commands/`) --+
      |                                                                    |
      +--> optional MCP (`src/mcp/`) --> tools and resources ---------------+
                                                                           |
                   +-------------------------------------------------------+
                   v
workflow policy + issue model + storage/query layer
                   |
                   v
SQLite runtime state <---- import/export/merge ----> JSONL interchange state
```

- SQLite is the normal runtime store. `src/storage/schema.rs` defines its tables and indexes; `src/storage/sqlite.rs` owns queries and mutations.
- JSONL is the portable interchange representation. `src/sync/` owns import, export, merge, reconciliation, witnesses, path safety, and backup history.
- Startup can auto-import a fresher JSONL generation. Successful mutations normally auto-flush back to JSONL. Global flags and config can disable either phase.
- Explicit `br sync` modes never run Git. `br vcs-status` is a separate, read-only Git visibility probe.
- Writes use transactions and workspace locks. Multi-issue operations are atomic within one repository when their handler uses the batch transition path; routed multi-repository work is not a distributed transaction.
- `.beads/policy.yaml` defines workflow policy. `.beads/config.yaml`, user config, environment variables, and CLI flags participate in configuration; inspect precedence in `src/config/mod.rs`.

## Core data model

`src/model/mod.rs` is the canonical model.

| Concept | Semantics |
| --- | --- |
| Issue | ID, title and long-form fields; status, priority and type; assignee/owner; estimate and dates; source routing; labels, dependencies and comments for interchange/display |
| Status | Built-ins are `open`, `in_progress`, `blocked`, `deferred`, `draft`, `closed`, `tombstone`, and `pinned`; custom statuses are accepted and policy can constrain them |
| Priority | Integer P0–P4: critical, high, medium, low, backlog |
| Type | Built-ins are `task`, `bug`, `feature`, `epic`, `chore`, `docs`, and `question`; custom types are representable |
| Dependency | Directed typed edge: the source issue depends on the target issue; identity is source + target + type |
| Label | Indexed many-to-many classification attached to issues |
| Comment | Durable issue comment; database row IDs are local, while sync identity uses issue, time, author, and body |
| Event | Local issue mutation/audit history exposed with issue details where requested |
| Tombstone | Durable deletion representation created by `br delete` |

Important issue text fields are distinct:

- `description`, `design`, `notes`: narrative fields.
- `acceptance_criteria`: delivery criteria; Markdown checklists can be edited item-by-item and emitted as structured `acceptance_items` by `show`.
- `prerequisites`: a separate preparation checklist. It is not a dependency edge.
- `agent_context`: open JSON for inherited governing instructions. It is not general searchable issue metadata.

`br` does not expose a general arbitrary issue-metadata field. Dependency edges can store JSON metadata, but current list/show/query projections do not provide a public edge-metadata filter. For automation, define indexed namespaced labels appropriate to the application—for example, `harness:claude` and `effort:high` for daemon dispatch.

## Readiness and the graph

Use `br ready` as the canonical actionable-work query. By default, a ready issue:

- belongs to the configured ready status group, which defaults to `open`;
- has no unresolved blocking relationship;
- is not hidden by a future `defer_until` time gate;
- is not excluded as a template, pinned context, tombstone, or other non-work record; and
- matches requested assignee, label, type, priority, or parent filters.

`src/model/mod.rs` defines which dependency types affect readiness. The blocking set is:

- `blocks`
- `parent-child`
- `conditional-blocks`
- `waits-for`

Non-blocking relationship types include `related`, `discovered-from`, `replies-to`, `relates-to`, `duplicates`, `supersedes`, and `caused-by`. Custom types are representable. Blocking edges are cycle-checked; use `br dep cycles` to inspect graph health.

Use graph surfaces deliberately:

- `ready`: actionable rows, optionally `--brief` for work selection.
- `blocked`: issues held by unresolved blockers.
- `dep list/tree/cycles`: edge-level inspection.
- `graph`: what an issue unblocks, or active connected components.
- `epic status`: parent-child progress and close eligibility.
- `show`: full selected issue details, relation projections, checklist items, and derived subtree rollup.

## Claims, scheduling, and coordination

`br update <id> --claim` performs the tracker-side claim transition atomically under current workflow checks. Claims are assignment/status state, not renewable leases.

- `scheduler` is read-only. It ranks a bounded ready set using explainable evidence such as priority, dependency impact, fairness, contention, and stale-claim signals.
- `coordination status` is read-only. It diagnoses `in_progress` claims and can consume offline reservation and agent snapshots; it does not contact an external coordination service or reclaim work.
- Reclaiming stale work remains an explicit, auditable operator/agent decision.
- `audit coordination` can persist normalized coordination evidence in `.beads/interactions.jsonl`.

Labels are the default routing mechanism for automation. They live in a normalized table with indexes on `label` and `issue_id`; repeated `--label` filters use AND semantics and `--label-any` uses OR semantics.

```nu
br ready --label harness:claude --label effort:high --brief --json
```

## Workflow policy

`src/close_policy.rs` loads and validates `.beads/policy.yaml`; storage enforces policy in the same transaction as status mutation.

Policy can define:

- accepted statuses and strict transition graphs;
- issue-type-specific transition additions;
- the ready status group;
- required fields and completed prerequisite/acceptance checklists;
- fresh transition comments;
- external gate results, including reviewer counts;
- repository and scoped capacity limits; and
- hierarchy-aware or weighted capacity counting.

`gate report` records transition-scoped external verdicts. `capacity` manages audited issue-specific exemptions. Gate results, capacity exemptions, and capacity occupancy are project-local database state rather than JSONL issue fields.

Do not bypass a refused transition by rewriting storage. Inspect the policy, `br gate list`, capacity evidence in `stats` or `coordination status`, and the structured error.

## Persistence and recovery

Normal work should rely on automatic freshness checks and auto-flush, then use explicit sync diagnostics when needed:

```nu
br sync --status --json
br sync --flush-only --json
```

Choose explicit modes by intent:

| Intent | Surface |
| --- | --- |
| Export SQLite to JSONL | `sync --flush-only` |
| Import JSONL additively | `sync --import-only` |
| Make SQLite exactly match JSONL | `sync --import-only --rebuild` |
| Reconcile independently changed SQLite and JSONL | `sync --merge` |
| Repair drift without deletion | Preview with `sync --reconcile --dry-run`, then rerun as `sync --reconcile` to mutate |
| Produce a hash-bound, exact-ID recovery plan | `sync --reconcile-additive` |
| Inspect freshness/coverage | `sync --status` |
| Inspect JSONL integrity chunks | `sync --witness` |
| Inspect whether Git sees the JSONL | `vcs-status` |
| Inspect/restore export backups | `history` |

Treat `--force`, rebuild, merge conflict choices, repair, restore, and reviewed-plan application as exceptional operations. Read their current capability/help output and inspect the complete receipt before mutation.

## Machine interfaces

Prefer structured mode in automation:

```nu
br ready --brief --json
br schema commands --format json
br capabilities --format json --command "ready"
```

- `--json` is global. Many commands also support `--format json|toon` and `--robot`.
- Output envelopes are command-specific. Discover them with `br schema commands`; do not assume every collection is a top-level array.
- Machine-readable errors go to stdout on non-zero exit; diagnostics and non-fatal warnings go to stderr. See `docs/agent/ROBOT_MODE.md` and `docs/agent/ERRORS.md`.
- `br schema` is explicitly unstable. Generate or validate against the running binary rather than copying an old schema.
- `serve` is available only with the `mcp` build feature. It exposes local stdio tools, resources, and prompts backed by the same storage and policy paths.

## Operating workflow

1. Resolve the workspace with `br where`; do not initialize one unless the task explicitly calls for it.
2. Discover the installed contract with `br capabilities` or focused help.
3. Select with `br ready --brief --json`, then inspect the chosen item with `br show <id> --json`.
4. Claim through `br update <id> --claim --json` when ownership is appropriate.
5. Record discovered work with `create` and an explicit relationship or parent.
6. Complete through policy-aware commands such as `update`, `close`, `defer`, or `reopen`.
7. Inspect `br sync --status --json`; use `br sync --flush-only` as an idempotent final export check when the repository expects JSONL to be committed.

Never assume this workflow grants permission to claim, mutate, repair, commit, or push. Repository and user instructions still control authorization.
