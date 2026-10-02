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

Husky reconciles and stages Beads state before commits and merges, runs `lint-staged` and a repo-wide typecheck, and rejects staged conflict markers. It also reconciles Beads after merges and branch checkouts. Commitlint runs on `commit-msg`; hooks do not run tests.

## Where to look

- `docs/` — architecture documentation.

## Beads / br

Track work and implementation steps in repo-local Beads with `br`, from the repository root, instead of native harness todo lists. Start with the work assigned by the user or coordinating agent; do not run triage to replace it with a different task. `bv` is for read-only work selection, prioritization, and coordination—not a prerequisite for execution. Never run bare `bv`, which launches an interactive TUI.

Identity and ownership:

- **Owner:** Always set `--owner ct` when creating or claiming a bead, including child beads. Ownership does not assign the work to ct.
- **Actor:** Agents must supply their own identity on every mutation: pass `--actor` or set `BD_ACTOR` in the agent's process environment to the harness name (`pi`, `claude`, or `codex`). Never act as `ct` or rely on the `USER` fallback in agent runs. Do not persist an agent identity in shared config or the user's shell; human shell commands should retain the normal `USER` fallback. No `--agent-name`, `--harness`, or `--model` metadata is required.
- **Assignee:** `--claim` assigns the actor and starts work; no separate `--assignee` is needed. Agent work stays assigned to an agent. Assign `ct` only for a deliberate human handoff, such as review, and record the action needed. Treat an existing `ct` assignment as reserved for human action: do not claim, clear, or replace it without ct's instruction.

The commands below assume the agent has set `BD_ACTOR`; otherwise add `--actor` to each mutation.

1. **Identify:** If given a bead ID, run `br show <id> --json`. Otherwise, use `br search "<topic>" --json` to find an existing bead; if none fits, create one with `br create --title="..." --type=task --priority=2 --owner ct --description="Scope and completion criteria" --json`.
2. **Claim:** Before implementation, run `br update <id> --claim --owner ct --json`. Respect existing assignments and blockers; do not force a claim. A request to just record work ("bead this") stops after creation and sync, without claiming or implementing it.
3. **Work:** Break multi-step work, especially features, into child beads so steps can be claimed, verified, and closed incrementally. Keep progress, decisions, blockers, and handoff context in `br update <id> --append-notes="..." --json`. Pass the relevant bead ID when delegating; reuse it for the same scope rather than creating duplicates.
4. **Finish:** Verify the work, record the verification in notes, then `br close <id> --reason="Completed" --json`. Leave unfinished or blocked work open with a clear next step.

Use `task` for scoped work, `bug` for defects, `feature` for new capability, and `epic` for a larger effort; `chore` and `docs` cover maintenance and documentation. Nesting is not limited to epics: any bead can have children, and children can have their own children. Create a step with `br create --title="..." --type=task --parent=<parent-id> --owner ct --json`; use as many levels as useful (e.g. feature → task → subtask), without splitting trivial work unnecessarily. Close a parent only after its children and overall completion criteria are satisfied.

Priorities run P0 (critical) through P4 (backlog), with P2 for normal work. Parent-child links group work; record execution prerequisites separately with `br dep add <issue> <depends-on>`: the first issue is blocked by the second.

`.beads/issues.jsonl` is generated and included in normal commits by the pre-commit hook; ignore incidental diffs and do not edit it manually. Tracker commands do not grant permission to commit or push application code.
