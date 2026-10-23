import { expect, test } from "bun:test";
import { selectTestRuns } from "./test-selection.ts";

const last = -1;
const beads = "./lib/beads/tests/contract/";
const bv = "./lib/shared/tests/contract/";

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
	{ path: "package.json", expected: [beads, bv] },
	{ path: "bun.lock", expected: [beads, bv] },
	{ path: "bunfig.toml", expected: [beads, bv] },
	{ path: "mise.toml", expected: [beads, bv] },
	{ path: "lib/tooling/src/test-selection.ts", expected: [beads, bv] },
	{ path: "lib/tooling/src/test-runner.ts", expected: [beads, bv] },
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
	{ paths: ["lib/colony/src/ranking.ts", "lib/busybee/src/runtime.ts"] },
	{ paths: ["lib/beeswax/src/beads/setup.ts", "lib/hive-ui/server/index.ts"] },
	{ paths: ["lib/beads/README.md", "lib/beads/src-other/native.ts"] },
	{ paths: ["lib/shared/src/index.ts", "lib/shared/README.md"] },
])(
	"consumer and documentation changes preserve ordinary coverage without native IO: $paths",
	({ paths }) => {
		for (const mode of ["all", "changed"] as const) {
			expect(selectTestRuns(mode, paths)).toEqual([
				{
					suite: "ordinary",
					args: ["--path-ignore-patterns=**/tests/contract/**"],
					timingMode: mode,
				},
			]);
		}
	},
);

test("explicit contracts run independently even with no changed inputs", () => {
	expect(selectTestRuns("contracts", [])).toEqual([
		{ suite: "contracts", args: [beads, bv], timingMode: "all" },
	]);
});

test("both native contracts are retained among unrelated consumer changes", () => {
	const runs = selectTestRuns("changed", [
		"docs/README.md",
		"lib/colony/src/requests.ts",
		"lib/beads/tests/contract/native.test.ts",
		"lib/shared/src/bv.ts",
	]);
	expect(runs.at(last)?.args).toEqual([beads, bv]);
});
