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
- Assert failures by error class (`toBeInstanceOf`), not hardcoded message strings. When a message's interpolated values are what the test proves, snapshot it with `toMatchInlineSnapshot`.
- Inject service dependencies so unit tests can use fakes or overrides. Keep real IO in independently selectable integration/end-to-end suites.
- Scripts already parallelise isolated test files. Keep tests sequential within files sharing mutable fixtures or environment state.

## Timing

Check runner-reported durations when adding or editing unit tests. New unit tests must run within 1ms; slower tests require explicit user authorisation, up to 5s.

`bun run test:changed` reports failures and unapproved slow tests using JUnit timings. Timing warnings do not change the test exit code; inspect the output. Every change to [`lib/tooling/slow-tests.json`](../../../lib/tooling/slow-tests.json) requires explicit user sign-off on the proposed edit. Follow the process below before proposing an allowance.

`bun run test` uses `--only-failures`, which hides passing tests and their timings. Run `bun test <file>` directly to see individual timings.

### Addressing slow tests

1. Re-read this skill's writing and integration guidance. Ask: "What is the value of this test?" and "What isolated behaviour is under test here?"
2. First reduce runtime by refactoring the test, its setup or the code's dependency seams while preserving meaningful coverage. Keep tests focused on coherent behaviours; do not split a slow test into artificial pieces merely to get each piece below the threshold.
3. Rerun and inspect the duration. If the test genuinely requires more time, discuss the measured cost, why it is necessary and the proposed allowance or timeout with the user. Obtain explicit approval before changing the allowance registry or increasing the timeout, then record the approved exception using the [allowance registry guide](../../../lib/tooling/README.md#allowed-slow-tests).

## Integration testing

Seams between systems need testing to verify contract adherence, but this should only be validated once. After that most tests can rely on a mock or fixture built against the validated contracted.
