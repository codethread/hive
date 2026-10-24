import { z } from "zod";

const severities = ["SLOW", "XSLOW", "DANGER"] as const;
const millisecondsPerSecond = 1000;
const durationPrecision = 3;
const minimumTextLength = 1;
const successExitCode = 0;
const failureExitCode = 1;
const fullSuiteTimingMultiplier = 1.25;
const exactTimingMultiplier = 1;
const timingMultipliers = { all: fullSuiteTimingMultiplier, changed: exactTimingMultiplier };
const emptyTimingReportLength = 0;
const nonemptyText = z.string().trim().min(minimumTextLength);
const milliseconds = z
	.union([z.number(), nonemptyText])
	.pipe(z.coerce.number<string | number>().positive());
const testAllowance = z.strictObject({
	threshold: z.enum(severities),
	justification: nonemptyText,
});
const allowanceSchema = z
	.strictObject({
		thresholdMs: z.strictObject({ SLOW: milliseconds, XSLOW: milliseconds, DANGER: milliseconds }),
		tests: z.record(z.string().regex(/^#test-[1-9]\d*$/u), testAllowance),
	})
	.refine(
		({ thresholdMs }) =>
			thresholdMs.SLOW < thresholdMs.XSLOW && thresholdMs.XSLOW < thresholdMs.DANGER,
		"Timing thresholds must increase: SLOW < XSLOW < DANGER",
	);
const testAttributes = z.object({
	name: z.string(),
	classname: z.string(),
	file: nonemptyText,
	line: z.string().regex(/^\d+$/u),
	time: nonemptyText.pipe(z.coerce.number<string>().nonnegative()),
});

/** Validated cutoffs in milliseconds and maximum permitted severity per test ID. */
export type Allowances = z.infer<typeof allowanceSchema>;

/**
 * Validated passing case with decoded name/classname, nonempty file and digit-only line text.
 * The numeric time is nonnegative and measured in seconds.
 */
export type TestTiming = z.infer<typeof testAttributes>;

interface TimingRun {
	/** Cutoff policy from {@link TestRun.mode}. */
	mode: TestRun["mode"];
	/** Native status from {@link TestRun.exitCode}. */
	exitCode: number;
	/** Cases satisfying {@link TestTiming}; callers exclude failed, errored and skipped cases. */
	testCases: readonly TestTiming[];
}

interface TestRun {
	/** Changed runs use exact cutoffs; full/contract runs apply a 25% buffer to every cutoff. */
	mode: "all" | "changed";
	/** Native Bun exit status, retained when tests fail. */
	exitCode: number;
	/** JUnit contents, absent when Bun did not write a report. */
	xml: string | undefined;
	/** Native output used to recognize an empty changed-test selection. */
	output: string;
}

interface TestRunFeedback {
	/** Complete unsuppressed timing report, slowest first. */
	lines: string[];
	/** Native failure status or failure for any unapproved timing severity. */
	exitCode: number;
	/** Remediation printed after the complete timing report. */
	guidance: string | undefined;
}

export function parseSlowTestAllowances(value: unknown): Allowances {
	return allowanceSchema.parse(value);
}

/** Report passing tests above their allowed severity; failures stay in Bun's diagnostics. */
export function reportSlowTests(xml: string, allowances: Allowances): string[] {
	return reportTestTimings(
		{ mode: "changed", exitCode: successExitCode, testCases: decodeTestTimings(xml) },
		allowances,
	).lines;
}

export function reportTestRun(run: TestRun, allowances: Allowances): TestRunFeedback {
	if (run.xml === undefined) {
		if (
			run.exitCode === successExitCode &&
			!(run.mode === "changed" && /Ran 0 tests across 0 files\./u.test(run.output))
		) {
			throw new Error("Bun succeeded without a JUnit report or an empty changed-test run");
		}
		return { lines: [], exitCode: run.exitCode, guidance: undefined };
	}
	return reportTestTimings(
		{ mode: run.mode, exitCode: run.exitCode, testCases: decodeTestTimings(run.xml) },
		allowances,
	);
}

/** Apply timing policy to trusted inputs without parsing or runtime validation. */
export function reportTestTimings(run: TimingRun, allowances: Allowances): TestRunFeedback {
	const timings = collectSlowTests(run.testCases, allowances, timingMultipliers[run.mode]);
	const lines = timings.map(({ line }) => line);
	if (lines.length === emptyTimingReportLength) {
		return { lines, exitCode: run.exitCode, guidance: undefined };
	}
	return {
		lines,
		exitCode: run.exitCode || failureExitCode,
		guidance:
			"ERROR test timing: unapproved SLOW, XSLOW or DANGER timings fail this run. Refactor " +
			"meaningful tests, setup or dependency seams, " +
			"preserving meaningful coverage. If opportunities to " +
			"refactor or improve the failing tests are exhausted, delete those " +
			"tests. Rerun bun run test:changed with strict cutoffs, then bun run check, " +
			"both at normal default parallelism.",
	};
}

// --- Private functions ---

function decodeTestTimings(xml: string): TestTiming[] {
	const root = Bun.XML.parse(xml, { compact: false });
	if (root.name !== "testsuites") {
		throw new Error("Expected Bun JUnit testsuites report");
	}
	return collectTestCases(root)
		.filter(
			(testCase) =>
				!elements(testCase).some((child) => ["failure", "error", "skipped"].includes(child.name)),
		)
		.map((testCase) => testAttributes.parse(testCase.attributes));
}

function collectSlowTests(
	testCases: readonly TestTiming[],
	allowances: Allowances,
	multiplier: number,
) {
	return testCases
		.toSorted((left, right) => right.time - left.time)
		.flatMap((testCase) => {
			const durationMs = testCase.time * millisecondsPerSecond;
			const severity = severities.findLast(
				(level) => durationMs > allowances.thresholdMs[level] * multiplier,
			);
			if (!severity) {
				return [];
			}
			const description = [testCase.classname, testCase.name].filter(Boolean).join(" > ");
			// Match the full numeric ID anywhere in the description: #test-1 is not #test-10.
			const permitted = [...description.matchAll(/#test-[1-9]\d*/gu)].some(([id]) => {
				const allowance = allowances.tests[id];
				return allowance && severities.indexOf(allowance.threshold) >= severities.indexOf(severity);
			});
			if (permitted) {
				return [];
			}
			return [
				{
					severity,
					line:
						`${testCase.file}:` +
						`${testCase.line} ` +
						`${severity} ` +
						`${durationMs.toFixed(durationPrecision)}ms ` +
						`${description.replaceAll(/\s+/gu, " ")}`,
				},
			];
		});
}

function collectTestCases(node: Bun.XML.Node): Bun.XML.Node[] {
	return elements(node).flatMap((child) => {
		if (child.name === "testcase") {
			return [child];
		}
		if (child.name === "testsuite") {
			return collectTestCases(child);
		}
		return [];
	});
}

function elements(node: Bun.XML.Node): Bun.XML.Node[] {
	return node.children.filter(
		(child): child is Bun.XML.Node => typeof child !== "string" && "name" in child,
	);
}
