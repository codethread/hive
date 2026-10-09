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
- **Curate/discuss:** forward user corrections about ownership, placement, domain terminology, dependency direction or module responsibility to `librarian`. Include the original request, context and supplied rationale, not just your interpretation; explicitly scope any documentation/evidence edits. Direct questions about recurring agent confusion also belong here, without implying permission to change policy.
- **Review:** before committing or handing off changes to those architectural concerns, use `librarian` in review mode on the final diff. Keep code style, test quality and general standards verification with `reviewer`.
- Pass the task bead when one exists, affected paths/revisions, settled decisions and prior advice. Return implementation departures, structural review findings and user corrections to the librarian so outcomes can inform curation. Keep the current approach in the task's design; delegate useful history to librarian in an explicitly scoped curate invocation for a linked evidence record. Consult/review alone authorizes no writes; librarian defines the evidence format and write safeguards.

## Runtime and commits

- Strict TypeScript runs directly on Bun; there is no build step and no emit. `tsc --noEmit` is the gate.
- Conventional Commits, enforced by commitlint on `commit-msg`.

## Commands

- `bun install`
- `bun run check` — `fmt:check` + `lint` + `typecheck`; does not run tests.
- `bun run fmt` / `bun run fmt:check`
- `bun run lint` / `bun run lint:fix`
- `bun run typecheck`

## Semantic review signals

When reviewing domain-state modelling, abstraction choices or failure semantics, use [Waggle](lib/waggle/README.md) as an optional review aid. From the checkout root, run `bun run --silent waggle list --json`, then `describe <id> --json` to learn when a classifier applies and what evidence it needs. Supply only authorized context via `run <id> --input <file-or-dash> --json`; definitions live in `classifiers/`.

When selecting files for human review, use `review-attention` for I/O boundaries and persistence decisions; describe it before gathering its distinct inputs. Treat `show` as attention, not a defect, and investigate `needs_context` before excluding a file. `skip` is not approval.

State missing context rather than inventing contracts. Validate any concern against the source before reporting it; `no_concern` is not approval. Waggle sends supplied evidence to Typesafe and is not a replacement for lint, tests or reviewer judgment.

## Validation

Before committing or handing off, run full `bun run check` and tests appropriate to the complete change. Explain any skipped verification.

Husky runs `lint-staged` and a repo-wide typecheck before commits and merges. Commitlint runs on `commit-msg`; hooks do not run tests or publish the tracker.

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
- **Implement**: follow the daily workflow below. **"Bead this"** means record and sync only, without claiming or implementing.
- **Missing intent or permission**: ask the user. Use honeybee for tracker facts, not user decisions.

### Daily workflow

Outside Colony executions, every mutation needs your harness actor (`--actor pi|claude|codex`, choosing your own, or process-local `BD_ACTOR`). Colony bees use the supplied actor as described below. Never use `ct`/`USER` as the agent actor or persist it in shared configuration. Set `--owner ct` on every creation and claim; ownership is not assignment.

Run `bun run beads:sync` once when beginning or resuming work, before selecting or claiming tasks. Session hooks configure the environment only; changing to a new local worktree during the same work does not require another startup sync.

1. **Identify:** inspect the supplied bead. Otherwise search for existing scope with `br search "<topic>" --exclude-label system --json`; reuse matches. Create missing work with `br create --title "…" --type task --priority 2 --owner ct --description "…" --acceptance-criteria "- [ ] …" --json`. Include the problem, scope, useful pointers and verifiable outcomes; choose the appropriate native type/priority.
2. **Claim:** `br update <id> --claim --owner ct --json`. Respect assignments and blockers; claim your scope, not a shared epic. Local worktrees share the selected database, so local claims need no separate publication. Record scope/worktree context in notes because same-harness sessions share an actor.
3. **Work:** split substantial work into scoped children (`create --parent <id>`), claiming/delegating each explicitly; a parent claim does not assign children. Parent links group work; `br dep add <issue> <depends-on>` records execution prerequisites. Keep the current approach in `update --design` and append progress/handoff evidence with `update --append-notes`. Pass the bead ID when delegating; avoid duplicate tracking.
4. **Finish:** verify acceptance, record evidence, then `br close <id> --reason "Completed: <proof>" --json`. Keep unfinished work open with a next step. Parents require completed children; landing-scoped work stays open until integration. Run `bun run beads:sync` once at final handoff or landing after all tracker updates, including closure and updates after the final code commit. Recording new work without implementing it also ends with sync; intermediate updates and local commits need no publication.

### Colony executions

- Follow `bee finish --help` for execution identity, delivery and completion. Run the startup sync once and verify the supplied claims before working. Publish final task updates once before finishing; intermediate updates and local commits stay local.
- Reading your own spawn through `HIVE_SPAWN_ID` is authorized execution context, not permission to browse unrelated `system` beads. Use the supplied worktree; create another only when the task explicitly requires it.
- Librarian curation edits require explicit scope. Keep implementation, review and landing acceptance distinct; a completed report is not permission to close the examined work.

### Labels and reservations

- Labels are optional. Before choosing or changing them, use [the label taxonomy and stewardship registry](docs/beads-labels.md); ask honeybee if uncertain. Only registered specialists add or remove their own `evidence:*` labels within authorized curation; other agents delegate classification and preserve those labels. Keep status, priority, ownership and readiness in native fields, not invented labels. Use `--add-label` / `--remove-label` for incremental edits; `--labels` replaces the set.
- `system` beads are automation-owned: exclude them from ordinary `search`, `list` and `ready` with `--exclude-label system`. Reading or changing them requires an explicit system-maintenance/debugging assignment. Viewer triage uses `bv --recipe work --robot-triage`, never bare `bv`.
- `hitl` requires working alongside the user; autonomous agents skip it. Assignment to `ct` instead reserves human action: do not claim, clear or replace it without ct's instruction. Agent work remains assigned to an agent; assign `ct` only for a deliberate, documented handoff.

### Storage and publication

Use the selected `BEADS_DB`; never create a private tracker or remove `.worktrees/tracker--state`. `br` writes locally with automatic JSONL import/export; `bun run beads:sync` publishes the whole shared tracker.

These checkpoints assume one active clone. When coordinating across active clones, explicitly publish claims before working and respect already-published reservations; claims remain provisional until publication succeeds. Unpublished claims are visible only within the local shared database; startup/final publication alone does not provide cross-clone exclusivity. Never force competing claims.

On synchronization failure, stop tracker work and report it. Preserve unrelated changes and respect published claims; timestamps and force are not ownership decisions. For endpoint setup or human-led recovery, consult [Beads integration](docs/beads-integration.md). Never merge `tracker/state` into code branches or edit generated JSONL for routine updates. Tracker publication does not authorize committing or pushing application code.
