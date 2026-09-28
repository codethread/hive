# Development

## Setup

```sh
bun install
```

`prepare` installs the Husky hooks automatically.

## Checks

- `bun run check` — everything: format check, lint and typecheck. Run this before committing.
- `bun run fmt` / `bun run fmt:check` — write or verify formatting.
- `bun run lint` / `bun run lint:fix` — oxlint with strict categories.
- `bun run typecheck` — `tsc --noEmit` at the repo root and in every workspace.

## Tests

Vitest runs against the TypeScript sources. Test files are colocated (`src/*.test.ts`) and follow the table-driven style from `.agents/skills/testing/SKILL.md`.

- `bun run test` — every package from the repo root, using the `minimal` reporter: passing tests produce no per-test output, failures print in full.
- `bun run test --project @hive/shared` — one package by name or glob.
- `bun run test --reporter=verbose` — per-test durations, needed when checking the testing skill's 1ms speed budget.
- `bun run test` inside a package delegates to the root config with `--root ../..`; vitest 5 does not look up parent configs on its own.

## Commit gates

Husky runs on every commit:

- `pre-commit` — lint-staged auto-fixes staged files (`oxlint --fix`, then `oxfmt`) and a repo-wide typecheck runs afterwards. A staged violation blocks the commit.
- `commit-msg` — commitlint enforces Conventional Commits.

Run `bun run prepare` (or bare `bunx husky`) to reinstall the hooks. Husky has no `--version` flag: any argument, including `--version`, is treated as the hooks directory and will move `core.hooksPath` there.

## Formatting

oxfmt uses tabs and never wraps prose (`useTabs: true`, `proseWrap: "never"`); all other options are defaults. It formats TypeScript, JSON and Markdown, so no manual formatting decisions are needed: run `bun run fmt` and commit the result.
