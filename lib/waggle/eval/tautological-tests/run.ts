import { Command, CommanderError } from "commander";
import type { EvaluationRow, PreparedFixture } from "../suite.ts";
import { evaluateFixture, prepareFixtures } from "../suite.ts";
import type { Classifier } from "../../src/classifiers.ts";
import { createLiveDependencies } from "../../src/live-deps.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Decode the module-relative filesystem path.
import { fileURLToPath } from "node:url";
// eslint-disable-next-line import/no-nodejs-modules -- Evaluation fixtures are explicit local inputs.
import { readdir } from "node:fs/promises";

const SUCCESS = 0;
const FAILURE = 1;
const USAGE = 2;
const INDENT = 2;
const CLASSIFIER = "tautological-tests";
const QUESTION = "review";
const SCORE_LABEL = "tautological";
const DIRECTORY = new URL("fixtures/", import.meta.url);

interface Options {
	/** Explicit opt-in to provider requests; absence validates the suite offline. */
	live: boolean;
	/** Optional exact fixture ID to evaluate instead of the entire suite. */
	fixture?: string;
}

// eslint-disable-next-line max-statements -- Keep failure phases visible at the process boundary.
async function main(): Promise<number> {
	const results: EvaluationRow[] = [];
	let reason = "usage";
	try {
		const options = parseOptions();
		reason = "invalid_input";
		const { classifier, fixtures } = await loadSuite(options);
		if (!options.live) {
			print({
				ok: true,
				kind: "evaluation_validation",
				classifier: CLASSIFIER,
				fixtures: fixtures.map(({ fixture }) => fixture.id),
			});
			return SUCCESS;
		}
		reason = "execution_failed";
		return await runSuite(classifier, fixtures, results);
	} catch (error) {
		return reportError(error, results, reason);
	}
}

async function loadSuite(options: Options) {
	const deps = createLiveDependencies();
	const classifier = await deps.load(
		fileURLToPath(new URL("../../../../classifiers/", import.meta.url)),
		CLASSIFIER,
	);
	const entries = await readdir(DIRECTORY);
	const files = entries.filter((file) => file.endsWith(".json")).toSorted();
	const values: unknown[] = await Promise.all(
		files.map((file) => Bun.file(new URL(file, DIRECTORY)).json()),
	);
	const all = prepareFixtures(classifier, { question: QUESTION, scoreLabel: SCORE_LABEL }, values);
	const fixtures = all.filter(({ fixture }) => !options.fixture || fixture.id === options.fixture);
	if (fixtures.length === SUCCESS) {
		throw new Error("No matching evaluation fixtures");
	}
	return { classifier, fixtures };
}

// eslint-disable-next-line max-statements -- Keep completed evaluation reporting together with its exit status.
async function runSuite(
	classifier: Classifier,
	fixtures: PreparedFixture[],
	results: EvaluationRow[],
): Promise<number> {
	const deps = createLiveDependencies();
	for (const prepared of fixtures) {
		// eslint-disable-next-line no-await-in-loop -- One provider request at a time; retain completed rows on failure.
		results.push(await evaluateFixture(prepared, deps.classify));
	}
	const passed = results.every((row) => row.passed);
	const evidence = JSON.stringify(fixtures.map(({ fixture }) => fixture));
	const report = {
		ok: passed,
		kind: "classification_evaluation",
		classifier: { id: CLASSIFIER, version: classifier.definition.version },
		created_at: new Date().toISOString(),
		definition_hash: new Bun.CryptoHasher("sha256")
			.update(JSON.stringify(classifier.definition))
			.digest("hex"),
		completed: results.length,
		total: fixtures.length,
		failed: results.filter((row) => !row.passed).length,
		fixture_hash: new Bun.CryptoHasher("sha256").update(evidence).digest("hex"),
		results,
	};
	if (!passed) {
		print({
			...report,
			reason: "expectation_mismatch",
			message: `${report.failed} of ${report.total} fixtures did not meet their expected choice or probability ranges.`,
		});
		return FAILURE;
	}
	print(report);
	return SUCCESS;
}

function reportError(error: unknown, results: EvaluationRow[], reason: string): number {
	if (error instanceof CommanderError && error.exitCode === SUCCESS) {
		return SUCCESS;
	}
	print({
		ok: false,
		kind: "error",
		reason,
		completed: results.length,
		message: String(error),
		results,
	});
	if (error instanceof CommanderError) {
		return USAGE;
	}
	return FAILURE;
}

function parseOptions(): Options {
	return new Command()
		.name("evaluate-tautological-tests")
		.description("Validate fixtures offline, or explicitly classify their evidence with Typesafe.")
		.option("--live", "Send selected fixture inputs to Typesafe; check choice and ranges", false)
		.option("--fixture <id>", "Select one exact fixture ID")
		.configureOutput({ writeErr: () => {}, writeOut: (value) => process.stdout.write(value) })
		.exitOverride()
		.parse(process.argv)
		.opts<Options>();
}

function print(value: unknown): void {
	process.stdout.write(`${JSON.stringify(value, undefined, INDENT)}\n`);
}

process.exitCode = await main();
