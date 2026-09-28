---
name: testing
description: Testing conventions for hive. Use for any test change or addition — new tests, edited tests, fixtures, fakes or mocks — and when designing services for testability.
---

# Testing

## Table-driven tests

Import test APIs from `bun:test`. Favour pure `test.each` tables in every test — `it.each` is the same API: enumerate cases as data and keep the test body to the assertion.

```ts
const cases = [
	{ expected: "Hello, world!", name: "world" },
	{ expected: "Hello, hive!", name: "hive" },
];

it.each(cases)("greets $name", ({ name, expected }) => {
	expect(hello(name)).toBe(expected);
});
```

- Keep table rows pure data: no functions, promises, side effects or assertions in the table.
- Reach for a plain `it` only when a table would collapse to a single artificial row, such as a no-argument call.

## Dependency injection

All services follow dependency injection so tests can replace them with overrides or fake implementations.

## Speed budget

- Always check the test time when adding or editing unit tests, and ensure new unit tests run inside 1ms as reported by the runner.
- Package scripts hide passing output with `--only-failures`. Run `bun test --parallel --parallel-delay=0 ./lib/honeycomb/tests/unit` (or the relevant package/file path) to see per-test durations. The scripts' 5s runtime timeout does not enforce the 1ms reported-duration budget.
- Tests may reach up to 5s only when given explicit authorisation from the user.

## Concurrency and IO

- Maximise file concurrency with Bun's isolated `--parallel` workers. Keep tests sequential within files that share mutable fixtures or environment state.
- Minimise IO in unit tests: favour fakes and overrides. Real IO belongs in integration or end-to-end tests that exercise the relevant boundary; keep those layers independently selectable.
