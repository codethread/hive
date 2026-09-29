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
- `lib/honeycomb` — the Git worktree manager and Nushell wrapper.
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

<!-- br-agent-instructions-v1 -->

---

## Beads Workflow Integration

This project uses [beads_rust](https://github.com/Dicklesworthstone/beads_rust) (`br`) for issue tracking. Issues are stored in `.beads/` and tracked in git.

`.beads/issues.jsonl` is generated and included in normal commits by the pre-commit hook; ignore incidental diffs and do not edit it manually.

`bun install` requires `br`, registers the `hive-beads` merge driver, and bootstraps the local database from the tracked JSONL file. The driver automatically combines changes to different issue IDs and leaves incompatible changes to the same issue as an ordinary Git conflict. Resolve pull-request conflicts locally because hosted Git services do not run repository-local merge drivers.

Automatic Beads import and export are disabled in project configuration. Git hooks reconcile the database and JSONL through their shared merge anchor before either side can overwrite the other. If reconciliation reports that both sides changed the same issue, inspect the changes and explicitly choose `br sync --merge --force-db` or `br sync --merge --force-jsonl`; hooks never choose a winner.

### Essential Commands

```bash
# View ready issues (open, unblocked, not deferred)
br ready

# List and search
br list --status=open # All open issues
br show <id>          # Full issue details with dependencies
br search "keyword"   # Full-text search

# Create and update
br create --title="..." --description="..." --type=task --priority=2
br update <id> --claim
br close <id> --reason="Completed"
br close <id1> <id2>  # Close multiple issues at once

# Sync with git
br sync --merge   # Reconcile DB and JSONL through their merge anchor
br sync --status  # Check sync status
```

### Workflow Pattern

1. **Start**: Run `br ready` to find actionable work
2. **Claim**: Use `br update <id> --claim`
3. **Work**: Implement the task
4. **Complete**: Use `br close <id>`
5. **Sync**: Always run `br sync --merge` at session end

### Key Concepts

- **Dependencies**: Issues can block other issues. `br ready` shows only open, unblocked work.
- **Priority**: P0=critical, P1=high, P2=medium, P3=low, P4=backlog (use numbers 0-4, not words)
- **Types**: task, bug, feature, epic, chore, docs, question
- **Blocking**: `br dep add <issue> <depends-on>` to add dependencies

### Session Protocol

**Before ending any session, run this checklist:**

```bash
git status              # Check what changed
br sync --merge         # Reconcile beads changes with JSONL
```

### Best Practices

- Check `br ready` at session start to find available work
- Update status as you work (in_progress → closed)
- Create new issues with `br create` when you discover tasks
- Use descriptive titles and set appropriate priority/type
- Always reconcile with `br sync --merge` before ending a session

<!-- end-br-agent-instructions -->
