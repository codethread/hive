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
- `bun run typecheck` — `tsc --noEmit` in every workspace, plus package-specific checks.

## Tests

Bun's built-in test runner executes the TypeScript sources directly. Import test APIs from `bun:test`. Test files are colocated (`src/*.test.ts`) or grouped by testing layer in package-local `tests/` directories, and follow the table-driven style from `.agents/skills/testing/SKILL.md`.

- `bun run test` — every package from the repo root, with passing output hidden and failures printed in full.
- `bun run test ./lib/shared` — one package by path; paths and `-t` select files and test names.
- `bun run --filter @hive/shared test` — one package through its workspace script; `bun run test` also works inside each package.
- `bun test --parallel --parallel-delay=0 ./lib/honeycomb/tests/unit` — print individual unit-test durations to check the testing skill's 1ms budget. The default console reporter includes durations; there is no verbose reporter flag.

Root discovery is restricted to `lib/` by `bunfig.toml`, which also excludes the Nushell wrapper. Each package script selects its own source or library test directory. Scripts use `--parallel` to run isolated files across the available CPU cores and `--parallel-delay=0` to start workers immediately. Tests inside each file remain sequential because the integration fixtures mutate shared environment and temporary-directory state. See [Bun's parallel execution guidance](https://bun.com/docs/test/parallel).

Honeycomb separates pure/injected unit tests from real Git/filesystem integration tests. Both run in the root and Honeycomb package suites; select a layer with `bun run --filter @hive/honeycomb test:unit` or `bun run --filter @hive/honeycomb test:integration`. Scripts explicitly set a 5s per-test runtime timeout. The stricter unit 1ms reported-duration budget remains a manual check; the runtime timeout does not enforce that budget.

The Nushell wrapper is independently checked with `bun run --filter @hive/honeycomb test:wrapper`. Root and library tests do not require Nushell. Bun emits GitHub Actions failure annotations automatically; add `--reporter=junit --reporter-outfile=/tmp/hive-tests.xml` when a structured report is needed.

## Commit gates

Husky runs on every commit:

- `pre-commit` — lint-staged auto-fixes staged files (`oxlint --fix`, then `oxfmt`) and a repo-wide typecheck runs afterwards. A staged violation blocks the commit.
- `commit-msg` — commitlint enforces Conventional Commits.

Run `bun run prepare` (or bare `bunx husky`) to reinstall the hooks. Husky has no `--version` flag: any argument, including `--version`, is treated as the hooks directory and will move `core.hooksPath` there.

## Formatting

oxfmt uses tabs and never wraps prose (`useTabs: true`, `proseWrap: "never"`); all other options are defaults. It formats TypeScript, JSON and Markdown, so no manual formatting decisions are needed: run `bun run fmt` and commit the result.
