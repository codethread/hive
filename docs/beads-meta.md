# Beads specialist reference

Reference for complex triage, search, task authoring, workflow policy, coordination and `br` investigations. Daily operations remain in the root runbook; Hive's storage and publication contract is in [Beads integration](./beads-integration.md).

Use `br` as a local-first, dependency-aware task tracker and inspect the vendored `beads_rust` source when behavior is unclear. Source paths below are relative to that external repository, not Hive. Do not infer behavior from similarly named trackers or compatibility assumptions.

## Establish the contract

Use installed `br <command> --help` or `br capabilities --format json --command COMMAND` for syntax and behavior. Check `br --version` before relying on vendored source: it may differ from the executable. The [command/source map](./beads-command-source-map.md) locates implementation and native reference docs for authorized investigations.

SQLite is runtime state; JSONL is interchange state. Native sync does not run Git. Follow [Beads integration](./beads-integration.md) for Hive's endpoint and publication rules.

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

This is the field and lifecycle policy for executable work, whether agent-created or workflow-generated. Auto/manual describes creation provenance, not who performs the work. Responses, specialist evidence and merge references retain their own artifact contracts; they are not executable tasks.

Read the existing bead and applicable ancestor instructions before editing. Preserve useful historical content, including existing design/prerequisites, and governing instructions; this policy does not authorize record migration or deletion. For engine-managed work, observe the current runtime boundary below before changing fields or completing work.

| Field | What to put here |
| --- | --- |
| `description` | Current problem, intended outcome, scope/non-goals and context, including relevant code or documentation pointers. Keep the brief meaningful without the original conversation, including after completion. |
| `acceptance_criteria` | The dedicated acceptance checklist: concrete, independently verifiable outcomes, normally `- [ ]` Markdown items. Do not duplicate the checklist in the description. |
| `notes` | One consolidated current account: what was done and why, decisions, verification, limitations, unresolved work and next action. Keep it useful without reconstructing a transcript. |
| `design`, `prerequisites` | Leave unused for new work. Put current intent in the brief and approach/rationale in notes. Represent prerequisite work as separate tasks with blocking links. |
| `agent_context` | JSON governing instructions specific to a parent/subtree, such as constraints shared by its children. Keep repository-wide rules in `AGENTS.md`; do not use this as a progress log or searchable routing metadata. |
| `close_reason` | A readable, proof-bearing explanation of why the work can close, not a replacement for the current account in notes. |

**Current runtime boundary:** until workflow producers adopt this policy, preserve Busy Bee's stage result notes (`record-result`/`complete`), temporary run-note settlement intent and structured close reasons. Use narrative comments on managed work and, within your scope, the ordinary source task's current notes for evidence. Follow the active brief and `busybee complete --help`, then collect saved results as driver; Busy Bee alone closes groups and the run. Never directly close engine-managed work or replace its payload with prose. The [workflow specification](../lib/busybee/SPEC.md) owns that contract. This guidance changes no native YAML and does not establish producer compliance or class-scoped enforcement.

### Work lifecycle

1. Create agent-authored executable work explicitly with `--status draft`. Supply meaningful native acceptance criteria before **any** departure from draft, including a claim.
2. Claim only available authorized scope under the root runbook's actor, owner, assignment and reservation rules. Each child needs its own narrower scope and acceptance; parent links group work and blocking links order prerequisites. A parent link does not copy narrative fields.
3. Update notes at meaningful decisions, interruptions, handoffs and completion. Consolidate the current account rather than appending competing summaries; preserve useful findings and rationale when revising it. Keep verification specific about what passed, what was not checked and what remains to do.
4. Verify outcomes before ticking criteria. Close only when acceptance and required child work are complete, with the proof-bearing reason above. Leave unfinished work open with its blocker or next action. Landing acceptance waits for integration; a report completes only its own scope, not the work it examines.

Use `br create --help` and `br update --help` for field operations, including file-backed descriptions and incremental acceptance edits. Native presence/checklist checks cannot establish that criteria are meaningful or true; verification remains the agent's responsibility. Owner, assignee, actor and label stewardship remain governed by the root runbook and [label taxonomy](./beads-labels.md).

### Conversation and optional working history

Capture useful conversation selectively in task comments, distinguishing quotations, paraphrases and accepted decisions. Comments can carry short progress/delivery evidence; promote consequential conclusions into the task's current brief or notes. No automatic transcript is required.

A separate working diary is optional history, not unfinished child work. Attach an existing diary with a nonblocking `related` link and keep experiments and intermediate history in its authored comments. Promote useful conclusions to the task at handoff or completion. This policy defines no diary type, label or creation/closure procedure; without an established artifact contract, use selective task comments instead.

### Filed responses

See [response delivery](./agents/responses.md) for content ownership and `bee response --help` for publication, corrections and history.

### Filed specialist evidence

A specialist evidence record is an archive, not executable work or authoritative practice guidance. Its label steward and content contract are registered in the [label taxonomy](./beads-labels.md#specialist-evidence-and-label-stewardship). Label authority and write scope are both required; scope may be standing authority in the registered specialist contract or an explicit curation assignment. General task assignment does not confer stewardship.

Within that scope, create the record with native `--type docs --status closed --owner ct`, the supplied actor (otherwise the harness actor), and the initial sourced entry in its description. This is a narrow exception to claiming executable work: the record starts filed and never enters the ready queue. `closed` means recorded, not that its question is resolved or its advice validated. Append subsequent dated evidence to notes without claiming or reopening the record. Unresolved questions and next evidence can remain in the archive; a concrete authorized investigation or change belongs in a separate actionable task under the normal work lifecycle.

The specialist contract defines relationships and discovery. Verify the saved content, labels and links, then follow the root runbook’s explicit publication checkpoints. Respect native policy failures; do not force creation or closure to file evidence.

Cite response IDs instead of copying report bodies. Response publication grants no evidence-label stewardship.

### Inherited agent context

Set `--agent-context` on `create` or `update` with inline JSON such as `'{"constraints":["Keep this feature CLI-only"]}'`, or `@path/to/context.json` / `@path/to/context.yaml` (YAML is normalized to JSON). These are instructions for the consuming agent, not executable policy or a replacement for repository/user instructions.

Inherited emission is opt-in through `inherited_context.enabled: true` in `.beads/config.yaml` (nested YAML) or the `BR_INHERITED_CONTEXT` environment override. Hive does not currently enable it in repository config. When enabled, `show --json` includes `inherited_context` blocks from the root ancestor (preferring the topmost epic) and immediate parent, root first; intermediate ancestors are not all included. Blocks retain their source IDs and are not merged into one JSON object. Inspect the returned context and explicitly read any other ancestor whose design or instructions the task needs; do not assume ordinary descriptions, designs, or notes are inherited.

## Search and triage

Follow [honeybee's query and escalation procedure](../.hive/bees/honeybee/system_prompt.md) for selection, WIP and history. Search covers IDs, titles, descriptions and comments; use `list --notes-contains` for notes. Include closed records when relevant and check continuation/hidden counts before claiming exhaustive coverage. Summaries guide selection; read the chosen task's instructions and relationships before acting.

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

Use `br dep --help`, `br graph --help` and `br epic --help` to inspect relationships. Claims are native assignment/status transitions, not leases. Scheduler rankings and coordination diagnostics do not claim or reclaim work.

## Workflow policy

Native `.beads/policy.yaml` governs status, closure, acceptance and capacity gates. A refused transition needs policy/error inspection, not storage edits. Use `br gate --help` and `br coordination --help` for diagnostic operations; the [source map](./beads-command-source-map.md) locates policy implementation.

## Persistence and recovery

[Beads integration](./beads-integration.md) owns endpoint setup, exchange and conflict recovery. Use installed `br sync --help` for native modes. Forced imports, rebuilds, repair and restore require inspection of their exact effects; this reference grants no recovery authority.

## Machine interfaces

Use `--json` for automation and discover command-specific envelopes with `br schema commands --format json`. Preserve diagnostics, nonzero exits and partial effects; native schemas are version-specific.

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

Use `jq` for transformations native flags cannot express, not to discard a full list after fetching it. Filtering before the shell tool returns reduces agent context, but does not reduce `br`'s own hydration/serialization. Neither projection nor these recipes changes where evidence is recorded: follow the [work policy](#authoring-and-handing-off-work).

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

# For an archive whose contract calls for appending evidence, omit the repeated notes body.
br-output [update $id --actor pi --append-notes "Verified: focused checks passed" --json] | jq 'walk(if type == "object" and (.notes | type) == "object" then del(.notes.text) else . end)'
```

The append recipe retains `notes.appended`, `notes.applied`, before/after lengths and the rest of the receipt, including wrapped warnings. Substitute the supplied execution actor when present. A non-zero producer result is never filtered into a success-shaped acknowledgement; inspect its raw receipt before retrying a mutation that may already have taken effect.

## Investigation workflow

Preserve the question, permitted IDs and selected tracker. Discover uncertain behavior with installed help/capabilities, then use the source map only when needed. Return findings, coverage limits and the next unresolved action. Investigation grants no authority to claim, repair or publish work.
