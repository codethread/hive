# Beads specialist reference

Reference for complex triage, search, task authoring, workflow policy, coordination and `br` investigations. Daily operations remain in the root runbook; Hive's storage and publication contract is in [Beads integration](./beads-integration.md).

Use `br` as a local-first, dependency-aware task tracker and inspect the vendored `beads_rust` source when behavior is unclear. Source paths below are relative to that external repository, not Hive. Do not infer behavior from similarly named trackers or compatibility assumptions.

## Establish the contract

For CLI/source investigations, the installed binary and vendored source can be different versions. Start by checking:

```nu
br --version
br capabilities --format json
```

Use this authority order:

1. For the installed executable, use `br capabilities --format json --command "<path>"` and `br <path> --help`.
2. For source behavior, read `src/cli/mod.rs` for Clap declarations and `src/main.rs` for dispatch.
3. Follow dispatch into `src/cli/commands/`, then into the domain or storage module that owns the behavior.
4. Use `docs/CLI_REFERENCE.md` and focused files under `docs/` for explanation, not exhaustive enumeration.

The detailed inventory is in [Beads command and source map](./beads-command-source-map.md). Read it when selecting a command, locating an implementation, auditing API coverage, or building automation.

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
| Status | Hive policy permits `open`, `in_progress`, `in_review`, `blocked`, `draft`, `closed`, `tombstone`, and `pinned`; native custom statuses are representable and policy constrains allowed values |
| Priority | Integer P0–P4: critical, high, medium, low, backlog |
| Type | Built-ins are `task`, `bug`, `feature`, `epic`, `chore`, `docs`, and `question`; custom types are representable |
| Dependency | Directed typed edge: the source issue depends on the target issue; identity is source + target + type |
| Label | Indexed many-to-many classification attached to issues |
| Comment | Durable issue comment; database row IDs are local, while sync identity uses issue, time, author, and body |
| Event | Local issue mutation/audit history exposed with issue details where requested |
| Tombstone | Durable deletion representation created by `br delete` |

`br` does not expose a general arbitrary issue-metadata field. Dependency edges can store JSON metadata, but current list/show/query projections do not provide a public edge-metadata filter. For Hive automation, use the supported indexed namespaced labels in the [label taxonomy](./beads-labels.md); arbitrary strings do not create new routing behavior.

## Merge beads

A [merge bead](../GLOSSARY.md#beads) records one provider-hosted merge request. Create it once a draft or open merge request exists; first look for an existing record with the same provider URL, including closed records. Its title equals the merge request title, and it carries the registered `merge` label. Keep the title and description current with the provider record.

The description is a JSON object with exactly these fields:

| Field | Value |
| --- | --- |
| `url` | String: the provider URL of the merge request. |
| `branch` | String: the source branch being merged. |
| `resolution` | Exactly `"active"`, `"abandoned"`, or `"merged"`; always explicit, including at creation. |

For example:

```json
{
	"url": "https://github.com/example/repository/pull/42",
	"branch": "feat/example",
	"resolution": "active"
}
```

Use only these native status/resolution combinations:

| Provider state         | Native status | Description `resolution` |
| ---------------------- | ------------- | ------------------------ |
| Draft or open          | `open`        | `active`                 |
| Closed without merging | `closed`      | `abandoned`              |
| Merged                 | `closed`      | `merged`                 |

When the merge request resolves, update the JSON resolution and close its merge bead, retaining its task links. Task completion and review status do not determine merge resolution. Keep review states on the linked work tasks.

Merge beads are reference records, exempt from the normal claim/execute lifecycle: leave them unassigned and never claim them or send them to a worker. Ordinary agents authorized to maintain the reference may create it, update its fields and record its resolution without claiming it. Retain the root runbook's actor, `--owner ct` on creation, and publication rules. Exclude `merge` when selecting executable work. This is a documented convention; no merge-schema enforcement tooling is introduced. Hive UI parses references when reading them and presents malformed records as warning links on their tasks.

Keep notes and comments empty on merge beads. Record progress, discussion, review and verification on linked tasks; the merge bead contains only the reference contract, not a discussion protocol or central notice board.

### Link and find merge requests

Use a nonblocking `relates-to` edge from the merge bead to each task it delivers:

```sh
br dep add MERGE_BEAD_ID TASK_ID --type relates-to
```

Writers use this direction consistently. Consumers inspect both directions and identify merge beads by their `merge` label; association does not establish a prerequisite or close a task. For a known task, inspect its links, then read the matching merge records:

```sh
br dep list TASK_ID --direction both --type relates-to --format json
br show MERGE_BEAD_ID --json
```

For creation lookup or branch/URL discovery, include closed references so resolved merge requests remain findable:

```sh
br list --label merge --all --limit 0 --exclude-label system \
  --fields id,title,status,description --json
```

Match the JSON `url` for an existing merge request; use `branch` to locate its source branch. Native label/status queries and task relationships provide discovery without encoding another text protocol in task notes.

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

Example: a Pi agent captures a scoped documentation task with a separate preparation checklist. The Nushell variable retains the created ID for follow-up edits:

```nu
let bead = (br create --title "Document Honeycomb pick cancellation" --type docs --priority 2 --owner ct --actor pi
    --description "Explain how cancelling the picker affects the shell directory. Update the shell integration guidance; do not change picker behavior. Inspect lib/honeycomb/README.md and lib/honeycomb/src/commands/pick.ts."
    --acceptance-criteria "- [ ] Shell integration guidance explains that cancelling leaves the current directory unchanged"
    --prerequisites "- [ ] Confirm the existing cancellation behavior in code and tests"
    --json | from json)
br update $bead.id --actor pi --design "Describe the existing behavior alongside the shell wrapper usage, without duplicating the full picker reference." --json
br show $bead.id --json
```

For longer descriptions, use `--description-file <path>` on `create` or `update` to preserve Markdown verbatim. Whole-field updates replace content; do not reach for `--force` to discard accumulated context. Prefer `--add-acceptance "New outcome"`, `--check-acceptance "unique item text"`, and `--uncheck-acceptance "unique item text"` for acceptance edits. Check/uncheck selectors also accept comma-separated 1-based item numbers. `show --json` exposes parsed `acceptance_items`; tick an item only after verification and append the command/result or other evidence to notes. Prerequisites have no equivalent item-edit flags: preserve the rest of the checklist when replacing it with `--prerequisites`.

Checklists describe preparation and completion; they do not create dependency edges or enforce transitions by themselves. Record tracked blockers with `br dep add <issue> <depends-on>`. On handoff, append what changed, what remains, the blocker if any, and a concrete next action; update the design if the intended approach changed.

### Filed specialist evidence

A specialist evidence record is an archive, not executable work or authoritative practice guidance. Its label steward and content contract are registered in the [label taxonomy](./beads-labels.md#specialist-evidence-and-label-stewardship). Label authority and write scope are both required; scope may be standing authority in the registered specialist contract or an explicit curation assignment. General task assignment does not confer stewardship.

Within that scope, create the record with native `--type docs --status closed --owner ct`, the supplied actor (otherwise the harness actor), and the initial sourced entry in its description. This is a narrow exception to claiming executable work: the record starts filed and never enters the ready queue. `closed` means recorded, not that its question is resolved or its advice validated. Append subsequent dated evidence to notes without claiming or reopening the record. Unresolved questions and next evidence can remain in the archive; a concrete authorized investigation or change belongs in a separate actionable task under the normal work lifecycle.

The specialist contract defines relationships and discovery. Verify the saved content, labels and links, then follow the root runbook’s explicit publication checkpoints. Respect native policy failures; do not force creation or closure to file evidence.

### Inherited agent context

Set `--agent-context` on `create` or `update` with inline JSON such as `'{"constraints":["Keep this feature CLI-only"]}'`, or `@path/to/context.json` / `@path/to/context.yaml` (YAML is normalized to JSON). These are instructions for the consuming agent, not executable policy or a replacement for repository/user instructions.

Inherited emission is opt-in through `inherited_context.enabled: true` in `.beads/config.yaml` (nested YAML) or the `BR_INHERITED_CONTEXT` environment override. Hive does not currently enable it in repository config. When enabled, `show --json` includes `inherited_context` blocks from the root ancestor (preferring the topmost epic) and immediate parent, root first; intermediate ancestors are not all included. Blocks retain their source IDs and are not merged into one JSON object. Inspect the returned context and explicitly read any other ancestor whose design or instructions the task needs; do not assume ordinary descriptions, designs, or notes are inherited.

## Search and triage

Start with the delegated question or supplied bead, rather than selecting unrelated work. For an ordinary topic search:

```nu
br search "topic" --exclude-label system --json
```

Search covers IDs, titles, descriptions and comments. Use `br list --notes-contains "topic" --exclude-label system --json` when the evidence is in progress notes. Closed issues are hidden by default; use `--all` when investigating history or duplicates. Inspect `hidden_closed_count` and pagination fields before treating a search as exhaustive, and hydrate relevant permitted matches with `br show <id> --json`.

For WIP reports, query in-progress work rather than `ready`; report assignment, blockers and the latest progress/handoff notes. For historical questions, include closed records, state the date window and use closure dates rather than last-updated dates. Verify available date filters against installed help; filter structured results when needed.

For requested prioritization, follow the `honeybee` kind's command and escalation recipe in [.hive/bees/honeybee/system_prompt.md](../.hive/bees/honeybee/system_prompt.md): minimal next-pick output for one task, brief triage for comparisons, and scoped follow-up only for missing evidence. An empty next-pick result means no proven actionable recommendation, not necessarily an empty `br ready` set. Use `br ready` for canonical readiness confirmation when needed and `br show` for selected details. Viewer recommendations are not claims or authority to take work; respect assignments and `hitl` work. Return known answers without escalating into a broader investigation.

Keep ordinary queries scoped with `--exclude-label system` on `search`, `list` and `ready`, and the `work` recipe on viewer triage. Broader graph or diagnostic surfaces may expose reserved beads; inspect their filtering contract before using them outside an explicit system-maintenance assignment.

## Readiness and the graph

Use `br ready` as the canonical actionable-work query. By default, a ready issue:

- belongs to the configured ready status group, which defaults to `open`;
- has no unresolved blocking relationship;
- has no active time gate;
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

Labels classify work for queries; choose an execution kind explicitly with `bee spawn`, not an ordinary-task routing label. Labels live in a normalized table with indexes on `label` and `issue_id`; repeated `--label` filters use AND semantics and `--label-any` uses OR semantics.

```nu
br ready --exclude-label system --label area:honeycomb --brief --json
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

Follow [Beads integration](./beads-integration.md) for Hive's selected endpoint, publication checkpoints, fresh-clone setup and human-led conflict recovery. The modes below explain native `br` mechanics; they do not replace that runbook or authorize repairs.

`jsonl_newer` means the current JSONL differs from its last certified content hash. Unforced `sync --merge` also validates content and resumes pending synchronization receipts when the freshness flag is false. Merge updates SQLite and exports JSONL. Automatic export does not refresh the merge base; explicit flush does. The local three-way merge base is `.beads/beads.base.jsonl`; do not invent one for diverged state.

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
br ready --exclude-label system --brief --json
br schema commands --format json
br capabilities --format json --command "ready"
```

- `--json` is global. Many commands also support `--format json|toon` and `--robot`.
- Output envelopes are command-specific. Discover them with `br schema commands`; do not assume every collection is a top-level array.
- Machine-readable errors go to stdout on non-zero exit; diagnostics and non-fatal warnings go to stderr. See `docs/agent/ROBOT_MODE.md` and `docs/agent/ERRORS.md`.
- `br schema` is explicitly unstable. Generate or validate against the running binary rather than copying an old schema.
- `serve` is available only with the `mcp` build feature. It exposes local stdio tools, resources, and prompts backed by the same storage and policy paths.

### Progressive disclosure and output cost

Verified against `br 0.7.4`, build commit `3956ebb`, on 2026-10-13. Check the installed command's capabilities/help when these examples differ from its behavior; in this build, `--fields` help says CSV-only despite also selecting JSON/TOON fields.

Prefer native projection before caller-side `jq`: select only the fields needed for the next decision. Selection changes columns, not matching, readiness or page boundaries. Keep pagination/completeness metadata and hydrate relevant permitted beads when scope, blockers, instructions or evidence are missing. Full inspection and implementation still need the relevant task context; a summary is not a substitute.

| Surface | Disclosure and controls |
| --- | --- |
| `list`, `search`, `query run` | Default JSON/TOON rows include long issue fields, including accumulated notes, but not comments. `--fields` selects columns; `--limit`/`--offset` bound rows. |
| `ready` | `--brief` omits long free-text fields without changing readiness or order. |
| `show` | Full issue fields, all comments and relationship details. No `--fields`, `--brief` or `--no-comments`; use selected `list --id` reads for summaries. |
| `comments list` | All comment records, with author/time. No native limit or projection. Caller-side slices must report omitted history. |
| `create` | `--silent` prints only the created ID, even with `--json`; ordinary JSON echoes the created issue. Use when the ID alone confirms the needed result. |
| `update`, `close` | Normally compact confirmation receipts. `update --append-notes --json` additionally echoes the appended block **and the entire resulting notes field**; acceptance edits return the resulting checklist. No receipt field-selection flag. |
| `--quiet` | Suppresses successful human output, not explicit JSON/TOON. Silencing a receipt also loses confirmation evidence. |

For a known permitted ID, retrieve the brief separately from its history. `list` returns an `issues` envelope, not `show`'s array; it does not provide hydrated relationships, parsed checklist items or inherited context:

```nu
let id = "hv-…"
br list --id $id --all --json --fields id,title,status,priority,assignee,owner,description,updated_at
br list --id $id --all --json --fields id,notes,updated_at
br comments list $id --json
```

`br list --fields` supports only the columns listed by `br list --help`; use `br show $id --json` when design, acceptance checklists or relationship details are needed.

Use `--fields id,title,status,priority,assignee,owner` for topic-search summaries. Add `closed_at` for history, notes for progress/handoff questions, and relationship counts only when they inform selection. Preserve ordinary `--exclude-label system` filtering; projection is not permission to inspect reserved beads.

#### Caller-side jq recipes

Use `jq` for transformations native flags cannot express, not to discard a full list after fetching it. Filtering before the shell tool returns reduces agent context, but does not reduce `br`'s own hydration/serialization. Neither projection nor these recipes changes where evidence is recorded: follow the root runbook's notes/handoff policy.

A plain `br ... | jq ...` pipeline can hide `br`'s exit status, and projecting only success fields can erase structured errors or partial effects. This Nushell helper checks the producer first, preserves diagnostics, and exposes raw failure output before failing. Keep identifiers, assignment/status, warnings and confirmation fields in successful receipts:

```nu
def br-output [args: list<string>] {
    let result = (^br ...$args | complete)
    if $result.stderr != "" { print --stderr $result.stderr }
    if $result.exit_code != 0 {
        print $result.stdout
        error make {msg: $"br failed (exit ($result.exit_code)); inspect raw output before retrying."}
    }
    $result.stdout
}

# Recent comments with explicit history coverage; fetch all when older evidence matters.
br-output [comments list $id --json] | jq '{total: length, omitted: ([length - 3, 0] | max), comments: .[-3:]}'

# After an authorized notes append, omit only the repeated complete notes body.
br-output [update $id --actor pi --append-notes "Verified: focused checks passed" --json] | jq 'walk(if type == "object" and (.notes | type) == "object" then del(.notes.text) else . end)'
```

The append recipe retains `notes.appended`, `notes.applied`, before/after lengths and the rest of the receipt, including wrapped warnings. Substitute the supplied execution actor when present. A non-zero producer result is never filtered into a success-shaped acknowledgement; inspect its raw receipt before retrying a mutation that may already have taken effect.

## Investigation workflow

1. Preserve the delegated scope and selected `BEADS_DB`; use `br where` to confirm the endpoint when needed, not to initialize a workspace.
2. For uncertain CLI behavior, discover the installed contract with `br capabilities` or focused help.
3. Inspect the supplied permitted bead, or search/triage only when the request calls for it.
4. Hand unresolved evidence or policy questions back to the caller. Follow the command/source map only for an explicitly requested CLI/source investigation; distinguish source-version evidence from installed behavior.
5. Return relevant IDs, supporting evidence, recommendations and unresolved questions. Identify proposed mutations separately for the caller to perform under the daily runbook.

Investigation does not grant permission to claim, mutate, repair, commit or push.
