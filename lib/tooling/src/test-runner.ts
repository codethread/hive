// eslint-disable-next-line import/no-nodejs-modules -- Own a private, short-lived JUnit report directory.
import { mkdtemp, rm } from "node:fs/promises";
import { parseSlowTestAllowances, reportTestRun } from "./test-report.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve report paths at the CLI boundary.
import { join } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Locate the system temporary directory.
import { tmpdir } from "node:os";
import { z } from "zod";

const successExitCode = 0;
const failureExitCode = 1;
const argumentOffset = 2;
const modeSchema = z.enum(["all", "changed"]);

// eslint-disable-next-line max-statements -- Keep child execution, diagnostic replay and report cleanup in one IO boundary.
async function main(args: string[]): Promise<number> {
	const [modeArg, ...testArgs] = args;
	const mode = modeSchema.parse(modeArg);
	const selectionArgs: string[] = [];
	if (mode === "changed") {
		selectionArgs.push("--changed=main");
	}
	const allowances = parseSlowTestAllowances(
		await Bun.file(new URL("../slow-tests.json", import.meta.url)).json(),
	);
	const directory = await mkdtemp(join(tmpdir(), "hive-test-report-"));
	const report = Bun.file(join(directory, "junit.xml"));
	try {
		// Both scripts share Bun's existing parallelism and timeout policy here.
		const child = Bun.spawn(
			[
				process.execPath,
				"test",
				"--parallel=2",
				"--parallel-delay=0",
				"--timeout=5000",
				"--only-failures",
				...selectionArgs,
				...testArgs,
				"--reporter=junit",
				`--reporter-outfile=${report.name}`,
			],
			{ stdout: "pipe", stderr: "pipe", env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" } },
		);
		const [exitCode, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		if (mode === "all" || exitCode !== successExitCode) {
			// JUnit omits some module/hook errors and test output. Keep native failure evidence intact.
			console.error(
				[stdout.trim(), stderr.trim()].filter(Boolean).join("\n") || `ERROR Bun exited ${exitCode}`,
			);
		}
		let xml: string | undefined = undefined;
		if (await report.exists()) {
			xml = await report.text();
		}
		const feedback = reportTestRun(
			{
				mode,
				exitCode,
				xml,
				output: stdout + stderr,
			},
			allowances,
		);
		for (const line of feedback.lines) {
			console.log(line);
		}
		if (feedback.guidance) {
			console.error(feedback.guidance);
		}
		return feedback.exitCode;
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

if (import.meta.main) {
	try {
		process.exitCode = await main(process.argv.slice(argumentOffset));
	} catch (error) {
		console.error(`ERROR test:${process.argv[argumentOffset]}: ${String(error)}`);
		process.exitCode = failureExitCode;
	}
}
