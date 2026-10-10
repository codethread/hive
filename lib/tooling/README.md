# Repository tooling

## Beads contract tests

Run `bun test ./lib/tooling/tests/contract/` from the checkout root to verify the native Beads bootstrap and saved-query contracts. These checks use real Git, `br` and `mise` executables and retain their explicit timeouts.

Contract tests verify behavior at a third-party boundary; integration tests verify cooperation between Hive components.

## Test timing report and landing gate

From the checkout root, run `bun run test:changed`. Extra Bun test arguments are forwarded, for example `bun run test:changed --changed=main` or `bun run test:changed ./lib/shared/src/bees.test.ts`.

The full suite (`bun run test:all`, also used by `bun run check`) and changed tests share a runner with the same parallelism and timeout. Changed tests select `--changed=main`. Both use a temporary JUnit report, parsed with Bun's built-in XML parser (Bun 1.4+), and print unapproved slow tests, slowest first:

```text
lib/example.test.ts:42 XSLOW 12.345ms suite > test description
```

Severity is the highest cutoff strictly exceeded: `SLOW` above 1ms, `XSLOW` above 5ms, `DANGER` above 1000ms. Exactly 1ms is quiet. Changed-test timing warnings do not change Bun's exit code; a run with no selected changed tests is quiet.

The full suite prints Bun's diagnostics and the complete timing report, then fails if any unapproved `DANGER` remains. `SLOW` and `XSLOW` are advisory. This gate blocks landing even when all tests pass. Refactor meaningful tests, setup or dependency seams while preserving coverage, then rerun checks. When a measured cost is necessary, propose the exact allowance and justification for explicit user sign-off before editing the registry.

Failed runs replay Bun's native diagnostics and retain its failure exit code, including errors outside individual tests that JUnit may omit. Failed and skipped tests do not get additional timing lines. Missing or malformed required reports fail loudly. The temporary report is removed after the run.

### Allowed slow tests

[`slow-tests.json`](./slow-tests.json) holds the cutoffs and approved allowances. Each entry requires a justification and the highest permitted severity:

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

With the default cutoffs, `SLOW` suppresses timing lines through 5ms, `XSLOW` through 1000ms, and `DANGER` has no timing-report ceiling and suppresses the matching landing gate failure. Allowances never suppress failures or change test timeouts. Allocate the next unused incrementing ID and retain it when moving the test. Every registry edit requires explicit user approval of the exact change.

## CLI artifacts

From the Hive root, `bun run --filter '*' build` compiles host executables using [Bun's standalone compiler](https://bun.com/docs/bundler/executables). Builds write only package-local `dist/` artifacts. `tsc --noEmit` remains the independent typechecking gate.

| Package   | Artifacts in its `dist/` directory                                    |
| --------- | --------------------------------------------------------------------- |
| Honeycomb | `honeycomb`                                                           |
| Colony    | `bee`, `colony`, `colony-runtime`, `colony-worker`, `colony-watchdog` |
| qlock     | `qlock`                                                               |
| Waggle    | `waggle`                                                              |
| Busy Bee  | `busybee`                                                             |
| Hive UI   | `hive-ui` (embedded browser assets)                                   |

Shared and Tooling expose no executable build contract. These are host builds, without cross-compilation or a release pipeline. Standalone executables embed Bun and static dependencies; they do not need the producing checkout at runtime. Native external tools remain required by each command. Busy Bee loads trusted workflow modules from the selected checkout, whose own dependencies must be installed. Its build explicitly enables Bun package and TypeScript configuration loading (`--compile-autoload-package-json --compile-autoload-tsconfig`): without package metadata, Bun 1.4.2 cannot resolve external workflow package imports; without TypeScript configuration, workflow path aliases fail. Both cases were verified against source execution. Waggle reads classifiers from the caller-selected directory. Neither catalog is baked into the executable.

`bun run --filter '*' install:bin` installs the already-built artifacts through the shared Tooling installer. Its `--directory <path>` option defaults to `~/.local/bin`; a missing artifact fails installation. Each executable is copied into destination-local staging, made executable, and renamed over the destination, replacing symlinks without modifying their targets. Colony's five executables must remain together. Stop and restart an existing daemon deliberately after updating its installed runtime.

`mise run` orders dependency installation, local builds, explicit installation and tracker bootstrap. `bun install` alone prepares a new worktree and never installs global commands.
