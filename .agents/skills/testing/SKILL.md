---
name: testing
description: Testing conventions for hive. Use for any test change or addition — new tests, edited tests, fixtures, fakes or mocks — and when designing services for testability.
---

# Testing

## Table-driven tests

Favour pure `test.each` tables in every test — vitest's `it.each` is the same API: enumerate cases as data and keep the test body to the assertion.

```ts
const cases = [
	{ expected: "Hello, world!", name: "world" },
	{ expected: "Hello, hive!", name: "hive" },
] as const;

it.each(cases)("greets $name", ({ name, expected }) => {
	expect(hello(name)).toBe(expected);
});
```

- Keep table rows pure data: no functions, promises, side effects or assertions in the table.
- Reach for a plain `it` only when a table would collapse to a single artificial row, such as a no-argument call.

## Dependency injection

All services follow dependency injection so tests can replace them with overrides or fake implementations.

## Speed budget

- Always check the test time when adding or editing tests, and ensure new tests run inside 1ms as reported by the runner.
- The default `minimal` reporter hides per-test durations: run `bun run test --reporter=verbose` to check the budget.
- Tests may reach up to 5s only when given explicit authorisation from the user.

## Concurrency and IO

- Maximise concurrency and minimise IO: favour fakes and overrides over actual network or disk reads.
