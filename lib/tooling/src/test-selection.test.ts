import { expect, test } from "bun:test";
import { selectTestRuns } from "./test-selection.ts";

const last = -1;
const beads = "./lib/beads/tests/contract/";
const bv = "./lib/shared/tests/contract/";
const honeycomb = "./lib/honeycomb/tests/contract/";

test.each([
	{ path: "lib/beads/src/native.ts", expected: [beads, bv] },
	{ path: "lib/beads/src/memory.ts", expected: [beads, bv] },
	{ path: "lib/beads/src/types.ts", expected: [beads, bv] },
	{ path: "lib/beads/tests/contract/conformance.test.ts", expected: [beads] },
	{ path: "lib/beads/tests/contract/fixtures.ts", expected: [beads] },
	{ path: "lib/beads/package.json", expected: [beads, bv] },
	{ path: "lib/shared/src/bv.ts", expected: [bv] },
	{ path: "lib/shared/src/bv.test.ts", expected: [bv] },
	{ path: "lib/shared/src/bees-io.ts", expected: [bv] },
	{ path: "lib/shared/package.json", expected: [bv] },
	{ path: "lib/shared/tsconfig.json", expected: [bv] },
	{ path: "lib/shared/tests/contract/bv.test.ts", expected: [bv] },
	{ path: "lib/shared/tests/contract/fixtures.ts", expected: [bv] },
	{ path: "package.json", expected: [beads, bv, honeycomb] },
	{ path: "bun.lock", expected: [beads, bv, honeycomb] },
	{ path: "bunfig.toml", expected: [beads, bv, honeycomb] },
	{ path: "mise.toml", expected: [beads, bv, honeycomb] },
	{ path: "lib/tooling/src/test-selection.ts", expected: [beads, bv, honeycomb] },
	{ path: "lib/tooling/src/test-runner.ts", expected: [beads, bv, honeycomb] },
	{ path: "lib/honeycomb/src/application/branches.ts", expected: [honeycomb] },
	{ path: "lib/honeycomb/src/services.ts", expected: [honeycomb] },
	{ path: "lib/honeycomb/src/errors.ts", expected: [honeycomb] },
	{ path: "lib/honeycomb/src/git/error.ts", expected: [honeycomb] },
	{ path: "lib/honeycomb/src/git/executor.ts", expected: [honeycomb] },
	{ path: "lib/honeycomb/src/git/worktrees.ts", expected: [honeycomb] },
	{ path: "lib/honeycomb/tests/contract/local-git-refs.test.ts", expected: [honeycomb] },
	{ path: "lib/honeycomb/tests/contract/local-git-refs-fixture.ts", expected: [honeycomb] },
	{ path: "lib/honeycomb/tests/integration/lifecycle-helpers.ts", expected: [honeycomb] },
	{ path: "lib/honeycomb/tests/integration/support.ts", expected: [honeycomb] },
	{ path: "lib/honeycomb/package.json", expected: [honeycomb] },
	{ path: "lib/honeycomb/tsconfig.json", expected: [honeycomb] },
])(
	"adapter, contract or dependency input $path selects its native suites",
	({ path, expected }) => {
		for (const mode of ["all", "changed"] as const) {
			const runs = selectTestRuns(mode, [path]);
			expect(runs.map((run) => run.suite)).toEqual(["ordinary", "contracts"]);
			expect(runs.at(last)).toEqual({ suite: "contracts", args: [...expected], timingMode: "all" });
		}
	},
);

test.each([
	{ paths: [] },
	{ paths: ["lib/honeycomb/src/commands/add-worktree.ts"] },
	{ paths: ["lib/colony/src/ranking.ts", "lib/busybee/src/runtime.ts"] },
	{ paths: ["lib/beeswax/src/beads/setup.ts", "lib/hive-ui/server/index.ts"] },
	{ paths: ["lib/beads/README.md", "lib/beads/src-other/native.ts"] },
	{ paths: ["lib/shared/src/index.ts", "lib/shared/README.md"] },
])("consumer and documentation changes select only ordinary tests: $paths", ({ paths }) => {
	for (const mode of ["all", "changed"] as const) {
		expect(selectTestRuns(mode, paths)).toEqual([
			{
				suite: "ordinary",
				args: ["--path-ignore-patterns=**/tests/contract/**"],
				timingMode: mode,
			},
		]);
	}
});

test("explicit contracts run independently even with no changed inputs", () => {
	expect(selectTestRuns("contracts", [])).toEqual([
		{ suite: "contracts", args: [beads, bv, honeycomb], timingMode: "all" },
	]);
});

test("Beads and BV contracts remain selected among unrelated consumer changes", () => {
	const runs = selectTestRuns("changed", [
		"docs/README.md",
		"lib/colony/src/requests.ts",
		"lib/beads/tests/contract/native.test.ts",
		"lib/shared/src/bv.ts",
	]);
	expect(runs.at(last)?.args).toEqual([beads, bv]);
});
