const emptySelectionCount = 0;
const beadsContractDirectory = "lib/beads/tests/contract/";
const bvContractDirectory = "lib/shared/tests/contract/";
const honeycombContractDirectory = "lib/honeycomb/tests/contract/";
const honeycombDependencyInputs = new Set([
	"lib/honeycomb/src/services.ts",
	"lib/honeycomb/src/errors.ts",
	"lib/honeycomb/src/git/error.ts",
	"lib/honeycomb/src/application/branches.ts",
	"lib/honeycomb/src/git/executor.ts",
	"lib/honeycomb/src/git/worktrees.ts",
	"lib/honeycomb/tests/integration/lifecycle-helpers.ts",
	"lib/honeycomb/tests/integration/support.ts",
	"lib/honeycomb/package.json",
	"lib/honeycomb/tsconfig.json",
]);
const contractDependencyInputs = new Set([
	"package.json",
	"bun.lock",
	"bunfig.toml",
	"mise.toml",
	"lib/tooling/src/test-selection.ts",
	"lib/tooling/src/test-runner.ts",
]);
const bvDependencyInputs = new Set([
	"lib/shared/src/bv.ts",
	"lib/shared/src/bv.test.ts",
	"lib/shared/src/bees-io.ts",
	"lib/shared/package.json",
	"lib/shared/tsconfig.json",
]);

export type TestMode = "all" | "changed" | "contracts";

export interface TestSelection {
	/** Independent Bun invocation; ordinary runs always exclude native contracts. */
	suite: "ordinary" | "contracts";
	/** Discovery arguments; contract invocations deliberately omit --changed. */
	args: string[];
	/** Ordinary changed runs use exact cutoffs; contracts and full runs apply a 25% buffer. */
	timingMode: "all" | "changed";
}

/** Select native contracts from their own inputs, never from consumer imports. */
export function selectTestRuns(mode: TestMode, changedPaths: readonly string[]): TestSelection[] {
	const directories = [beadsContractDirectory, bvContractDirectory, honeycombContractDirectory];
	if (mode === "contracts") {
		return [
			{ suite: "contracts", args: directories.map((path) => `./${path}`), timingMode: "all" },
		];
	}
	const ordinary: TestSelection = {
		suite: "ordinary",
		args: ["--path-ignore-patterns=**/tests/contract/**"],
		timingMode: mode,
	};
	const nativeBeadsChanged = changedPaths.some(
		(path) => path.startsWith("lib/beads/src/") || path === "lib/beads/package.json",
	);
	const globalChanged = changedPaths.some((path) => contractDependencyInputs.has(path));
	const selected = directories.filter(
		(directory) =>
			globalChanged ||
			(nativeBeadsChanged && directory !== honeycombContractDirectory) ||
			changedPaths.some((path) => path.startsWith(directory)) ||
			(directory === honeycombContractDirectory &&
				changedPaths.some((path) => honeycombDependencyInputs.has(path))) ||
			(directory === bvContractDirectory &&
				changedPaths.some((path) => bvDependencyInputs.has(path))),
	);
	if (selected.length === emptySelectionCount) {
		return [ordinary];
	}
	return [
		ordinary,
		{ suite: "contracts", args: selected.map((path) => `./${path}`), timingMode: "all" },
	];
}
