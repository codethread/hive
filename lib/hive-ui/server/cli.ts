import {
	changelogHistorySchema,
	changelogQuerySchema,
	changelogSchema,
	queryChangelog,
	renderChangelog,
} from "@hive/shared/changelog";
import { Command } from "commander";
import changelog from "../changelog.json";
import { version } from "../package.json";
import { z } from "zod";

const MAX_PORT = 65_535;
const optionsSchema = z.object({
	beadsDb: z.string().optional(),
	colonies: z.string().optional(),
	daemon: z.boolean().default(false),
	host: z.enum(["127.0.0.1", "0.0.0.0"]).default("127.0.0.1"),
	json: z.boolean().default(false),
	logFile: z.string().optional(),
	port: z.coerce.number().int().min(0).max(MAX_PORT),
	repo: z.string(),
	socket: z.string().optional(),
	state: z.string().optional(),
});

export type UiOptions = z.infer<typeof optionsSchema>;

interface CommandDependencies {
	/** BEADS_DB default for the single native database endpoint. */
	beadsDb: string | undefined;
	/** Start the foreground server with parsed root-command options. */
	start: (options: UiOptions) => Promise<void>;
	/** Write command output to stdout. */
	write: (output: string) => void;
}

export function createUiCommand(deps: CommandDependencies): Command {
	const program = new Command()
		.name("hive-ui")
		.version(version)
		.description("Serve the local read-only Beads and Bees work board")
		.option("--repo <directory>", "Repository discovery directory", ".")
		.option("--beads-db <path>", "Selected native Beads database", deps.beadsDb)
		.option(
			"--colonies <file>",
			"JSON array of {name, root, beadsDb}; replaces the single endpoint",
		)
		.option("--daemon", "Discover registered endpoints from the selected Colony daemon at startup")
		.option("--state <directory>", "Colony daemon state directory (requires --daemon)")
		.option("--socket <path>", "Colony daemon socket (requires --daemon and --state)")
		.option("--host <address>", "Bind address: 127.0.0.1 or 0.0.0.0 for LAN access", "127.0.0.1")
		.option("--port <number>", "HTTP port (0 chooses a free port)", "4318")
		.option("--json", "Emit one JSON startup result (requires --log-file)")
		.option("--log-file <path>", "Write server/native diagnostics to this file instead of stderr")
		.addHelpText(
			"after",
			"\nRun hive-ui, or use bun run start from lib/hive-ui during " +
				"development. --daemon reads registered endpoints from public Colony status; " +
				"it replaces the single endpoint and cannot be combined with --colonies. " +
				"Unavailable or empty daemon membership fails startup. No daemon is started. " +
				"Restart the UI to refresh membership. Each browser view selects one endpoint.",
		)
		.configureOutput({ writeOut: deps.write, writeErr: () => {} })
		.exitOverride()
		.action(function startServerCommand(this: Command) {
			return deps.start(optionsSchema.parse(this.opts()));
		});

	program
		.command("changelog")
		.description(
			"Read embedded history offline; " +
				"defaults to the latest recorded release at or below this executable version",
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
				deps.write(
					`${JSON.stringify({ ok: true, kind: "changelog_schema", schema: changelogSchema() })}\n`,
				);
				return;
			}
			const page = queryChangelog(
				{ tool: "hive-ui", version },
				changelogHistorySchema.parse(changelog),
				changelogQuerySchema.parse(options),
			);
			let output = renderChangelog(page);
			if (options["json"] === true) {
				output = `${JSON.stringify(page)}\n`;
			}
			deps.write(output);
		});
	return program;
}
