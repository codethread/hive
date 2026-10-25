# Hive

Hive is a strict TypeScript monorepo for coding agent tools. Read [philosophy](docs/PHILOSOPHY.md) before making changes.

Discover repository tasks with `mise tasks ls --local` and tool guides through the [documentation index](docs/README.md).

## Workflow

Work in a worktree unless explicitly instructed otherwise. Use `honeycomb` (see `honeycomb -h`); create worktrees inside `.worktrees/` with the `nested` location. Colony executions use their supplied worktree unless the assignment requires another.

Before building library code, investigate existing tools online. Favour focused, maintained tools; present candidates when there is no clear winner.

Use Bee for repository subagents and follow the [specialist protocol](docs/agents/specialists.md):

- Delegate repository prose writing and review to `bookworm`.
- Use `architect` for new or revised architectural decisions and `librarian` for established guidance and conformity review. Follow the protocol for review, decision escalation and evidence.
- Use `reviewer` for code style, test quality and general standards review.

## Required references

- Before changing request representation, scheduling authority or package placement, read [architecture](docs/architecture.md) for boundaries and sources of truth.
- Before changing workflow projection/completion or authoring/refactoring definitions, follow the [workflow references](docs/README.md#workflows).
- Before querying spawn requests, interpreting failures/supersession, retrying or changing lifecycle publication, read the [spawn state contract](docs/agents/spawn-requests.md).
- When terminology or design decisions matter, follow [domain guidance](docs/agents/domain.md).
- For domain-state, abstraction or failure-semantics review, consult [semantic review guidance](docs/agents/semantic-review.md). Its `review-attention` procedure is required when selecting I/O boundaries or persistence decisions for human review.

## Validation

During iteration, use focused files or package checks and `bun run test:changed` at subtask boundaries; see [testing commands](docs/README.md#development-and-automation).

Deliver authorized implementation through [Land](.workflows/land/workflow.ts) by default; bounded [do-work](.workflows/do-work/workflow.ts) and [do-feature-task](.workflows/do-feature-task/workflow.ts) assignments retain their scope. These workflows own full checks, review and disposition. Report failed or skipped verification.

Use Conventional Commits. [Development toolchain](docs/integrations.md#development-toolchain) covers runtime and integrations.

## Beads / br

Track implementation with repo-local `br` from the checkout root. Use the selected `BEADS_DB`; preserve the permanent `.worktrees/tracker--state` checkout. Never create a private tracker or edit generated JSONL for routine updates.

Every mutation needs an actor. Preserve supplied `BD_ACTOR` in Bee/Colony executions; otherwise use your harness actor (`pi`, `claude` or `codex`) through `--actor` or process-local `BD_ACTOR`. Never use `ct`/`USER` as the agent actor or persist it in shared configuration. Set `--owner ct` on every creation and claim; ownership is not assignment.

### Route the request

- **Inspect an ID:** `br show <id> --json`; report without claiming or changing it. Questions need no bookkeeping beads.
- **Search/report, choose work or resolve tracker uncertainty:** delegate to `honeybee` with the question and known IDs. It advises; you perform authorized updates. Supplied work needs no replacement triage.
- **Implement:** follow the lifecycle below. **“Bead this”** means record locally only, without claiming or implementing.
- **Missing intent or permission:** ask the user; honeybee supplies tracker facts, not user decisions.

Request only fields needed for the next decision; use native `--fields`/`--brief`. Consult [low-noise reads](docs/beads-meta.md#progressive-disclosure-and-output-cost) when composing filters, and `br COMMAND --help` for operations.

### Task lifecycle

1. Inspect the supplied bead or reuse existing scope. Before creating, updating or completing executable work, follow the [work policy](docs/beads-meta.md#authoring-and-handing-off-work).
2. Claim only your available scope with `br update <id> --claim --owner ct --json`, respecting assignments and blockers. Record scope and worktree context because same-harness sessions can share an actor.
3. Split substantial work into scoped children and claim/delegate each explicitly. Parent links group work; blocking dependencies order execution.
4. Follow the work policy's evidence and completion gates. For engine-managed work, preserve tool-owned fields and use the active workflow's completion protocol.

Use `in_review` only for completed work awaiting user-requested review; agent-to-agent review stays `in_progress`. Use `blocked` for an active blocker.

For merge-request creation, lookup or resolution, follow the [merge bead contract](docs/beads-meta.md#merge-beads). Merge beads are reference records outside this claim/execute lifecycle; exclude `merge` when selecting work.

### Reservations and execution

- Before changing labels, read the [taxonomy and stewardship registry](docs/beads-labels.md). Preserve labels owned by other specialists.
- Exclude `system` from ordinary `search`, `list` and `ready` with `--exclude-label system`. Access requires an explicit Bee/Colony operation or system-maintenance/debugging assignment; your supplied `HIVE_SPAWN_ID` is authorized execution context. Viewer triage uses `bv --recipe _hive_work --robot-triage`.
- Autonomous agents skip `hitl`.
- Colony executions verify supplied claims before working and follow `bee finish --help` for delivery and completion. Record final task updates locally before finishing.

### Publication

Local worktrees and bees share the selected database; startup/resume, claims and local handoffs stay local. Session hooks configure the environment only.

Run `bun run beads:sync` only for an explicit pull/remote refresh, once after landing/merge and final tracker updates, or a deliberate remote handoff/checkpoint. It exchanges the whole tracker. Before cross-clone work or synchronization recovery, follow [Beads integration](docs/beads-integration.md); a code pull does not refresh the live tracker, and local claims do not establish cross-clone ownership.

On tracker alerts or synchronization failures other than [pre-publication `tracker_busy`](docs/beads-integration.md#conflicts-and-recovery), stop tracker work and report it. Never force competing claims or merge `tracker/state` into code branches. Tracker publication does not authorize committing or pushing application code.
