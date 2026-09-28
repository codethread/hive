---
name: testing
description: Testing conventions for hive. Use for any test change or addition — new tests, edited tests, fixtures, fakes or mocks — and when designing services for testability.
---

# Testing

## Dependency injection

All services follow dependency injection so tests can replace them with overrides or fake implementations.

## Speed budget

- Always check the test time when adding or editing tests, and ensure new tests run inside 1ms as reported by the runner.
- Tests may reach up to 5s only when given explicit authorisation from the user.

## Concurrency and IO

- Maximise concurrency and minimise IO: favour fakes and overrides over actual network or disk reads.
