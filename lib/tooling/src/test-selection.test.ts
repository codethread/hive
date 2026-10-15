import { expect, test } from "bun:test";
import { selectTestRuns } from "./test-selection.ts";

test.each([
	"lib/beads/src/native.ts",
	"lib/beads/src/memory.ts",
	"lib/beads/src/types.ts",
	"lib/beads/tests/contract/conformance.test.ts",
	"lib/beads/tests/contract/fixtures.ts",
	"lib/beads/package.json",
	"package.json",
	"bun.lock",
	"bunfig.toml",
	"mise.toml",
])("adapter, contract or dependency input %s selects the complete contract suite", (path) => {
	for (const mode of ["all", "changed"] as const) {
		const runs = selectTestRuns(mode, [path]);
		const contract = runs.find((run) => run.suite === "contracts");
		expect(runs.map((run) => run.suite)).toEqual(["ordinary", "contracts"]);
		expect(contract?.args).toEqual(["./lib/beads/tests/contract/"]);
		expect(contract?.timingMode).toBe("all");
	}
});

test.each([
	{ paths: [] },
	{ paths: ["lib/colony/src/requests.ts", "lib/busybee/src/runtime.ts"] },
	{ paths: ["lib/beeswax/src/beads/setup.ts", "lib/hive-ui/server/index.ts"] },
	{ paths: ["lib/beads/README.md", "lib/beads/src-other/native.ts"] },
	{ paths: ["lib/shared/src/index.ts"] },
])(
	"consumer and documentation changes preserve ordinary coverage without native IO: $paths",
	({ paths }) => {
		for (const mode of ["all", "changed"] as const) {
			expect(selectTestRuns(mode, paths)).toEqual([
				{
					suite: "ordinary",
					args: ["--path-ignore-patterns=lib/beads/tests/contract/**"],
					timingMode: mode,
				},
			]);
		}
	},
);

test("explicit contracts run independently even with no changed inputs", () => {
	expect(selectTestRuns("contracts", [])).toEqual([
		{ suite: "contracts", args: ["./lib/beads/tests/contract/"], timingMode: "all" },
	]);
});

test("a relevant input still selects contracts among unrelated consumer changes", () => {
	expect(
		selectTestRuns("changed", [
			"docs/README.md",
			"lib/colony/src/requests.ts",
			"lib/beads/src/native.ts",
		]).map((run) => run.suite),
	).toEqual(["ordinary", "contracts"]);
});
