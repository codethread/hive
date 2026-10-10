import { expect, test } from "bun:test";
import { parseSlowTestAllowances, reportSlowTests, reportTestRun } from "./test-report.ts";

const thresholdMs = { SLOW: "1", XSLOW: "5", DANGER: "1000" };
const allowances = parseSlowTestAllowances({
	thresholdMs,
	tests: {
		"#test-1": { threshold: "SLOW", justification: "Approved filesystem fixture" },
		"#test-2": { threshold: "XSLOW", justification: "Approved Git fixture" },
		"#test-3": { threshold: "DANGER", justification: "Approved process fixture" },
	},
});

// Warm the XML/schema path outside the unit-test timing, as in shared's schema tests.
reportSlowTests(report("0"), allowances);

test.each([
	{ seconds: "0.001", severity: "" },
	{ seconds: "0.001001", severity: "SLOW" },
	{ seconds: "0.005", severity: "SLOW" },
	{ seconds: "0.005001", severity: "XSLOW" },
	{ seconds: "1", severity: "XSLOW" },
	{ seconds: "1.000001", severity: "DANGER" },
])("classifies strict timing boundary $seconds as $severity", ({ seconds, severity }) => {
	const lines = reportSlowTests(report(seconds), allowances);
	if (severity) {
		expect(lines).toEqual([expect.stringContaining(` ${severity} `)]);
	} else {
		expect(lines).toEqual([]);
	}
});

test.each([
	{ seconds: "0.005", name: "prefix#test-1suffix", shown: false },
	{ seconds: "0.005001", name: "prefix#test-1suffix", shown: true },
	{ seconds: "1", name: "moved test #test-2 still works", shown: false },
	{ seconds: "1.000001", name: "moved test #test-2 still works", shown: true },
	{ seconds: "2", name: "#test-3 at the start", shown: false },
	{ seconds: "0.002", name: "unknown #test-4", shown: true },
	{ seconds: "0.002", name: "distinct #test-10", shown: true },
])("applies description ID allowances at $seconds", ({ seconds, name, shown }) => {
	expect(reportSlowTests(report(seconds, name), allowances).some(Boolean)).toBe(shown);
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

test("empty reports and allowed passing tests are silent", () => {
	expect(reportSlowTests("<testsuites />", allowances)).toEqual([]);
	expect(reportSlowTests(report("0.003", "#test-1"), allowances)).toEqual([]);
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
	const custom = parseSlowTestAllowances({
		thresholdMs: { SLOW: "2", XSLOW: "3", DANGER: "4" },
		tests: {},
	});
	expect(reportSlowTests(report("0.004001"), custom)).toEqual([
		"example.test.ts:12 DANGER 4.001ms example",
	]);
});

test.each([
	{
		name: "decreasing thresholds",
		input: { thresholdMs: { ...thresholdMs, XSLOW: "0.5" }, tests: {} },
	},
	{
		name: "empty justification",
		input: { thresholdMs, tests: { "#test-1": { threshold: "SLOW", justification: " " } } },
	},
])("rejects invalid allowance configuration: $name", ({ input }) => {
	expect(() => parseSlowTestAllowances(input)).toThrow(Error);
});

test.each([
	{ mode: "all", seconds: "2", name: "unapproved", nativeExit: 0, exitCode: 1, blocked: true },
	{ mode: "changed", seconds: "2", name: "unapproved", nativeExit: 0, exitCode: 0, blocked: false },
	{
		mode: "all",
		seconds: "2",
		name: "approved #test-3",
		nativeExit: 0,
		exitCode: 0,
		blocked: false,
	},
	{ mode: "all", seconds: "2", name: "exceeds #test-2", nativeExit: 0, exitCode: 1, blocked: true },
	{
		mode: "all",
		seconds: "1",
		name: "DANGER in title",
		nativeExit: 0,
		exitCode: 0,
		blocked: false,
	},
	{ mode: "all", seconds: "2", name: "unapproved", nativeExit: 7, exitCode: 7, blocked: true },
] as const)("$mode gate for $name at $seconds preserves exit $exitCode", (row) => {
	const xml = report(row.seconds, row.name);
	const feedback = reportTestRun(
		{ mode: row.mode, xml, exitCode: row.nativeExit, output: "" },
		allowances,
	);
	expect(feedback.lines).toEqual(reportSlowTests(xml, allowances));
	expect(feedback.exitCode).toBe(row.exitCode);
	expect(Boolean(feedback.guidance)).toBe(row.blocked);
});

test("full-suite feedback retains every timing before actionable DANGER guidance", () => {
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
	expect(feedback.guidance).toContain("explicit user sign-off before editing");
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
	{ mode: "all", xml: undefined, output: "Ran 0 tests across 0 files." },
	{ mode: "changed", xml: undefined, output: "Ran 1 test across 1 file." },
	{ mode: "all", xml: "<testsuites>", output: "" },
] as const)("$mode rejects missing or malformed successful reports", (run) => {
	expect(() => reportTestRun({ ...run, exitCode: 0 }, allowances)).toThrow(Error);
});

// --- Private functions ---

function report(seconds: string, name = "example", content = ""): string {
	return `<testsuites><testsuite><testcase name="${name}" classname="" file="example.test.ts" line="12" time="${seconds}">${content}</testcase></testsuite></testsuites>`;
}
