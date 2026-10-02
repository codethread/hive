---
name: beads-labels
# prettier-ignore
description: >-
  Choose and maintain Hive Beads labels when creating or classifying tasks,
  selecting a runner, or changing labels. Defines the repository label taxonomy
  and safe edits; not a general br command guide or system-operations runbook.
---

# Beads labels

Use labels for classification and supported routing, not as a second issue schema. This is Hive's label vocabulary; `br` accepts other strings, but that does not give them behavior in Hive.

## Taxonomy

> [!info] Add no labels beyond these listed

| Labels | Cardinality | Meaning and consumer |
| --- | --- | --- |
| `system` | Reserved marker | Automation-owned beads excluded from ordinary work by the `work` viewer recipe and default worker loop. Ordinary agents must not read, claim, modify, or execute these beads; access requires an explicit system-maintenance or debugging assignment. |
| `agent:lead`, `agent:worker` | Zero or one | Select a runner in the [worker loop](../../../scripts/beads-loop.ts), not the owner, assignee, or author's harness. Multiple or unknown `agent:*` labels are rejected by the loop. Without one, the loop uses `--agent`, defaulting to `worker`. |
| `area:shared`, `area:colony`, `area:ghost`, `area:honeycomb`, `area:tooling` | Zero or more | Classify affected Hive packages for filtering; these labels do not select a runner, block work, or enforce policy. Use multiple only for genuinely cross-package work; omit for repository-wide work without a package scope. |

Use exact lowercase values. The area vocabulary follows Hive's package names; `area:honeycomb` is already in use. `system` is reserved for automations and must not be used directly by agents without clear direction from the user.

Keep issue type, status, priority, owner, assignee, dependencies, and acceptance criteria in their native fields. Do not add parallel labels such as `bug`, `blocked`, or `P1`. Labels do not grant permission to claim work or override workflow policy.

For example, a Honeycomb picker bug is type `bug` with `area:honeycomb`; it needs no runner label unless routing was explicitly chosen. A repository-wide formatting task can have no labels at all. If a reserved system bead blocks ordinary work, report the blocker on the permitted bead and request a maintenance handoff without opening the reserved bead.

## Change labels without losing context

`create --labels` sets the initial labels. For an existing permitted bead, inspect its current labels and use `update --add-label` / `--remove-label` for targeted changes. `update --labels` is an alias of `--set-labels` and replaces the entire set; do not use it for an incremental edit.

When an ordinary task is explicitly switched from worker to lead, remove the old routing label and add the new one in the same update, preserving its area and other labels. For a Pi agent, replacing `hv-example` with the assigned bead ID:

```nu
br update hv-example --remove-label agent:worker --add-label agent:lead --actor pi --json
```

Use your own harness identity for attribution. Verify the returned labels with `br show <id> --json` for the permitted bead. Do not remove `system` to make a reserved bead appear in ordinary work.

## Extend the vocabulary deliberately

Before introducing another namespace or value, identify the concrete query or consumer it serves and update this taxonomy. Routing changes must also update the consumer; a new `agent:*` string alone cannot create a runner. Generic `br` examples using `harness:*` or `effort:*` are not supported Hive routing conventions.

Keep new classifications orthogonal to the existing fields and labels. Do not bulk relabel historical beads merely to make them match a new convention without an explicit migration task.
