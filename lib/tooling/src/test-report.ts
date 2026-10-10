import { z } from "zod";

const severities = ["SLOW", "XSLOW", "DANGER"] as const;
const millisecondsPerSecond = 1000;
const durationPrecision = 3;
const minimumTextLength = 1;
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

type Allowances = z.infer<typeof allowanceSchema>;

export function parseSlowTestAllowances(value: unknown): Allowances {
	return allowanceSchema.parse(value);
}

/** Report passing tests above their allowed severity; failures stay in Bun's diagnostics. */
export function reportSlowTests(xml: string, allowances: Allowances): string[] {
	const root = Bun.XML.parse(xml, { compact: false });
	if (root.name !== "testsuites") {
		throw new Error("Expected Bun JUnit testsuites report");
	}
	return collectTestCases(root)
		.filter(
			(testCase) =>
				!elements(testCase).some((child) => ["failure", "error", "skipped"].includes(child.name)),
		)
		.map((testCase) => testAttributes.parse(testCase.attributes))
		.toSorted((left, right) => right.time - left.time)
		.flatMap((testCase) => {
			const durationMs = testCase.time * millisecondsPerSecond;
			const severity = severities.findLast((level) => durationMs > allowances.thresholdMs[level]);
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
				`${testCase.file}:${testCase.line} ${severity} ${durationMs.toFixed(durationPrecision)}ms ${description.replaceAll(/\s+/gu, " ")}`,
			];
		});
}

// --- Private functions ---

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
