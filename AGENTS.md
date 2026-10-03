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

## Agent skills

### Issue tracker

Work is tracked in Beads via `br`. For skill issue operations, see `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: root `GLOSSARY.md` and `docs/adr/`. Before exploring, follow `docs/agents/domain.md`.

## Beads / br

Track work and implementation steps in repo-local Beads with `br`, from the repository root, instead of native harness todo lists. Start with the work assigned by the user or coordinating agent; do not run triage to replace it with a different task. `bv` is for read-only work selection, prioritization, and coordination—not a prerequisite for execution. Never run bare `bv`, which launches an interactive TUI.

All worktrees use the selected `BEADS_DB`, normally `.worktrees/tracker--state/.beads/beads.db` beneath the canonical root. Its permanent full checkout stays on `tracker/state`; do not finish, recycle or remove it as feature work. Configure a checkout with `bun run beads:setup --db /absolute/path/to/.beads/beads.db`, or inherit the canonical checkout's selection with `bun run beads:setup --source <canonical-root>`. Setup writes ignored project environment files for mise and Codex. Honor the selected endpoint; do not derive a replacement from the current worktree or initialize a private database. Existing sessions retain their old environment, so pass the selected `--db` explicitly until restarted.

Automatic import and export are enabled. Native `br` updates the shared SQLite database and its tracker checkout's JSONL without Git operations; code branches carry no live tracker snapshot. `bun run beads:sync` receives compatible remote changes and commits/pushes the combined snapshot on `tracker/state`. Run it immediately after every claim, before branching or starting that work, and after closure, handoff or landing updates. A claim is provisional until synchronization succeeds. Session-start and pre-commit hooks also sync; ordinary commands and agent tools do not. `bun install` configures new Honeycomb worktrees from canonical mise settings. Each publication includes other agents' ongoing work as well as completed tasks.

Synchronization combines independent tracker changes automatically and stops on conflicting records or claims. Resolve a reported conflict before further tracker work; keep unrelated changes and yield to an already-published competing claim. Timestamps and forced sync are not ownership decisions. There is no per-tool health gate or periodic remote check. If synchronization fails, stop tracker work and report it. Manual recovery happens from a separate human terminal with tracker writers paused: use the native executable and selected `--db` for an explicit flush and tracker-only commit before Git integration, then status and unforced merge. Resume only after `bun run beads:sync` succeeds. Never merge `tracker/state` into a code branch.

A parent claim does not assign its children. Reserve only the feature scope intended to be exclusive, and claim or delegate children explicitly; an epic shared by colleagues is not an exclusive reservation. Same-harness sessions share an actor name under the current identity policy, so record enough scope and worktree context in notes to distinguish continuation from a competing session.

Write each bead so another agent can act without the originating conversation: explain the problem, scope, relevant code or documentation pointers, and observable completion criteria. Scale detail to the work; leave unnecessary fields unset rather than filling a template mechanically.

Beads labelled `system` are reserved for automation, do not browse them; access requires an explicit system-maintenance or debugging assignment. Exclude them from day-to-day `br search`, `br list`, and `br ready` queries with `--exclude-label system`; use `bv --recipe work --robot-triage` for ordinary work selection.

Identity and ownership:

- **Owner:** Always set `--owner ct` when creating or claiming a bead, including child beads. Ownership does not assign the work to ct.
- **Actor:** Agents must supply their own identity on every mutation: pass `--actor` or set `BD_ACTOR` in the agent's process environment to the harness name (`pi`, `claude`, or `codex`). Never act as `ct` or rely on the `USER` fallback in agent runs. Do not persist an agent identity in shared config or the user's shell; human shell commands should retain the normal `USER` fallback. No `--agent-name`, `--harness`, or `--model` metadata is required.
- **Assignee:** `--claim` assigns the actor and starts work; no separate `--assignee` is needed. Agent work stays assigned to an agent. Assign `ct` only for a deliberate human handoff, such as review, and record the action needed. Treat an existing `ct` assignment as reserved for human action: do not claim, clear, or replace it without ct's instruction.

The commands below assume the agent has set `BD_ACTOR`; otherwise add `--actor` to each mutation.

1. **Identify:** If given a bead ID within the permitted scope, run `br show <id> --json`. Otherwise, use `br search "<topic>" --exclude-label system --json` to find an existing bead; if none fits, create one with `br create --title="..." --type=task --priority=2 --owner ct --description="Problem, scope, and relevant context" --acceptance-criteria="- [ ] Observable completion outcome" --json`.
2. **Claim:** Before implementation, run `br update <id> --claim --owner ct --json`, then `bun run beads:sync`. Do not begin work until synchronization succeeds. Respect existing assignments and blockers; do not force a claim. A request to just record work ("bead this") stops after creation and sync, without claiming or implementing it.
3. **Work:** Break multi-step work, especially features, into child beads so steps can be claimed, verified, and closed incrementally. Keep the current approach and rationale in `br update <id> --design="..." --json`; append progress, discoveries, blockers, and handoff next steps with `br update <id> --append-notes="..." --json`. Pass the relevant bead ID when delegating; reuse it for the same scope rather than creating duplicates.
4. **Finish:** Verify the acceptance criteria, mark checklist items complete only with evidence, record verification commands and results in notes, then `br close <id> --reason="Completed: <specific proof>" --json`. Implementation-only children can close when their criteria are met; a scope requiring landing stays open until integration and tracker publication. Leave unfinished or blocked work open with a clear next step. Run `bun run beads:sync` after closure or handoff so peers receive the result.

Use `task` for scoped work, `bug` for defects, `feature` for new capability, and `epic` for a larger effort; `chore` and `docs` cover maintenance and documentation. Nesting is not limited to epics: any bead can have children, and children can have their own children. Create a step with `br create --title="..." --type=task --parent=<parent-id> --owner ct --json`; use as many levels as useful (e.g. feature → task → subtask), without splitting trivial work unnecessarily. Close a parent only after its children and overall completion criteria are satisfied.

Priorities run P0 (critical) through P4 (backlog), with P2 for normal work. Parent-child links group work; record execution prerequisites separately with `br dep add <issue> <depends-on>`: the first issue is blocked by the second.

`.beads/issues.jsonl` is generated in the tracker checkout. Make routine task changes through `br`; the exception is reviewed Git conflict resolution selecting existing records while preserving unrelated changes. Preserve any older private database and reconcile unpublished state before retiring its checkout. After landing code, record evidence, close completed tasks and publish on `tracker/state`. Tracker commands do not grant permission to commit or push application code.
