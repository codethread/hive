# Deferred test cases

These Given/When/Then scenarios preserve the behavior verified by tests removed during the October 10, 2026 timing cleanup. Restoration mappings identify the original executable checks. Remaining tests may cover parts of the same behavior.

- [Colony](colony.md): 44 cases, including 43 cases in files whose tests deliberately extended the five-second suite timeout, and one additional measured DANGER case.
- [Busy Bee](busybee.md): 45 measured DANGER cases.
- [Qlock](qlock.md): one measured DANGER case.
- [Tooling](tooling.md): two redundant lint-staged configuration rows removed at the user's request, outside the measured DANGER cleanup.

The baseline ran 753 tests successfully in 293.75 seconds. DANGER means an individual passing test exceeded 1000ms in that run. Removing a whole file with explicit timeout extensions also removed its faster cases; those cases are included in these records.

Original source is retained in Git at `61e736f8e1f4bfad9b7338e140d33938d0426f71`. Every source pointer below refers to that revision. Retrieve a file with:

```sh
git show 61e736f8e1f4bfad9b7338e140d33938d0426f71:lib/colony/src/scheduler.smoke.test.ts
```

The deferred work is tracked in Beads as `hv-luv2v`; the cleanup and scout inventories are under `hv-hu8eo`. When revisiting a scenario, identify the contract worth preserving and use focused dependencies or a separately selectable boundary check. Existing timeouts are evidence of the original setup, not approved timeouts for replacement tests.

Dedicated Beads bootstrap and saved-query checks remain executable under `lib/tooling/tests/contract/`, with explicitly user-approved timing allowances in `lib/tooling/slow-tests.json`. Merge-driver tests, publication checks and the opt-in native harness verification script remain. Other third-party contract-test candidates require discussion before promotion.
