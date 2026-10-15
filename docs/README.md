# Hive docs

## Tool guides

- [Bee and Colony](../lib/colony/README.md) — installation, quickstart, configuration and verification.
- [Honeycomb](../lib/honeycomb/README.md) — worktree commands and shell integration.
- [Scent](../lib/scent/README.md) — native Pi session identity and attribution.
- [Waggle](../lib/waggle/README.md) — semantic classifiers.
- [qlock](../lib/qlock/README.md) — ticketed command and merge queues.
- [Hive UI](../lib/hive-ui/README.md) — read-only work board and [component workshop](../lib/hive-ui/README.md#component-workshop).

## Workflows

- [Hive releases](./releases.md) — versioned Homebrew installation and the separately invoked Release workflow.

- [Busy Bee](../lib/busybee/README.md) — run workflows as Beads tasks.
- [Busy Bee specification](../lib/busybee/SPEC.md) — read before changing workflow projection or completion.
- [Authoring Busy Bee workflows](./busybee-workflows.md) — read before authoring or refactoring definitions; explicit charts and visualizer visibility.
- [Landing agreed work](../lib/busybee/README.md#landing-from-the-current-state) — triage, enforced completion checks, review and integration in the [Land definition](../.workflows/land/workflow.ts).

## Design and contracts

- [Philosophy](./PHILOSOPHY.md) — project scope and tenets.
- [Glossary](../GLOSSARY.md) — shared vocabulary.
- [Hive UI design](./design/hive-ui.md#component-catalogue) — component/story catalogue and nested presentation glossary.
- [Architecture](./architecture.md) — package boundaries and runtime authority.
- [Integration boundaries](./integrations.md) — external dependencies and replacement contracts.
- [Agent identity](./agent-identity-scope.md) — Bee/Colony and native Pi identity, with planned adapters and child attribution.
- [Harness capabilities](./harness-capabilities.md) — versioned evidence and adapter acceptance cases.

## Agent task reference

- [Domain guidance](./agents/domain.md) — glossary and ADR reading when terminology or design decisions matter.
- [Specialist delegation](./agents/specialists.md) — Bee discovery, librarian consult/review/curation and evidence handoff.
- [Semantic review signals](./agents/semantic-review.md) — optional Waggle concerns and required attention routing when selecting files for human review.
- [Spawn state and native queries](./agents/spawn-requests.md) — read before querying requests, interpreting failures/supersession, retrying or changing lifecycle publication.
- [Welcoming hive](./agents/welcoming-hive.md) — post-run assessment and nurse discussion heuristic.

## Development and automation

- [Repository commands](./repository-commands.md) — catalog discovery, test arguments and recipe ownership.
- [Testing commands](../lib/tooling/README.md) — changed-test selection, timing reports and approved allowances. During iteration, use focused files or package test scripts; run changed tests at subtask boundaries.
- [Development toolchain](./integrations.md#development-toolchain) — runtime, hooks, environment setup and explicit tracker publication responsibilities.
- [Beads setup and recovery](./beads-integration.md) — bootstrap, environment hooks and synchronization failures.
- [Automation bead maintenance](./integrations.md#automation-bead-maintenance-and-debugging) — reference for explicitly authorized `system` work.

## Beads

- [Integration](./beads-integration.md) — shared storage, synchronization and recovery.
- [Labels](./beads-labels.md) — classifications and routing.
- [Agent issue operations](./agents/issue-tracker.md) — ticket and readiness conventions.
- [Specialist reference](./beads-meta.md) — tracker investigation, with a [command/source map](./beads-command-source-map.md).
