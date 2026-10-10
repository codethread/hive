# Hive

Hive is a strict TypeScript monorepo for coding agent tools.

Read [philosophy](./docs/PHILOSOPHY.md) before making changes.

## Worktrees

Work in a worktree unless explicitly instructed otherwise. Use `honeycomb` (see `honeycomb -h`); create new worktrees inside `.worktrees/` with the `nested` location.

## Workflow

Explore existing conventions, helpers and modules; plan the approach; then build. Apply clean code and architecture practices. Before building library code, investigate existing tools online. Favour focused, maintained tools; present candidates when there is no clear winner.

### Specialist delegation

Use Bee for repository subagents. Run `bee --help`, then `bee kinds` before delegating. Put the assignment, context and acceptance on task beads; normally spawn with the kind's defaults and omit prompt overrides.

## Packages

- `lib/shared` — utilities and models common to all packages. Not a grab bag: only add what consumers clearly need.
- `lib/colony` — Bee and Colony CLIs, offline requests, daemon ownership, colony/request lifecycles, dispatch, supervision and private persistence.
- `lib/honeycomb` — the Git worktree manager and shell picker integrations.
- `lib/tooling` — repository maintenance commands.
- `lib/waggle` — repo-owned JEV classifier discovery and execution.
- `lib/busybee` — workflow discovery, execution and Beads task projection; repository definitions live in `.workflows/`.

## Architecture rules

Product packages may import only `@hive/shared` across package boundaries; Shared imports no product package. Cross-package relative imports are prohibited. `.oxlintrc.json` enforces these rules.

## Architectural intent

- **Consult:** use `librarian` when ownership, domain concepts, seams or abstraction choices remain unclear after reading the architecture; routine file placement does not need a consultation.
- **Curate/discuss:** use `librarian` to synthesize difficult questions, recurring confusion and outcomes. Forward user corrections with the original request, context and supplied rationale. Evidence capture is part of the role; explicitly scope documentation changes and new policy decisions.
- **Review:** before committing or handing off changes to those architectural concerns, use `librarian` in review mode on the final diff. Keep code style, test quality and general standards review with `reviewer`.
- Pass the task bead when one exists, affected paths/revisions, settled decisions, prior advice and the evidence ID when known. Librarian records substantive exchanges under its [evidence contract](.hive/bees/librarian/system_prompt.md#architectural-evidence-records); no separate filing assignment is needed. Keep the accepted approach in the task's design and return corrections and final outcomes to the same evidence thread. Consult/review leave examined code, architecture documents and implementation tasks unchanged; routine evidence capture remains part of reporting.

## Runtime and commits

- Strict TypeScript runs directly on Bun; there is no build step and no emit. `tsc --noEmit` is the gate.
- Conventional Commits, enforced by commitlint on `commit-msg`.

## Commands

- `bun install`
- `bun run check` — `fmt:check` + `lint` + `typecheck` + `test:all`.
- `bun run fmt` / `bun run fmt:check`
- `bun run lint` / `bun run lint:fix`
- `bun run typecheck`

## Semantic review signals

When reviewing domain-state modelling, abstraction choices or failure semantics, use [Waggle](lib/waggle/README.md) as an optional review aid. From the checkout root, run `bun run --silent waggle list --json`, then `describe <id> --json` to learn when a classifier applies and what evidence it needs. Supply only authorized context via `run <id> --input <file-or-dash> --json`; definitions live in `classifiers/`.

When selecting files for human review, use `review-attention` for I/O boundaries and persistence decisions; describe it before gathering its distinct inputs. Treat `show` as attention, not a defect, and investigate `needs_context` before excluding a file. `skip` is not approval.

State missing context rather than inventing contracts. Validate any concern against the source before reporting it; `no_concern` is not approval. Waggle sends supplied evidence to Typesafe and is not a replacement for lint, tests or reviewer judgment.

## Validation

Before requesting agent review, committing or handing off implementation changes, get `bun run check` passing for the complete change. Explain any skipped verification.

Husky validates staged JSONL for snapshot-only commits/merges on `tracker/state`; other changes run `lint-staged` and a repo-wide typecheck. Commitlint runs on `commit-msg`; hooks do not run tests or publish the tracker.

## Where to look

- Before changing request representation, scheduling authority or package placement, read [architecture](docs/architecture.md). It maps package boundaries and sources of truth.
- [Bee and Colony guide](lib/colony/README.md) documents public commands and real I/O verification.
- Before changing workflow projection or completion, read the [Busy Bee specification](lib/busybee/SPEC.md) for the intended behavior and Beads integration decisions.
- Before authoring or refactoring Busy Bee workflow definitions, read the [workflow style guide](docs/busybee-workflows.md) for explicit charts and visualizer visibility.

## Spawn state and attention

Before querying spawn requests, interpreting failures or supersession, retrying work, or changing lifecycle publication, read the [spawn state contract](docs/agents/spawn-requests.md) for valid states, recovery and native queries, including closed failures. It covers automation-owned spawn beads; ordinary task selection excludes `system`.

## Domain docs

Single-context: root `GLOSSARY.md` and `docs/adr/`. Before exploring, follow `docs/agents/domain.md`.

## Beads / br

Use repo-local Beads (`br`) from the checkout root to track implementation, not harness todos or Markdown task files.

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

- Labels are optional. Before choosing or changing them, use [the label taxonomy and stewardship registry](docs/beads-labels.md); ask honeybee if uncertain. Only registered specialists add or remove their own `evidence:*` labels within authorized curation; other agents delegate classification and preserve those labels. Keep status, priority, ownership and readiness in native fields, not invented labels. Use `--add-label` / `--remove-label` for incremental edits; `--labels` replaces the set.
- `system` beads are automation-owned: exclude them from ordinary `search`, `list` and `ready` with `--exclude-label system`. Reading or changing them requires an explicit system-maintenance/debugging assignment. Viewer triage uses `bv --recipe work --robot-triage`, never bare `bv`.
- `hitl` requires working alongside the user; autonomous agents skip it. Assignment to `ct` instead reserves human action: do not claim, clear or replace it without ct's instruction. Agent work remains assigned to an agent; assign `ct` only for a deliberate, documented handoff.

### Storage and publication

Use the selected `BEADS_DB`; never create a private tracker or remove `.worktrees/tracker--state`. `br` writes locally with automatic JSONL import/export; `bun run beads:sync` publishes the whole shared tracker.

Run `bun run beads:sync` for an explicit pull/remote refresh, once after landing/merge and final tracker updates, or a deliberate remote handoff/checkpoint of tracker-only or unlanded work. A code pull does not refresh the live tracker; refresh an independent or dormant clone before selecting shared work. Outside these events, remote state can remain stale and local work unpublished.

For coordinated cross-clone work, agree task allocation or refresh, claim, successfully publish and verify reservations before execution. Publish release/handoff before another clone takes over. Shared local claims need no publication; separate clones have separate databases even on one host. Git exchange is not a distributed lease, and identical actor claims cannot prove exclusivity. Never force competing claims. See [Beads integration](docs/beads-integration.md) for the exchange protocol.

On synchronization failure, stop tracker work and report it. Preserve unrelated changes and respect published claims; timestamps and force are not ownership decisions. For endpoint setup or human-led recovery, consult [Beads integration](docs/beads-integration.md). Never merge `tracker/state` into code branches or edit generated JSONL for routine updates. Tracker publication does not authorize committing or pushing application code.
