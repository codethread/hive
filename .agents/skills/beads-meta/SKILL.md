---
name: beads-meta
description: Investigate beads_rust (`br`) behavior or use advanced tracker features such as workflow policy, inherited context, coordination, machine contracts, and sync/recovery. Use for CLI research, troubleshooting, or tracker automation—not routine bead creation, claiming, progress updates, or closure covered by AGENTS.md.
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

`br` does not expose a general arbitrary issue-metadata field. Dependency edges can store JSON metadata, but current list/show/query projections do not provide a public edge-metadata filter. For automation, define indexed namespaced labels appropriate to the application—for example, `harness:claude` and `effort:high` for daemon dispatch.

## Authoring and handing off work

Separate the task brief from its implementation history. Read the existing bead before editing; preserve relevant context rather than replacing it with the latest progress report.

| Field | What to put here |
| --- | --- |
| `description` | Problem, intended outcome, scope/non-goals, and relevant code or documentation pointers. Include enough context to start without the original conversation. |
| `design` | Current approach, constraints, and rationale for important decisions. Set with `update --design`; `create` has no design flag. |
| `acceptance_criteria` | Observable delivery outcomes, preferably `- [ ]` Markdown items that can be verified independently. Avoid vague items such as "works correctly". |
| `prerequisites` | Preparation needed before implementation, such as confirming a fixture or obtaining a decision. Other tracked work that must finish first belongs in a dependency edge, not only this text. |
| `notes` | Progress, discoveries, blockers, verification evidence, and the next handoff action. Use `update --append-notes` to retain earlier entries. |
| `agent_context` | JSON governing instructions specific to a parent/subtree, such as constraints shared by its children. Keep repository-wide rules in `AGENTS.md`; do not use this as a progress log or searchable routing metadata. |

For a small task, a description and concrete acceptance criteria are enough. Add design, prerequisites, or shared context only when they convey information the next agent needs. Child beads need their own scope and completion criteria; a parent link does not copy its narrative fields.

Example: capture a scoped documentation task with a separate preparation checklist. The Nushell variable retains the created ID for follow-up edits:

```nu
let bead = (br create --title "Document Honeycomb pick cancellation" --type docs --priority 2
    --description "Explain how cancelling the picker affects the shell directory. Update the shell integration guidance; do not change picker behavior. Inspect lib/honeycomb/README.md and lib/honeycomb/src/commands/pick.ts."
    --acceptance-criteria "- [ ] Shell integration guidance explains that cancelling leaves the current directory unchanged"
    --prerequisites "- [ ] Confirm the existing cancellation behavior in code and tests"
    --json | from json)
br update $bead.id --design "Describe the existing behavior alongside the shell wrapper usage, without duplicating the full picker reference." --json
br show $bead.id --json
```

For longer descriptions, use `--description-file <path>` on `create` or `update` to preserve Markdown verbatim. Whole-field updates replace content; do not reach for `--force` to discard accumulated context. Prefer `--add-acceptance "New outcome"`, `--check-acceptance "unique item text"`, and `--uncheck-acceptance "unique item text"` for acceptance edits. Check/uncheck selectors also accept comma-separated 1-based item numbers. `show --json` exposes parsed `acceptance_items`; tick an item only after verification and append the command/result or other evidence to notes. Prerequisites have no equivalent item-edit flags: preserve the rest of the checklist when replacing it with `--prerequisites`.

Checklists describe preparation and completion; they do not create dependency edges or enforce transitions by themselves. Record tracked blockers with `br dep add <issue> <depends-on>`. On handoff, append what changed, what remains, the blocker if any, and a concrete next action; update the design if the intended approach changed.

### Inherited agent context

Set `--agent-context` on `create` or `update` with inline JSON such as `'{"constraints":["Keep this feature CLI-only"]}'`, or `@path/to/context.json` / `@path/to/context.yaml` (YAML is normalized to JSON). These are instructions for the consuming agent, not executable policy or a replacement for repository/user instructions.

Inherited emission is opt-in through `inherited_context.enabled: true` in `.beads/config.yaml` (nested YAML) or the `BR_INHERITED_CONTEXT` environment override. Hive does not currently enable it in repository config. When enabled, `show --json` includes `inherited_context` blocks from the root ancestor (preferring the topmost epic) and immediate parent, root first; intermediate ancestors are not all included. Blocks retain their source IDs and are not merged into one JSON object. Inspect the returned context and explicitly read any other ancestor whose design or instructions the task needs; do not assume ordinary descriptions, designs, or notes are inherited.

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
