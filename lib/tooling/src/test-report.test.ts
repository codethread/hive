import type { Allowances, TestTiming } from "./test-report.ts";
import { expect, test } from "bun:test";
import { reportSlowTests, reportTestRun, reportTestTimings } from "./test-report.ts";

const thresholdMs = { SLOW: 1, XSLOW: 5, DANGER: 1000 };
const successExitCode = 0;
const failureExitCode = 1;
const allowances = {
	thresholdMs,
	tests: {
		"#test-1": { threshold: "SLOW", justification: "Approved filesystem fixture" },
		"#test-2": { threshold: "XSLOW", justification: "Approved Git fixture" },
		"#test-3": { threshold: "DANGER", justification: "Approved process fixture" },
	},
} satisfies Allowances;

test.each([
	{ seconds: 0.001, severity: "" },
	{ seconds: 0.005, severity: "SLOW" },
	{ seconds: 0.005001, severity: "XSLOW" },
	{ seconds: 1, severity: "XSLOW" },
	{ seconds: 1.000001, severity: "DANGER" },
])("classifies strict timing boundary $seconds as $severity", ({ seconds, severity }) => {
	const { lines } = reportTestTimings(
		{ mode: "changed", exitCode: 0, testCases: [timing(seconds)] },
		allowances,
	);
	if (severity) {
		expect(lines).toEqual([expect.stringContaining(` ${severity} `)]);
	} else {
		expect(lines).toEqual([]);
	}
});

test.each([
	{ label: "adjacent marker allowed", seconds: 0.005, name: "prefix#test-1suffix", shown: false },
	{
		label: "adjacent marker exceeded",
		seconds: 0.005001,
		name: "prefix#test-1suffix",
		shown: true,
	},
	{
		label: "embedded marker allowed",
		seconds: 1,
		name: "moved test #test-2 still works",
		shown: false,
	},
	{
		label: "embedded marker exceeded",
		seconds: 1.000001,
		name: "moved test #test-2 still works",
		shown: true,
	},
	{ label: "leading marker allowed", seconds: 2, name: "#test-3 at the start", shown: false },
	{ label: "unknown marker", seconds: 0.002, name: "unknown #test-4", shown: true },
	{ label: "distinct longer numeric ID", seconds: 0.002, name: "distinct #test-10", shown: true },
])("applies description ID allowances: $label #test-603", ({ seconds, name, shown }) => {
	expect(
		reportTestTimings(
			{ mode: "changed", exitCode: 0, testCases: [timing(seconds, name)] },
			allowances,
		).lines.some(Boolean),
	).toBe(shown);
});

test("reports nested suites slowest first with decoded, single-line descriptions and source locations", () => {
	const xml = `<testsuites><testsuite name="file"><testsuite name="suite">
		<testcase name="less slow" classname="suite" file="a.test.ts" line="7" time="0.002" />
		<testcase name="parse &amp; escape&#10;input" classname="suite" file="b.test.ts" line="9" time="0.006" />
		<testcase name="inherited allowance" classname="suite #test-2" file="moved.test.ts" line="3" time="0.1" />
	</testsuite></testsuite><testsuite name="empty" /></testsuites>`;
	expect(reportSlowTests(xml, allowances)).toEqual([
		"b.test.ts:9 XSLOW 6.000ms suite > parse & escape input",
		"a.test.ts:7 SLOW 2.000ms suite > less slow",
	]);
});

test.each(["failure", "error", "skipped"])(
	"leaves %s cases to Bun rather than timing warnings",
	(status) => {
		expect(
			reportSlowTests(
				report("2", "unapproved slow case", `<${status}>details</${status}>`),
				allowances,
			),
		).toEqual([]);
	},
);

test("empty reports are silent", () => {
	expect(reportSlowTests("<testsuites />", allowances)).toEqual([]);
});

test.each([
	"<testsuites>",
	"<other />",
	'<testsuites><testsuite><testcase name="missing timing" /></testsuite></testsuites>',
	report("NaN"),
])("rejects unusable JUnit rather than silently hiding results: %s", (xml) => {
	expect(() => reportSlowTests(xml, allowances)).toThrow(Error);
});

test("uses registry cutoffs rather than hardcoded timing values", () => {
	const durationSeconds = 0.004001;
	const custom = {
		thresholdMs: { SLOW: 2, XSLOW: 3, DANGER: 4 },
		tests: {},
	} satisfies Allowances;
	expect(
		reportTestTimings(
			{ mode: "changed", exitCode: 0, testCases: [timing(durationSeconds)] },
			custom,
		).lines,
	).toEqual(["example.test.ts:12 DANGER 4.001ms example"]);
});

test.each([
	{
		label: "unapproved timing fails",
		mode: "all",
		seconds: 2,
		name: "unapproved",
		nativeExit: 0,
		exitCode: 1,
		blocked: true,
	},
	{
		label: "unapproved timing fails",
		mode: "changed",
		seconds: 2,
		name: "unapproved",
		nativeExit: 0,
		exitCode: 1,
		blocked: true,
	},
	{
		label: "approved timing passes",
		mode: "all",
		seconds: 2,
		name: "approved #test-3",
		nativeExit: 0,
		exitCode: 0,
		blocked: false,
	},
	{
		label: "exceeded allowance fails",
		mode: "all",
		seconds: 2,
		name: "exceeds #test-2",
		nativeExit: 0,
		exitCode: 1,
		blocked: true,
	},
	{
		label: "severity text alone does not fail",
		mode: "all",
		seconds: 0.001,
		name: "DANGER in title",
		nativeExit: 0,
		exitCode: 0,
		blocked: false,
	},
	{
		label: "native failure status is retained",
		mode: "all",
		seconds: 2,
		name: "unapproved",
		nativeExit: 7,
		exitCode: 7,
		blocked: true,
	},
] as const)("$mode gate: $label", (row) => {
	const feedback = reportTestTimings(
		{ mode: row.mode, testCases: [timing(row.seconds, row.name)], exitCode: row.nativeExit },
		allowances,
	);
	expect(feedback.exitCode).toBe(row.exitCode);
	expect(Boolean(feedback.guidance)).toBe(row.blocked);
});

test.each([
	{ mode: "changed", seconds: "0.001", name: "unapproved", severity: "" },
	{ mode: "changed", seconds: "0.001001", name: "unapproved", severity: "SLOW" },
	{ mode: "all", seconds: "0.00125", name: "unapproved", severity: "" },
	{ mode: "all", seconds: "0.001251", name: "unapproved", severity: "SLOW" },
] as const)("$mode timing boundary $seconds for $name", ({ mode, seconds, name, severity }) => {
	const feedback = reportTestRun(
		{ mode, xml: report(seconds, name), exitCode: 0, output: "" },
		allowances,
	);
	if (severity) {
		expect(feedback.exitCode).toBe(failureExitCode);
		expect(feedback.lines).toEqual([expect.stringContaining(` ${severity} `)]);
	} else {
		expect(feedback.exitCode).toBe(successExitCode);
		expect(feedback.lines).toEqual([]);
	}
	expect(Boolean(feedback.guidance)).toBe(Boolean(severity));
});

test.each([
	{ mode: "changed", seconds: 0.005, name: "allowed #test-1", severity: "" },
	{ mode: "changed", seconds: 0.005001, name: "allowed #test-1", severity: "XSLOW" },
	{ mode: "all", seconds: 0.00625, name: "allowed #test-1", severity: "" },
	{ mode: "all", seconds: 0.006251, name: "allowed #test-1", severity: "XSLOW" },
	{ mode: "changed", seconds: 1, name: "allowed #test-2", severity: "" },
	{ mode: "changed", seconds: 1.000001, name: "allowed #test-2", severity: "DANGER" },
	{ mode: "all", seconds: 1.25, name: "allowed #test-2", severity: "" },
	{ mode: "all", seconds: 1.250001, name: "allowed #test-2", severity: "DANGER" },
] as const)(
	"$mode allowed timing boundary $seconds as $severity",
	({ mode, seconds, name, severity }) => {
		const feedback = reportTestTimings(
			{ mode, testCases: [timing(seconds, name)], exitCode: 0 },
			allowances,
		);
		if (severity) {
			expect(feedback.exitCode).toBe(failureExitCode);
			expect(feedback.lines).toEqual([expect.stringContaining(` ${severity} `)]);
		} else {
			expect(feedback.exitCode).toBe(successExitCode);
			expect(feedback.lines).toEqual([]);
		}
		expect(Boolean(feedback.guidance)).toBe(Boolean(severity));
	},
);

test("full-suite feedback retains every timing before actionable remediation guidance", () => {
	const xml = `<testsuites><testsuite>
		<testcase name="slow" classname="" file="a.test.ts" line="1" time="0.002" />
		<testcase name="danger" classname="" file="b.test.ts" line="2" time="2" />
		<testcase name="xslow" classname="" file="c.test.ts" line="3" time="0.1" />
	</testsuite></testsuites>`;
	const feedback = reportTestRun({ mode: "all", xml, exitCode: 0, output: "" }, allowances);
	expect(feedback.lines).toEqual([
		"b.test.ts:2 DANGER 2000.000ms danger",
		"c.test.ts:3 XSLOW 100.000ms xslow",
		"a.test.ts:1 SLOW 2.000ms slow",
	]);
	expect(feedback.guidance).toContain("Refactor meaningful tests");
	expect(feedback.guidance).toContain("delete those tests");
});

test.each([
	{ mode: "changed", exitCode: 0, output: "Ran 0 tests across 0 files." },
	{ mode: "all", exitCode: 7, output: "native module failure" },
] as const)("$mode missing report preserves native exit $exitCode", (run) => {
	expect(reportTestRun({ ...run, xml: undefined }, allowances)).toEqual({
		lines: [],
		exitCode: run.exitCode,
		guidance: undefined,
	});
});

test.each([
	{
		label: "a missing report despite an empty selection",
		mode: "all",
		xml: undefined,
		output: "Ran 0 tests across 0 files.",
	},
	{
		label: "a missing report for a nonempty selection",
		mode: "changed",
		xml: undefined,
		output: "Ran 1 test across 1 file.",
	},
	{ label: "a malformed report", mode: "all", xml: "<testsuites>", output: "" },
] as const)("$mode rejects successful runs with $label", (run) => {
	expect(() => reportTestRun({ ...run, exitCode: 0 }, allowances)).toThrow(Error);
});

// --- Private functions ---

function timing(time: number, name = "example"): TestTiming {
	return { time, name, classname: "", file: "example.test.ts", line: "12" };
}

function report(seconds: string, name = "example", content = ""): string {
	return (
		`<testsuites><testsuite><testcase name="${name}` +
		`" classname="" file="example.test.ts" line="12" time="${seconds}">` +
		`${content}</testcase></testsuite></testsuites>`
	);
}
