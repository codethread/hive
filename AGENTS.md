# Hive

Hive is a strict TypeScript monorepo for coding agent tools.

Read [philosophy](./docs/PHILOSOPHY.md) before making changes.

Use the [documentation index](./docs/README.md) for tool guides, workflow authoring and detailed reference.

To discover repository tasks, run `mise tasks ls --local`.

## Worktrees

Work in a worktree unless explicitly instructed otherwise. Use `honeycomb` (see `honeycomb -h`); create new worktrees inside `.worktrees/` with the `nested` location.

## Workflow

Explore existing conventions, helpers and modules; plan the approach; then build. Apply clean code and architecture practices. Before building library code, investigate existing tools online. Favour focused, maintained tools; present candidates when there is no clear winner.

### Specialist delegation

Use Bee for repository subagents. Before delegating, follow the [specialist protocol](docs/agents/specialists.md) for discovery, workflow assignment and evidence.

## Packages

- `lib/beads` — the consumed Beads contract, native adapter and in-memory test adapter.
- `lib/shared` — utilities and models common to all packages. Not a grab bag: only add what consumers clearly need.
- `lib/colony` — Bee and Colony CLIs, offline requests, daemon ownership, colony/request lifecycles, dispatch, supervision and private persistence.
- `lib/honeycomb` — the Git worktree manager and shell picker integrations.
- `lib/tooling` — repository maintenance commands.
- `lib/waggle` — repo-owned JEV classifier discovery and execution.
- `lib/busybee` — workflow discovery, execution and Beads task projection; repository definitions live in `.workflows/`.

## Architecture rules

Product packages may import `@hive/shared` and `@hive/beads` across package boundaries. Shared may import Beads; Beads imports no Hive package, and Shared imports no product package. Cross-package relative imports are prohibited. `.oxlintrc.json` enforces these rules.

## Architectural intent

Use `librarian` when ownership, domain concepts, seams or abstractions remain unclear after reading the architecture; for user corrections or synthesis of difficult questions, recurring confusion and outcomes; and to review the final diff for those architectural changes before commit or handoff. Follow the [specialist protocol](docs/agents/specialists.md); routine file placement needs no consultation. `reviewer` owns code style, test quality and general standards review.

## Runtime and commits

- Development runs strict TypeScript directly on Bun. CLI compilation is separate from the `tsc --noEmit` typechecking gate.
- Conventional Commits, enforced by commitlint on `commit-msg`.

## Semantic review signals

For domain-state, abstraction or failure-semantics review, [semantic review guidance](docs/agents/semantic-review.md) covers optional Waggle signals. When selecting files for human review, follow that guide's required `review-attention` procedure for I/O boundaries and persistence decisions.

## Validation

During iteration, use focused files or package checks and `bun run test:changed` at subtask boundaries; see [testing commands](docs/README.md#development-and-automation).

The [Land workflow](.workflows/land/workflow.ts) owns its comprehensive completion checks. Outside Land, before requesting agent review, committing or handing off implementation changes, get `bun run check` passing for the complete change. Explain any skipped verification.

Husky validates staged JSONL for snapshot-only commits/merges on `tracker/state`; other changes run `lint-staged` and a repo-wide typecheck. Commitlint runs on `commit-msg`; hooks do not run tests or publish the tracker.

## Where to look

- Before changing request representation, scheduling authority or package placement, read [architecture](docs/architecture.md). It maps package boundaries and sources of truth.
- Before changing workflow projection/completion or authoring/refactoring definitions, follow the [workflow references](docs/README.md#workflows) for the required specification and style guide.

## Spawn state and attention

Before querying spawn requests, interpreting failures or supersession, retrying work, or changing lifecycle publication, read the [spawn state contract](docs/agents/spawn-requests.md) for valid states, recovery and native queries, including closed failures. It covers automation-owned spawn beads; ordinary task selection excludes `system`.

## Domain docs

When terminology or design decisions matter to the task, follow [domain guidance](docs/agents/domain.md) for the shared glossary and relevant ADRs.

## Beads / br

Use repo-local Beads (`br`) from the checkout root to track implementation, not harness todos or Markdown task files.

Request only fields needed for the next decision; prefer native `--fields`/`--brief` over `jq` for summaries. See [low-noise reads and receipts](docs/beads-meta.md#progressive-disclosure-and-output-cost) when composing output filters.

When creating a draft/open merge request, finding a task's merge request, or recording its resolution, follow the [merge bead contract](docs/beads-meta.md#merge-beads). Merge beads are reference records, exempt from the task claim/execute lifecycle below; exclude `merge` when selecting executable work.

Use `in_review` only for completed work awaiting the user's attention when the user requested review; agent-to-agent review remains `in_progress`, and `blocked` indicates an active blocker.

For workflow stages, record scope, narrative progress and verification in comments. Reserve stage notes for the outcome saved by `busybee record-result`; see its command help.

### Route the request

- **Inspect an ID** ("check hv-…"): `br show <id> --json`; report without claiming or changing it. Questions do not need bookkeeping beads.
- **Search/report** (current WIP, closed epics, history), **choose work**, or **resolve tracker uncertainty**: delegate to `honeybee` with the question and known IDs. It advises; you perform authorized updates. Do not replace supplied work with triage.
- **Implement**: follow the daily workflow below. **"Bead this"** means record locally only, without claiming or implementing.
- **Missing intent or permission**: ask the user. Use honeybee for tracker facts, not user decisions.

### Daily workflow

Every mutation needs an actor. Keep the supplied `BD_ACTOR` in a `bee run` session or Colony execution. Otherwise use your harness actor (`--actor pi|claude|codex`, choosing your own, or process-local `BD_ACTOR`). Never use `ct`/`USER` as the agent actor or persist it in shared configuration. Set `--owner ct` on every creation and claim; ownership is not assignment.

Local worktrees and bees share the selected database. Ordinary startup/resume, claims and handoffs stay local; session hooks configure the environment only. Use the publication checkpoints below when exchanging work with another clone or landing.

1. **Identify:** inspect the supplied bead. Otherwise search for existing scope with `br search "<topic>" --exclude-label system --json`; reuse matches. Create missing work with `br create --title "…" --type task --priority 2 --owner ct --description "…" --acceptance-criteria "- [ ] …" --json`. Include the problem, scope, useful pointers and verifiable outcomes; choose the appropriate native type/priority.
2. **Claim:** `br update <id> --claim --owner ct --json`. Respect assignments and blockers; claim your scope, not a shared epic. Local worktrees share the selected database, so local claims need no separate publication. Record scope/worktree context in notes because same-harness sessions share an actor.
3. **Work:** split substantial work into scoped children (`create --parent <id>`), claiming/delegating each explicitly; a parent claim does not assign children. Parent links group work; `br dep add <issue> <depends-on>` records execution prerequisites. Keep the current approach in `update --design` and append progress/handoff evidence with `update --append-notes`. Pass the bead ID when delegating; avoid duplicate tracking.
4. **Finish:** verify acceptance, record evidence, then `br close <id> --reason "Completed: <proof>" --json`. Keep unfinished work open with a next step. Parents require completed children; landing-scoped work stays open until integration. Publish once after landing/merge and all final task/workflow updates. Tracker-only or unlanded work stays local until an explicit remote handoff/checkpoint.

### Colony executions

- Follow `bee finish --help` for execution identity, delivery and completion. Verify the supplied claims before working. Record final task updates locally before finishing; ordinary bee startup and completion need no Git publication.
- Reading your own spawn through `HIVE_SPAWN_ID` is authorized execution context, not permission to browse unrelated `system` beads. Use the supplied worktree; create another only when the task explicitly requires it.
- Librarian's role supplies routine evidence-capture scope; architecture-documentation edits need explicit scope. Keep implementation, review and landing acceptance distinct; a completed report is not permission to close the examined work.

### Labels and reservations

- Before choosing or changing labels, read the [label taxonomy and stewardship registry](docs/beads-labels.md); ask honeybee if uncertain. Labels are optional; keep status, priority, ownership and readiness in native fields. Only registered specialists mutate their own `evidence:*` labels within authorized curation; others delegate classification and preserve them. Use `--add-label` / `--remove-label` for incremental edits; `--labels` replaces the set.
- `system` beads are automation-owned: exclude them from ordinary `search`, `list` and `ready` with `--exclude-label system`. Reading or changing them requires an explicit system-maintenance/debugging assignment. Viewer triage uses `bv --recipe work --robot-triage`, never bare `bv`.
- `hitl` requires working alongside the user; autonomous agents skip it. Assignment to `ct` instead reserves human action: do not claim, clear or replace it without ct's instruction. Agent work remains assigned to an agent; assign `ct` only for a deliberate, documented handoff.

### Storage and publication

Use the selected `BEADS_DB`; never create a private tracker or remove `.worktrees/tracker--state`. `br` writes locally with automatic JSONL import/export; `bun run beads:sync` publishes the whole shared tracker.

Run `bun run beads:sync` for an explicit pull/remote refresh, once after landing/merge and final tracker updates, or a deliberate remote handoff/checkpoint of tracker-only or unlanded work. A code pull does not refresh the live tracker; refresh an independent or dormant clone before selecting shared work. Outside these events, remote state can remain stale and local work unpublished.

For coordinated cross-clone work, agree task allocation or refresh, claim, successfully publish and verify reservations before execution. Publish release/handoff before another clone takes over. Shared local claims need no publication; separate clones have separate databases even on one host. Git exchange is not a distributed lease, and identical actor claims cannot prove exclusivity. Never force competing claims. See [Beads integration](docs/beads-integration.md) for the exchange protocol.

On synchronization failure, stop tracker work and report it. Preserve unrelated changes and respect published claims; timestamps and force are not ownership decisions. For endpoint setup or human-led recovery, consult [Beads integration](docs/beads-integration.md). Never merge `tracker/state` into code branches or edit generated JSONL for routine updates. Tracker publication does not authorize committing or pushing application code.
