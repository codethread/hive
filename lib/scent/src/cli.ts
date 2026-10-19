import { Command, CommanderError, Option } from "commander";
import {
	changelogHistorySchema,
	changelogQuerySchema,
	changelogSchema,
	queryChangelog,
	renderChangelog,
} from "@hive/shared/changelog";
import { ZodError } from "zod";
import changelog from "../changelog.json";
import { claudeIdentityHook } from "./claude.ts";
import { codexIdentityHook } from "./codex.ts";
import { version } from "../package.json";

const SUCCESS = 0;
const FAILURE = 1;

export interface Dependencies {
	/** Harness launcher inputs; identity hooks preserve unrelated values. */
	env: NodeJS.ProcessEnv;
	/** Append session exports to the harness-selected file. */
	appendEnvironment: (path: string, contents: string) => Promise<void>;
	/** Native hook payload. */
	stdin: () => Promise<string>;
	/** Standard result stream, including native hook JSON. */
	stdout: (text: string) => void;
	/** Diagnostics, silent in JSON mode. */
	stderr: (text: string) => void;
	/** Bundled native Pi extension, independent of the source checkout. */
	piExtension: string;
}

/** Installed identity runtime; Beeswax owns repository integration. */
// eslint-disable-next-line max-statements -- Keep native command composition and its single failure boundary together.
export async function runCli(argv: readonly string[], deps: Dependencies): Promise<number> {
	const program = new Command()
		.name("scent")
		.version(version)
		.description("Hive identity runtime for Beeswax-managed harness integrations")
		.option("--json", "Emit one JSON result with silent stderr")
		.configureOutput({ writeOut: deps.stdout, writeErr: () => {} })
		.exitOverride();
	const emit = (value: object) => deps.stdout(`${JSON.stringify(value)}\n`);
	registerChangelog(program, deps);
	const system = program
		.command("system")
		.description("Native harness protocols managed by Beeswax");
	system
		.command("hook")
		.description("Read a native hook from stdin and emit identity context")
		.addOption(
			new Option("--harness <name>", "Native hook harness")
				.choices(["claude", "codex"])
				.makeOptionMandatory(),
		)
		.action(async function hook(this: Command) {
			const input: unknown = JSON.parse(await deps.stdin());
			if (this.opts<{ harness: string }>().harness === "claude") {
				emit(await claudeIdentityHook(input, deps.env, deps.appendEnvironment));
			} else {
				emit(codexIdentityHook(input, deps.env));
			}
		});
	system
		.command("pi-extension")
		.description("Export bundled native Pi extension code for the generated loader")
		.action(() => emit({ ok: true, kind: "pi_extension", source: deps.piExtension }));
	try {
		await program.parseAsync([...argv], { from: "user" });
		return SUCCESS;
	} catch (error) {
		if (error instanceof CommanderError && error.exitCode === SUCCESS) {
			return SUCCESS;
		}
		let reason = "operation_failed";
		if (error instanceof CommanderError) {
			reason = "usage";
		} else if (error instanceof ZodError || error instanceof SyntaxError) {
			reason = "invalid_input";
		}
		let message = String(error);
		if (error instanceof Error) {
			({ message } = error);
		}
		if (argv.includes("--json")) {
			emit({ ok: false, kind: "error", reason, message });
		} else {
			deps.stderr(`${message}\n`);
		}
		return FAILURE;
	}
}

// --- Private functions ---

function registerChangelog(program: Command, deps: Pick<Dependencies, "stdout">): void {
	program
		.command("changelog")
		.description("Read embedded release history without a repository or tracker")
		.option("--since <version>", "Releases newer than this stable version (exclusive)")
		.option("--release <version>", "Read one exact release; cannot combine with --since")
		.option("--limit <count>", "Changes per page (1–100, default 20)")
		.option("--offset <count>", "Skip matching changes (default 0)")
		.option("--schema", "Print the successful JSON response schema")
		.action(function history(this: Command) {
			const options = this.optsWithGlobals();
			if (options["schema"] === true) {
				deps.stdout(
					`${JSON.stringify({ ok: true, kind: "changelog_schema", schema: changelogSchema() })}\n`,
				);
				return;
			}
			const page = queryChangelog(
				{ tool: "scent", version },
				changelogHistorySchema.parse(changelog),
				changelogQuerySchema.parse(options),
			);
			let output = renderChangelog(page);
			if (options["json"] === true) {
				output = `${JSON.stringify(page)}\n`;
			}
			deps.stdout(output);
		});
}
