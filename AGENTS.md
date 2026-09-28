# Hive

Hive is a strict TypeScript monorepo providing coding agent tooling. It ships `colony`, a CLI that abstracts over model providers, and `ghost`, the daemon process that runs it, on top of a shared core.

## Worktrees

This repo uses `wktree` for Git worktrees (see `wktree -h`). Always work in a worktree unless given specific guidance to do otherwise.

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

## Architecture rules

- Packages may only import from `shared`. `colony` and `ghost` must not import each other.
- Cross-package imports must use the `@hive/shared` package specifier; relative paths that traverse into another package are rejected.
- `shared` must never import `colony` or `ghost`.
- `.oxlintrc.json` enforces these rules through per-package `no-restricted-imports` overrides.

## Conventions

- Strict TypeScript runs directly on Bun; there is no build step and no emit. `tsc --noEmit` is the gate.
- Tabs for indentation and unwrapped prose, enforced by oxfmt (`useTabs: true`, `proseWrap: "never"`); all other formatting options are defaults.
- Named exports only; functions are arrow function expressions (`func-style`).
- Conventional Commits, enforced by commitlint on `commit-msg`.

## Commands

- `bun install`
- `bun run check` — `fmt:check` + `lint` + `typecheck`; run before every commit.
- `bun run fmt` / `bun run fmt:check`
- `bun run lint` / `bun run lint:fix`
- `bun run typecheck`

Husky runs the gates on commit: `pre-commit` runs lint-staged and a repo-wide typecheck, `commit-msg` runs commitlint.

## Where to look

- `docs/` — architecture and development documentation.
- `.agents/skills/` — agent skills; `.claude/skills` symlinks to it. Start with the `welcome` skill when orienting.
