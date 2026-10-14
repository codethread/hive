# Beads labels

Use labels for classification and supported routing, not as a second issue schema. This is Hive's label vocabulary for ordinary tasks and specialist evidence records; `br` accepts other strings, but that does not give them behavior or write authority in Hive. Spawn requests have the separate representation described below; do not add those labels to ordinary beads.

## Spawn request representation

Bee creates spawn beads with `system`, `bee` and `agent:<kind>`. Colony discovers the exact `system` and `bee` markers, then validates the kind against the captured recipe. The friendly identity is the native assignee, the recipe is the description, and native `related` dependencies name the task beads. The [shared spawn-request model](../lib/shared/src/spawn-request.ts) owns this representation for producers and consumers.

Spawn beads also carry exactly one `bee-outcome:*` and one `bee-resolution:*` label. These two explicitly authorized namespaces expose orthogonal outcome and resolution for native queries; they do not replace native lifecycle status. The [spawn state and native query contract](./agents/spawn-requests.md) owns the complete values, valid combinations, source-of-truth mapping, recovery and saved presets. The exception applies only to spawn beads; ordinary task labels remain governed by the taxonomy below.

Timestamped `Colony observation:` comments record minimal last-observed facts; logs remain in Colony's private attempt directories. See the [package seams](./architecture.md#package-responsibilities-and-seams) and [operator guide](../lib/colony/README.md).

## Taxonomy

> [!info] For ordinary tasks and evidence records, use only the labels below within their stated scope and authority.

| Labels | Cardinality | Meaning and consumer |
| --- | --- | --- |
| `system` | Reserved marker | Automation-owned beads excluded from ordinary work by the `work` viewer recipe. Ordinary agents must not read, claim, modify, or execute these beads; access requires an explicit Bee/Colony operation or system-maintenance/debugging assignment. |
| `hitl` | Marker | Human in the loop: the bead must be worked in tandem with the user, such as design work that needs their decisions. Bee refuses these tasks for autonomous execution; an agent works them only in a session with the user, confirming decisions as it goes. This is not a handoff: assigning `ct` hands work to the user, while `hitl` keeps an agent working with them. |
| `response` | Filed response records only | Immutable closed `docs` artifacts published by an authorized producer through Bee, linked nonblockingly to their producing task and managed request when present. No assignment or parent; never executable work. Any authorized producer may file its own response; this marker grants no `evidence:*` stewardship. See the [response protocol](./agents/responses.md). |
| `area:shared`, `area:colony`, `area:honeycomb`, `area:tooling` | Zero or more | Classify affected Hive packages for filtering; these labels do not select a runner, block work, or enforce policy. Use multiple only for genuinely cross-package work; omit for repository-wide work without a package scope. |
| `evidence:architecture` | Evidence records only | Index structured architectural history for librarian retrieval and review. Only the registered specialist below may add or remove it; it is not a runner, approval, or work-status label. |

Use exact lowercase values. The area vocabulary follows Hive's package names; `area:honeycomb` is already in use. `system` is reserved for automations and must not be used directly by agents without clear direction from the user.

Keep issue type, status, priority, owner, assignee, dependencies, and acceptance criteria in their native fields. Do not add parallel labels such as `bug`, `blocked`, or `P1`. Labels do not grant permission to claim work or override workflow policy.

For example, a Honeycomb picker bug is type `bug` with `area:honeycomb`. Choose its execution kind when submitting `bee spawn <kind> --parent <work-id> --input-file FILE`, not through an ordinary-task label. A repository-wide formatting task can have no labels at all. If a reserved system bead blocks ordinary work, report the blocker on the permitted bead and request a maintenance handoff without opening the reserved bead.

## Specialist evidence and label stewardship

`evidence:<specialty>` classifies structured, sourced history that informs a specialty's practices: observations, advice, decisions and observed outcomes, including uncertainty or unsuccessful advice. It belongs on a separate evidence record linked to relevant tasks, not on an implementation task merely because a specialist reviewed it. Current accepted practices belong in repository documentation; actionable investigations and improvements remain separate tasks. See the [filed-record lifecycle](./beads-meta.md#filed-specialist-evidence).

Register each exact value and its **label steward** here. Stewardship is authority to classify evidence, distinct from the bead's native owner, assignee or mutation actor.

| Registered label | Specialist steward | Evidence contract |
| --- | --- | --- |
| `evidence:architecture` | `librarian` | Architectural evidence in the `librarian` kind's protocol in [.hive/bees/librarian/system_prompt.md](../.hive/bees/librarian/system_prompt.md) |

Only the registered specialist may add or remove its evidence label within its authorized scope. The librarian's role grants standing scope for routine architectural evidence capture during consult, review and discussion; other evidence permissions come from the registered specialist contract or an explicit assignment. Task ownership or reading a specialist's instructions does not transfer stewardship. Coordinators pass questions, corrections and outcomes to the steward, which handles filing as part of its response. Other agents may retrieve records and propose corrections; they preserve labels they do not steward. Ordinary label permissions above remain unchanged. These are agent-workflow rules, not CLI-enforced access control.

Classify by subject, not by the contributing agent. One record may serve multiple specialties, with each steward applying only its own registered label; reuse that record instead of duplicating histories. `evidence:testing` and `evidence:performance` are possible future values, not currently authorized labels. Register a value, steward and evidence contract before using it; topical relevance alone does not authorize inventing labels.

## Change labels without losing context

`create --labels` sets the initial labels. For an existing permitted bead, inspect its current labels and use `update --add-label` / `--remove-label` for targeted changes. `update --labels` is an alias of `--set-labels` and replaces the entire set; do not use it for an incremental edit.

For an ordinary task, add a supported area label without replacing its other labels. For a Pi agent, replacing `hv-example` with the assigned bead ID:

```nu
br update hv-example --add-label area:honeycomb --actor pi --json
```

Use your own harness identity for attribution. Verify the returned labels with `br show <id> --json` for the permitted bead. Do not remove `system` to make a reserved bead appear in ordinary work.

## Extend the vocabulary deliberately

Before introducing another namespace or value, obtain approval for the taxonomy change, identify the concrete query or consumer it serves, and document who may apply it. Evidence values also require a registered specialist steward and evidence contract. `agent:<kind>` is reserved for spawn classification; adding it to an ordinary task does not select a bee kind. Generic `br` examples using `harness:*` or `effort:*` are not supported Hive routing conventions.

Keep new classifications orthogonal to the existing fields and labels. Do not bulk relabel historical beads merely to make them match a new convention without an explicit migration task.
