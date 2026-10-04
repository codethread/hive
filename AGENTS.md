# Hive

Hive is a strict TypeScript monorepo providing coding agent tooling. It ships `colony`, a CLI that abstracts over model providers, `ghost`, the daemon process that runs it, and `honeycomb`, a Git worktree manager, on top of a shared core.

## Worktrees

This repo uses `honeycomb` for Git worktrees (see `honeycomb -h`). Create this repository's new worktrees inside `.worktrees/` using the `nested` location. Always work in a worktree unless given specific guidance to do otherwise.

## Workflow

All work follows the explore → plan → build cycle:

1. **Explore** — always scout the repo first for existing paradigms and conventions, helpers to reuse and modules to adapt.
2. **Plan** — decide the approach before writing any code.
3. **Build** — implement the plan.

Clean code and clean architecture practices apply throughout. Before building library code ourselves, always consult online tooling: if there is no clear winner, suggest the candidate approaches, and favour precise, well-maintained tools over bloated tool sets.

## Packages

- `lib/shared` — utilities and models common to all packages. Not a grab bag: only add what consumers clearly need.
- `lib/colony` — CLI abstraction over providers.
- `lib/ghost` — the daemon process that runs.
- `lib/honeycomb` — the Git worktree manager and shell picker integrations.
- `lib/tooling` — repository maintenance commands.

## Architecture rules

- Packages may only import from `shared`. `colony`, `ghost`, `honeycomb`, and `tooling` must not import each other.
- Cross-package imports must use the `@hive/shared` package specifier; relative paths that traverse into another package are rejected.
- `shared` must never import `colony`, `ghost`, `honeycomb`, or `tooling`.
- `.oxlintrc.json` enforces these rules through per-package `no-restricted-imports` overrides.

## Conventions

- Strict TypeScript runs directly on Bun; there is no build step and no emit. `tsc --noEmit` is the gate.
- Tabs for indentation and unwrapped prose, enforced by oxfmt (`useTabs: true`, `proseWrap: "never"`); all other formatting options are defaults.
- Named exports only; functions are arrow function expressions (`func-style`).
- Conventional Commits, enforced by commitlint on `commit-msg`.

## Commands

- `bun install`
- `bun run check` — `fmt:check` + `lint` + `typecheck`; does not run tests.
- `bun run fmt` / `bun run fmt:check`
- `bun run lint` / `bun run lint:fix`
- `bun run typecheck`
- `bun run agents:sync` — regenerate `.pi/agents` from `.codex/agents`.

## Validation

Before committing or handing off, run full `bun run check` and tests appropriate to the complete change. Explain any skipped verification.

Husky runs `lint-staged`, a repo-wide typecheck and tracker synchronization before commits and merges, and rejects staged conflict markers. Sync failures block the commit; `tracker/state` commits skip synchronization to avoid recursion. Commitlint runs on `commit-msg`; hooks do not run tests.

## Where to look

- `docs/` — architecture documentation.

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

Every mutation needs your harness actor (`--actor pi|claude|codex`, choosing your own, or process-local `BD_ACTOR`). Never use `ct`/`USER` as the agent actor or persist it in shared configuration. Set `--owner ct` on every creation and claim; ownership is not assignment.

1. **Identify:** inspect the supplied bead. Otherwise search for existing scope with `br search "<topic>" --exclude-label system --json`; reuse matches. Create missing work with `br create --title "…" --type task --priority 2 --owner ct --description "…" --acceptance-criteria "- [ ] …" --json`. Include the problem, scope, useful pointers and verifiable outcomes; choose the appropriate native type/priority.
2. **Claim:** `br update <id> --claim --owner ct --json`, then `bun run beads:sync` before branching or working. Respect assignments and blockers; claim your scope, not a shared epic. A claim is provisional until synchronization succeeds; do not force it. Record scope/worktree context in notes because same-harness sessions share an actor.
3. **Work:** split substantial work into scoped children (`create --parent <id>`), claiming/delegating each explicitly; a parent claim does not assign children. Parent links group work; `br dep add <issue> <depends-on>` records execution prerequisites. Keep the current approach in `update --design` and append progress/handoff evidence with `update --append-notes`. Pass the bead ID when delegating; avoid duplicate tracking.
4. **Finish:** verify acceptance, record evidence, then `br close <id> --reason "Completed: <proof>" --json`. Keep unfinished work open with a next step. Parents require completed children; landing-scoped work stays open until integration. Run `bun run beads:sync` after closure, handoff or landing updates, including updates after the final code commit. Recording new work without implementing it also ends with sync.

### Labels and reservations

- Labels are optional. Before choosing or changing them, use [the task-label taxonomy](docs/beads-labels.md); ask honeybee if uncertain. Keep status, priority, ownership and readiness in native fields, not invented labels. Use `--add-label` / `--remove-label` for incremental edits; `--labels` replaces the set.
- `system` beads are automation-owned: exclude them from ordinary `search`, `list` and `ready` with `--exclude-label system`. Reading or changing them requires an explicit system-maintenance/debugging assignment. Viewer triage uses `bv --recipe work --robot-triage`, never bare `bv`.
- `hitl` requires working alongside the user; autonomous agents skip it. Assignment to `ct` instead reserves human action: do not claim, clear or replace it without ct's instruction. Agent work remains assigned to an agent; assign `ct` only for a deliberate, documented handoff.

### Storage and publication

Use the selected `BEADS_DB`; never create a private tracker or remove `.worktrees/tracker--state`. `br` writes locally; `bun run beads:sync` publishes.

On synchronization failure, stop tracker work and report it. Preserve unrelated changes and respect published claims; timestamps and force are not ownership decisions. For endpoint setup or human-led recovery, consult [Beads integration](docs/beads-integration.md). Never merge `tracker/state` into code branches or edit generated JSONL for routine updates. Tracker publication does not authorize committing or pushing application code.
