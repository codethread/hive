---
name: testing
description: Select and run tests after code changes in hive, including changed-code iteration and pre-commit validation. Also use for test changes, fixtures, fakes, mocks and designing services for testability.
---

# Testing

## Running tests

From the worktree root:

| Scope        | Example                                       |
| ------------ | --------------------------------------------- |
| One file     | `bun run test ./lib/shared/src/index.test.ts` |
| Changed code | `bun run test:changed`                        |
| Full suite   | `bun run test`                                |

## Writing tests

- Import APIs from `bun:test`. Prefer `test.each` / `it.each` when cases share setup and assertions; use a plain test when a table would be artificial.
- Keep table rows pure data, without functions, promises, side effects or assertions.
- Inject service dependencies so unit tests can use fakes or overrides. Keep real IO in independently selectable integration/end-to-end suites.
- Scripts already parallelise isolated test files. Keep tests sequential within files sharing mutable fixtures or environment state.

## Timing

Check runner-reported durations when adding or editing unit tests. New unit tests must run within 1ms; slower tests require explicit user authorisation, up to 5s.

Test scripts use `--only-failures`, which hides passing tests and their timings. Omit the flag to see timings.
