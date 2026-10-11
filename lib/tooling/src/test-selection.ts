const contractDirectory = "lib/beads/tests/contract/";
const contractDependencyInputs = new Set([
	"lib/beads/package.json",
	"package.json",
	"bun.lock",
	"bunfig.toml",
	"mise.toml",
]);

export type TestMode = "all" | "changed" | "contracts";

export interface TestSelection {
	/** Independent Bun invocation; ordinary runs always exclude native contracts. */
	suite: "ordinary" | "contracts";
	/** Discovery arguments; contract invocations deliberately omit --changed. */
	args: string[];
	/** Contracts and full runs enforce the timing gate. */
	timingMode: "all" | "changed";
}

/** Select native contracts from their own inputs, never from consumer imports. */
export function selectTestRuns(mode: TestMode, changedPaths: readonly string[]): TestSelection[] {
	const contracts: TestSelection = {
		suite: "contracts",
		args: [`./${contractDirectory}`],
		timingMode: "all",
	};
	if (mode === "contracts") {
		return [contracts];
	}
	const ordinary: TestSelection = {
		suite: "ordinary",
		args: [`--path-ignore-patterns=${contractDirectory}**`],
		timingMode: mode,
	};
	const relevant = changedPaths.some(
		(path) =>
			path.startsWith("lib/beads/src/") ||
			path.startsWith(contractDirectory) ||
			contractDependencyInputs.has(path),
	);
	if (relevant) {
		return [ordinary, contracts];
	}
	return [ordinary];
}
