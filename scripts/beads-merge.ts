import { errorDetail } from "./beads-jsonl.ts";
import { mergeIssueJsonl } from "./beads-merge-core.ts";

const DRIVER_ARGUMENT_COUNT = 3;
const EXIT_CONFLICT = 1;
const EXIT_INVALID = 2;
const EXIT_SUCCESS = 0;
const PROCESS_ARGUMENT_OFFSET = 2;

type DriverPaths =
	| {
			/** Common-ancestor temporary file supplied by Git. */
			readonly ancestor: string;
			/** Current-side temporary file that the driver must overwrite. */
			readonly current: string;
			/** Indicates a valid Git merge-driver invocation. */
			readonly kind: "valid";
			/** Other-side temporary file supplied by Git. */
			readonly other: string;
	  }
	| {
			/** Indicates an invalid command-line invocation. */
			readonly kind: "invalid";
	  };

function parseDriverPaths(arguments_: readonly string[]): DriverPaths {
	if (arguments_.length !== DRIVER_ARGUMENT_COUNT) {
		return { kind: "invalid" };
	}
	const [ancestor, current, other] = arguments_;
	if (ancestor === undefined || current === undefined || other === undefined) {
		return { kind: "invalid" };
	}
	return { ancestor, current, kind: "valid", other };
}

async function executeMerge(paths: Exclude<DriverPaths, { kind: "invalid" }>): Promise<number> {
	const [ancestor, current, other] = await Promise.all([
		Bun.file(paths.ancestor).text(),
		Bun.file(paths.current).text(),
		Bun.file(paths.other).text(),
	]);
	const result = mergeIssueJsonl(ancestor, current, other);
	if (result.kind === "invalid") {
		console.error(`beads merge refused invalid input: ${result.message}`);
		return EXIT_INVALID;
	}
	await Bun.write(paths.current, result.contents);
	if (result.kind === "conflicted") {
		console.error(`beads merge conflict: ${result.issueIds.join(", ")}`);
		return EXIT_CONFLICT;
	}
	return EXIT_SUCCESS;
}

async function run(arguments_: readonly string[]): Promise<number> {
	const paths = parseDriverPaths(arguments_);
	if (paths.kind === "invalid") {
		console.error("usage: beads-merge.ts <ancestor> <current> <other>");
		return EXIT_INVALID;
	}
	try {
		return await executeMerge(paths);
	} catch (error) {
		console.error(`beads merge failed: ${errorDetail(error)}`);
		return EXIT_INVALID;
	}
}

if (import.meta.main) {
	process.exitCode = await run(process.argv.slice(PROCESS_ARGUMENT_OFFSET));
}
