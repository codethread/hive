---
name: testing
description: Select focused and changed tests during Hive development. Also use for test changes, fixtures, fakes, mocks and designing services for testability.
---

# Testing

## Running tests

Use the configured default parallelism for normal test runs.

From the worktree root, run focused files while iterating, for example `bun test ./lib/shared/src/bees.test.ts`.

When the affected scope is a package, select its test script with Bun workspace filtering, for example `bun run --filter @hive/shared test`. Packages without a test script use focused files. Keep slow test selection scoped to the affected package.

Run `bun run test:changed` at intervals, such as completing a subtask, to check affected tests and enforce strict timing cutoffs.

## Writing tests

- Import APIs from `bun:test`. Prefer `test.each` / `it.each` when cases share setup and assertions; use a plain test when a table would be artificial.
- Keep table rows pure data, without functions, promises, side effects or assertions.
- Assert failures by error class (`toBeInstanceOf`), not hardcoded message strings. When a message's interpolated values are what the test proves, snapshot it with `toMatchInlineSnapshot`.
- Inject service dependencies so unit tests can use fakes or overrides. Keep real IO in independently selectable integration/end-to-end suites.
- Scripts already parallelise isolated test files. Keep tests sequential within files sharing mutable fixtures or environment state.

## Timing

Check runner-reported durations when adding or editing unit tests and aim for fast, focused tests. All unapproved timing severities and test timeouts require the remediation below.

Use the [timing report guide](../../../lib/tooling/README.md#test-timing-report-and-landing-gate) for cutoff, full/contract buffer and allowance rules. If timing fails, use focused reruns or `--parallel=1` to diagnose resource contention or a slow individual test.

### Addressing slow tests

1. Re-read this skill's writing and integration guidance. Ask: "What is the value of this test?" and "What isolated behaviour is under test here?"
2. First reduce runtime by refactoring the test, its setup or the code's dependency seams while preserving meaningful coverage. Keep tests focused on coherent behaviours; do not split a slow test into artificial pieces merely to get each piece below the threshold.
3. If tests still fail timeouts or timing thresholds after exhausting opportunities to refactor or improve them, delete those tests.
4. Rerun `bun run test:changed` with strict cutoffs, then the full completion check required by the [validation policy](../../../AGENTS.md#validation), both at normal default parallelism.

## Integration testing

Seams between systems need testing to verify contract adherence, but this should only be validated once. After that most tests can rely on a mock or fixture built against the validated contracted.
