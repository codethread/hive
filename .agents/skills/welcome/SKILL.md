---
name: welcome
description: >
  Orientation for the hive repository. Use when starting work in hive, when asked what hive is, where packages live, how to run checks, or which conventions apply.
---

# Welcome to hive

Hive is a strict TypeScript monorepo providing coding agent tooling. Bun runs the TypeScript sources directly; there is no build step.

## Layout

- `lib/shared` — utilities and models common to all packages. Not a grab bag; only add what consumers clearly need.
- `lib/colony` — CLI abstraction over providers.
- `lib/ghost` — the daemon process that runs.
- `docs/` — architecture and development documentation.
- `.agents/skills/` — agent skills (`.claude/skills` symlinks here).

## Hard rules

- Packages may only import from `shared` via the `@hive/shared` specifier. `colony` and `ghost` must not import each other; `shared` must not import either. `.oxlintrc.json` enforces this.
- Tabs, named exports, arrow function expressions, Conventional Commits.
- `bun run check` must pass before committing; Husky also enforces it on commit.

## Commands

- `bun run check` — format check + lint + typecheck.
- `bun run fmt`, `bun run lint`, `bun run typecheck` for individual gates.
- `bun install` sets up everything, including the Husky hooks.

Read `AGENTS.md` and the package-level `AGENTS.md` files before making changes.
