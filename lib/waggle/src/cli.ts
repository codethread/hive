import type { ClassificationRequest, Classifier } from "./classifiers.ts";
import { Command, CommanderError } from "commander";
import {
	changelogHistorySchema,
	changelogQuerySchema,
	changelogSchema,
	queryChangelog,
	renderChangelog,
} from "@hive/shared/changelog";
import { parseClassification, prepareRequest } from "./classifiers.ts";
import changelog from "../changelog.json";
import { version } from "../package.json";

const JSON_INDENT = 2;
const SUCCESS = 0;
const FAILURE = 1;
const USAGE_ERROR = 2;

export interface WaggleDependencies {
	/** Load every definition from the selected directory, ordered by ID. */
	list: (directory: string) => Promise<Classifier[]>;
	/** Load one definition; IDs must not escape the selected directory. */
	load: (directory: string, id: string) => Promise<Classifier>;
	/** Read a JSON input file, or standard input when the path is '-'. */
	readInput: (path: string) => Promise<string>;
	/** Execute one request; the provider response is validated before output. */
	classify: (request: ClassificationRequest) => Promise<unknown>;
	/** Write successful JSON output or help text. */
	stdout: (text: string) => void;
	/** Write human-mode execution diagnostics. */
	stderr: (text: string) => void;
}

interface DirectoryOptions {
	/** Directory containing this checkout's classifier TOMLs. */
	classifiers: string;
}

interface RunOptions extends DirectoryOptions {
	/** JSON input file path or '-' for standard input. */
	input: string;
}

interface CommandFailure {
	/** Stable execution-versus-usage discriminator. */
	reason: "usage" | "execution_failed";
	/** Human-readable diagnostic. */
	message: string;
}

/** Process user arguments without owning process exit or constructing live services. */
export async function runCli(argv: string[], deps: WaggleDependencies): Promise<number> {
	try {
		await createProgram(deps).parseAsync(argv, { from: "user" });
		return SUCCESS;
	} catch (error) {
		return reportFailure(error, argv.includes("--json"), deps);
	}
}

// --- Private functions ---

function createProgram(deps: WaggleDependencies): Command {
	const program = new Command()
		.name("waggle")
		.description("Run repo-owned JEV classifiers as review signals, not approval gates.")
		.option(
			"--classifiers <directory>",
			"Classifier directory, relative to the current directory",
			"classifiers",
		)
		.option("--json", "Keep failures on stdout as JSON too; stderr stays silent")
		.configureOutput({ writeErr: () => {}, writeOut: deps.stdout })
		.exitOverride();

	program
		.command("changelog")
		.description(
			"Read embedded history offline; defaults to the latest recorded release at or below this executable version",
		)
		.summary("Read offline release history")
		.option("--since <version>", "Releases newer than this stable version (exclusive)")
		.option("--release <version>", "Read one exact recorded release; cannot combine with --since")
		.option("--limit <count>", "Changes per page (1–100, default 20)")
		.option("--offset <count>", "Skip matching changes (default 0)")
		.option("--schema", "Print the successful JSON response schema")
		.option("--json", "Emit one JSON document with silent stderr")
		.action(function changelogCommand(this: Command) {
			const options = this.optsWithGlobals();
			if (options["schema"] === true) {
				deps.stdout(
					`${JSON.stringify({ ok: true, kind: "changelog_schema", schema: changelogSchema() })}\n`,
				);
				return;
			}
			const page = queryChangelog(
				{ tool: "waggle", version },
				changelogHistorySchema.parse(changelog),
				changelogQuerySchema.parse(options),
			);
			let output = renderChangelog(page);
			if (options["json"] === true) {
				output = `${JSON.stringify(page)}\n`;
			}
			deps.stdout(output);
		});

	program
		.command("list")
		.description("List classifier IDs, versions and when-to-use descriptions as JSON")
		.action(async (_options, command: Command) => {
			const { classifiers } = command.optsWithGlobals<DirectoryOptions>();
			const catalogue = await deps.list(classifiers);
			writeJson(deps, {
				classifiers: catalogue.map(({ id, definition }) => ({
					description: definition.description,
					id,
					version: definition.version,
				})),
				kind: "classifier_list",
				ok: true,
			});
		});
	program
		.command("describe <id>")
		.description("Describe when to use a classifier, its required inputs and its questions")
		.action(async (id: string, _options, command: Command) => {
			const { classifiers } = command.optsWithGlobals<DirectoryOptions>();
			const classifier = await deps.load(classifiers, id);
			writeJson(deps, { id, kind: "classifier", ok: true, ...classifier.definition });
		});
	program
		.command("run <id>")
		.description("Send the supplied JSON evidence to Typesafe and return structured answers")
		.requiredOption("--input <path>", "JSON input file, or '-' to read standard input")
		.action(async (id: string, _options, command: Command) => {
			const options = command.optsWithGlobals<RunOptions>();
			const classifier = await deps.load(options.classifiers, id);
			const request = prepareRequest(classifier, await deps.readInput(options.input));
			const result = parseClassification(request, await deps.classify(request));
			writeJson(deps, {
				classifier: { id, version: classifier.definition.version },
				kind: "classification",
				ok: true,
				request_hash: new Bun.CryptoHasher("sha256").update(JSON.stringify(request)).digest("hex"),
				...result,
			});
		});
	return program;
}

function reportFailure(error: unknown, json: boolean, deps: WaggleDependencies): number {
	if (error instanceof CommanderError) {
		if (error.exitCode === SUCCESS) {
			return SUCCESS;
		}
		writeFailure(deps, json, { message: error.message, reason: "usage" });
		return USAGE_ERROR;
	}
	if (error instanceof Error) {
		writeFailure(deps, json, { message: error.message, reason: "execution_failed" });
	} else {
		writeFailure(deps, json, { message: String(error), reason: "execution_failed" });
	}
	return FAILURE;
}

function writeFailure(deps: WaggleDependencies, json: boolean, failure: CommandFailure): void {
	if (json) {
		writeJson(deps, { kind: "error", ok: false, ...failure });
	} else {
		deps.stderr(`waggle: ${failure.message}\n`);
	}
}

function writeJson(deps: WaggleDependencies, value: unknown): void {
	deps.stdout(`${JSON.stringify(value, undefined, JSON_INDENT)}\n`);
}
