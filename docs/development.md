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
- `bun run typecheck` — `tsc --noEmit` in every workspace.

## Commit gates

Husky runs on every commit:

- `pre-commit` — lint-staged auto-fixes staged files (`oxlint --fix`, then `oxfmt`) and a
  repo-wide typecheck runs afterwards. A staged violation blocks the commit.
- `commit-msg` — commitlint enforces Conventional Commits.

## Formatting

oxfmt uses tabs and otherwise defaults. It formats TypeScript, JSON and Markdown, so no manual
formatting decisions are needed: run `bun run fmt` and commit the result.
