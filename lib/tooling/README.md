# Repository tooling

## Beads contract tests

Run `bun test ./lib/tooling/tests/contract/` from the checkout root to verify the native Beads bootstrap and saved-query contracts. These checks use real Git, `br` and `mise` executables and retain their explicit timeouts.

Contract tests verify behavior at a third-party boundary; integration tests verify cooperation between Hive components.

## Changed-test report

From the checkout root, run `bun run test:changed`. Extra Bun test arguments are forwarded, for example `bun run test:changed --changed=main` or `bun run test:changed ./lib/shared/src/bees.test.ts`.

The runner uses the repository's `test:all` script with `--changed=main` and a temporary JUnit report, parsed with Bun's built-in XML parser (Bun 1.4+). Successful runs print only unapproved slow tests, slowest first:

```text
lib/example.test.ts:42 XSLOW 12.345ms suite > test description
```

Severity is the highest cutoff strictly exceeded: `SLOW` above 1ms, `XSLOW` above 5ms, `DANGER` above 1000ms. Exactly 1ms is quiet. Timing warnings do not change Bun's exit code. A run with no selected tests is quiet.

Failed runs replay Bun's native diagnostics, including errors outside individual tests that JUnit may omit. Failed and skipped tests do not get additional timing lines. The temporary report is removed after the run.

### Allowed slow tests

[`slow-tests.json`](./slow-tests.json) holds the cutoffs and approved allowances. It starts with no allowances. Each entry requires a justification and the highest permitted severity:

```json
{
	"thresholdMs": { "SLOW": "1", "XSLOW": "5", "DANGER": "1000" },
	"tests": {
		"#test-1": {
			"threshold": "SLOW",
			"justification": "Approved filesystem fixture"
		}
	}
}
```

Put the ID anywhere in the test description, such as `test('manages pool slots #test-1', ...)`. IDs in enclosing `describe` titles also apply. The complete numeric ID is matched, so `#test-1` does not allow `#test-10`; file moves and other title changes do not affect the allowance.

With the default cutoffs, `SLOW` suppresses timing lines through 5ms, `XSLOW` through 1000ms, and `DANGER` has no timing-report ceiling. Allowances never suppress failures or change test timeouts. Allocate the next unused incrementing ID and retain it when moving the test. Adding an allowance records an explicit user approval, not an automatic response to a warning.
