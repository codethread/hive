// eslint-disable-next-line import/no-nodejs-modules -- Own a private, short-lived JUnit report directory.
import { mkdtemp, rm } from "node:fs/promises";
import { parseSlowTestAllowances, reportSlowTests } from "./test-report.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve report paths at the CLI boundary.
import { join } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Locate the system temporary directory.
import { tmpdir } from "node:os";

const successExitCode = 0;
const failureExitCode = 1;
const argumentOffset = 2;

// eslint-disable-next-line max-statements -- Keep child execution, diagnostic replay and report cleanup in one IO boundary.
async function main(args: string[]): Promise<number> {
	const allowances = parseSlowTestAllowances(
		await Bun.file(new URL("../slow-tests.json", import.meta.url)).json(),
	);
	const directory = await mkdtemp(join(tmpdir(), "hive-test-changed-"));
	const report = Bun.file(join(directory, "junit.xml"));
	try {
		// Reuse the repository test script's parallelism and timeout instead of maintaining a second set.
		const child = Bun.spawn(
			[
				process.execPath,
				"run",
				"--silent",
				"test",
				"--changed",
				...args,
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
		if (exitCode !== successExitCode) {
			// JUnit omits some module/hook errors and test output. Keep native failure evidence intact.
			console.error(
				[stdout.trim(), stderr.trim()].filter(Boolean).join("\n") || `ERROR Bun exited ${exitCode}`,
			);
		}
		if (await report.exists()) {
			for (const line of reportSlowTests(await report.text(), allowances)) {
				console.log(line);
			}
		} else if (
			exitCode === successExitCode &&
			!/Ran 0 tests across 0 files\./u.test(stdout + stderr)
		) {
			throw new Error("Bun succeeded without a JUnit report or an empty changed-test run");
		}
		return exitCode;
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

if (import.meta.main) {
	try {
		process.exitCode = await main(process.argv.slice(argumentOffset));
	} catch (error) {
		console.error(`ERROR test:changed: ${String(error)}`);
		process.exitCode = failureExitCode;
	}
}
