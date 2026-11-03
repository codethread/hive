/* eslint-disable import/max-dependencies --
 * The CLI composes workflow operations and bundled guidance at the command boundary.
 */
import { BusyBeeError, installDefaultWorkflow } from "./native.ts";
import { Command, CommanderError } from "commander";
import type { Options, Services } from "./native.ts";
import { advance, complete, recordResult, runViewSchema, start, startNamed } from "./runtime.ts";
import {
	changelogHistorySchema,
	changelogQuerySchema,
	changelogSchema,
	queryChangelog,
	renderChangelog,
} from "@hive/shared/changelog";
import { importDefinition, validate } from "./definition.ts";
import { listWorkflows, namedDefinition } from "./catalogue.ts";
import { settle, settlementRequestSchema, settlementResultSchema } from "./settlement.ts";
import {
	workflowAdvanceSchema,
	workflowCheckpointSchema,
	workflowRunInspectionSchema,
	workflowSimulationRequestSchema,
	workflowSimulationSchema,
} from "@hive/shared";
import type { PreflightReport } from "./preflight.ts";
import type { RunView } from "./runtime.ts";
import type { Source } from "./catalogue.ts";
import changelog from "../changelog.json";
import { checkpointVersion } from "./preview.ts";
import { inspect } from "./inspection.ts";
import { preflight } from "./preflight.ts";
import { readSkills } from "./skills.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Explicit source paths resolve against the invoking directory.
import { resolve } from "node:path";
import { simulate } from "./simulation.ts";
import { version as suiteVersion } from "../package.json";
import { z } from "zod";

const SUCCESS = 0;
const FAILURE = 1;
const INDENT = 2;
export const runSummarySchema = runViewSchema.extend({
	active: z.array(runViewSchema.shape.active.element.omit({ context: true, instructions: true })),
});
const constraintKeys = new Set([
	"const",
	"enum",
	"minimum",
	"maximum",
	"exclusiveMinimum",
	"exclusiveMaximum",
	"multipleOf",
	"minLength",
	"maxLength",
	"pattern",
	"format",
	"default",
	"minItems",
	"maxItems",
	"uniqueItems",
	"minProperties",
	"maxProperties",
]);
interface CliOptions extends Options {
	/** Inline task payload, mutually exclusive with a file. */
	data?: string;
	/** Path to a task payload. */
	dataFile?: string;
	/** Machine-readable terminal mode. */
	json?: boolean;
}
export interface Terminal {
	/** Successful output and all machine-mode documents. */
	stdout: (value: string) => void;
	/** Human-mode failure output. */
	stderr: (value: string) => void;
}
interface Invocation {
	/** Completed reports can contain incompatibilities without throwing away findings. */
	exitCode: number;
	/** Commander owns parsed global options and arguments. */
	cli: Command;
	/** Captured help output emitted once after parsing stops. */
	help: string;
	/** Machine-readable output selected before parsing can fail. */
	json: boolean;
	/** Command identity attached to terminal envelopes. */
	kind: string;
	/** Native dependencies shared by command handlers. */
	services: Services;
	/** Command target when one was supplied. */
	target: string | undefined;
	/** Output destination supplied by the executable. */
	terminal: Terminal;
}
type JsonSchema = z.core.JSONSchema.JSONSchema;
interface Discovery {
	/** General workflow constraints. */
	constraints?: string;
	/** Initial schema, when inspecting an entry. */
	schema?: JsonSchema;
	/** Active choices, when inspecting a run. */
	active?: {
		bead: string;
		title: string;
		constraints?: unknown;
		choices: { choice: string; schema: JsonSchema }[];
	}[];
}

// eslint-disable-next-line max-statements -- Configure the public command surface before parsing.
export async function runCli(
	argv: string[],
	services: Services,
	terminal: Terminal,
): Promise<number> {
	const invocation: Invocation = {
		cli: commandOptions(),
		exitCode: SUCCESS,
		help: "",
		json: argv.includes("--json"),
		kind: "cli",
		services,
		target: undefined,
		terminal,
	};
	configure(invocation);
	invocation.cli
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
				terminal.stdout(
					`${JSON.stringify({ ok: true, kind: "changelog_schema", schema: changelogSchema() })}\n`,
				);
				return;
			}
			const page = queryChangelog(
				{ tool: "busybee", version: suiteVersion },
				changelogHistorySchema.parse(changelog),
				changelogQuerySchema.parse(options),
			);
			let output = renderChangelog(page);
			if (options["json"] === true) {
				output = `${JSON.stringify(page)}\n`;
			}
			terminal.stdout(output);
		});

	registerCreation(invocation);
	registerInspection(invocation);
	registerPreflight(invocation);
	registerNavigation(invocation);
	try {
		await invocation.cli.parseAsync(argv, { from: "user" });
		return invocation.exitCode;
	} catch (error) {
		return reportFailure(error, invocation);
	}
}

// --- Private functions ---

function commandOptions(): Command {
	return new Command()
		.name("busybee")
		.description("Run workflows as Beads tasks and inspect their saved state")
		.version(suiteVersion)
		.option("--db <path>", "Override native br database selection (otherwise BEADS_DB/discovery)")
		.option("--repo <path>", "Repository/execution directory; defaults to current directory")
		.option("--actor <identity>", "Mutation audit actor; defaults to BD_ACTOR")
		.option("--owner <human>", "Accountable human; required when starting")
		.option("--parent <id>", "Existing nonclosed non-system work bead; required by run/start")
		.option(
			"-a, --assignee <agent>",
			"Initial assignee for the run and driver-handled tasks; defaults to starting actor",
		)
		.option("--json", "One machine-readable success or failure document")
		.option("--input-file <path>", "Initial actor input as JSON; defaults to an empty object")
		.option("--data <json>", "Event payload; defaults to an empty object")
		.option("--data-file <path>", "Event payload as a JSON file")
		.addHelpText(
			"after",
			"\nWork: inspect RUN --work --json, perform the active task, " +
				"complete RUN TASK CHOICE, then the driver runs advance RUN. " +
				"Busy Bee closes groups and the run.\n" +
				"Read native lifecycle with inspect RUN; add --diagram for saved structure. " +
				"Use busybee COMMAND --help for each command's purpose and prerequisites.",
		);
}

function configure(invocation: Invocation): void {
	invocation.cli
		.exitOverride()
		.configureOutput({
			writeErr: () => {},
			writeOut: (text: string) => {
				invocation.help += text;
			},
		})
		.hook("preAction", (_parent, command) => {
			invocation.kind = command.name();
			[invocation.target] = command.args;
		});
}

function registerCreation(invocation: Invocation): void {
	const { cli, services } = invocation;
	const options = (): CliOptions => cli.opts<CliOptions>();
	cli
		.command("init")
		.description("Install bundled do-work and report dependency readiness")
		.addHelpText(
			"after",
			"\nCreates .workflows/do-work; fails if that folder exists. Creates " +
				".workflows/package.json only when absent, preserving an existing manifest.\n\n" +
				"Use init --json to read dependencies.required (package ranges), " +
				"dependencies.missing (unresolved packages) and dependencies.install (exact Bun argv). " +
				"dependencies.status is ready when xstate and zod resolve normally from the workflow " +
				"directory, otherwise install_required. This checks resolvability, not installed versions.\n\n" +
				"When installation is required, run dependencies.install to install the packages and " +
				"update the .workflows manifest and lockfile before input-schema or run. " +
				"No root package.json is required. Init does not install dependencies or select a tracker.",
		)
		.action(async () => {
			writeResult(await installDefaultWorkflow(options(), services), invocation);
		});
	cli
		.command("run <name>")
		.description("Start a named workflow beneath --parent work")
		.action(async (name: string) => {
			writeRunView(await startNamed(name, options(), services), invocation);
		});
	cli
		.command("start <source>")
		.description("Start an explicit definition beneath --parent work")
		.action(async (source: string) => {
			writeRunView(await start(source, options(), services), invocation);
		});
	cli.command("validate <source>").action(async (source: string) => {
		const result = await validate(resolve(services.cwd, source), options().inputFile, services);
		writeResult(result, invocation);
	});
}

function registerInspection(invocation: Invocation): void {
	registerSkills(invocation);
	registerSystem(invocation);
	const { cli, services } = invocation;
	const options = (): CliOptions => cli.opts<CliOptions>();
	cli
		.command("inspect [run]")
		.description("Read native lifecycle; explicitly expand trusted work or diagrams")
		.option("--schema", "Read inspection success schema without tracker access")
		.option(
			"--work",
			"Expand active briefs, choices and payload schemas through trusted author code",
		)
		.option("--diagram", "Expand saved structural diagrams through trusted author code")
		.option("--instructions", "Include labelled instruction previews; requires --diagram")
		.addHelpText(
			"after",
			"\nRUN is a workflow run ID. Unexpanded inspection requires its native record and a valid related " +
				"checkpoint, but no workflow source or Colony. Default success output is JSON; " +
				"--json adds the workflow_lifecycle envelope and machine-readable failures. " +
				"Reports native status, lifecycle, follow-up resolution and publication timestamps, " +
				"lock and settlement intent. Closed runs " +
				"without lifecycle markers remain unclassified. A lock observation does not " +
				"establish worker liveness.\n" +
				"Add --work for frozen active briefs, dispatch request IDs, choices, payload schemas " +
				"and author constraints; add --diagram for saved structure and --instructions for " +
				"labelled instruction previews. --instructions requires --diagram.\n\n" +
				"Requested expansions report kind available with data, or unavailable with reason, " +
				"message and context. Available diagrams identify mode structure or instructions. " +
				"Expansion failure preserves native facts and a successful inspection exit; malformed " +
				"native facts fail the command. Work and diagram carry their own checkpoint samples. " +
				"A terminal run can retain active actor history; inspection grants no admission.\n\n" +
				"Expansions load trusted author code. Work restores, starts and stops an actor; " +
				"diagram instructions can invoke render callbacks. They perform no engine writes " +
				"but are not I/O sandboxes. Use inspect --schema --json offline for the success schema.",
		)
		.action(
			async (
				id: string | undefined,
				selection: { schema?: boolean; work?: boolean; diagram?: boolean; instructions?: boolean },
			) => {
				invocation.kind = "workflow_lifecycle";
				if (selection.schema) {
					invocation.kind = "workflow_lifecycle_schema";
					const schema = workflowRunInspectionSchema.extend({
						ok: z.literal(true),
						kind: z.literal("workflow_lifecycle"),
					});
					writeResult({ schema: z.toJSONSchema(schema) }, invocation);
					return;
				}
				if (!id) {
					throw new BusyBeeError("usage", "inspect requires a workflow run ID.");
				}
				writeResult(await inspect({ id, ...selection }, options(), services), invocation);
			},
		);
	cli
		.command("settle [run] [operation]")
		.description("Cancel or fail unfinished scope, or acknowledge or replace an unsuccessful run")
		.option("--schema", "Read settlement input and success schemas without tracker access")
		.option("--reason <text>", "Required explicit disposition or follow-up explanation")
		.option("--replacement <run>", "Existing replacement workflow under the same native parent")
		.addHelpText(
			"after",
			"\nOperations: cancel or fail retires pending scope; ack accepts an existing failed " +
				"closure; supersede requires --replacement and cancels a pending predecessor or " +
				"preserves its existing failed/cancelled outcome. Cancel and fail also accept " +
				"--replacement. Every operation requires --reason and --actor or BD_ACTOR. " +
				"Success comes only from authored workflow completion.\n\n" +
				"Reads the native format-1 inventory without loading workflow source. Preserves " +
				"completed visits and original results; refuses unfinished manual/nested work " +
				"and human/HITL/other-agent reservations. Every operation requires clearance " +
				"from the running owning-host Colony daemon registered for this endpoint, " +
				"including all retained attempts. Settlement does not stop workers. See " +
				"colony system execution-clearance --help.\n\n" +
				"Use --json for the workflow_settlement envelope, including closedIds and the " +
				"resulting lifecycle/resolution. On uncertain publication, inspect reported " +
				"effect IDs, checkpoint ownership and run-note intent before explicit recovery; " +
				"do not replay or clear the lock. Source-task acceptance remains with its caller.\n" +
				"Offline discovery: busybee settle --schema --json returns inputSchema and the " +
				"success schema without a run, actor, tracker or daemon.",
		)
		.action(
			async (
				id: string | undefined,
				operation: string | undefined,
				selection: { reason?: string; replacement?: string; schema?: boolean },
			) => {
				invocation.kind = "workflow_settlement";
				if (selection.schema) {
					invocation.kind = "workflow_settlement_schema";
					const successSchema = settlementResultSchema.extend({
						ok: z.literal(true),
						kind: z.literal("workflow_settlement"),
					});
					const schema = z.toJSONSchema(successSchema);
					writeResult(
						{
							inputSchema: z.toJSONSchema(settlementRequestSchema),
							schema,
						},
						invocation,
					);
					return;
				}
				const request = settlementRequestSchema.parse({
					id,
					operation,
					reason: selection.reason,
					replacementId: selection.replacement,
				});
				writeResult(await settle(request, options(), services), invocation);
			},
		);
	cli.command("list").action(async () => {
		const result = await listWorkflows(options().repo, services);
		let readable = "";
		for (const entry of result.workflows) {
			let version = "";
			if (entry.version) {
				version = ` (${entry.version})`;
			}
			readable += `${entry.name}${version}: ${entry.description}\n`;
		}
		writeResult(result, invocation, readable);
	});
	cli
		.command("input-schema [name]")
		.description("Read creation-input schemas for a named workflow or explicit source")
		.option("--source <path>", "Inspect an explicit source module instead of a catalogue name")
		.action(async (name: string | undefined, selection: { source?: string }) => {
			const { source } = await schemaSource({ name, path: selection.source }, invocation);
			const definition = await importDefinition(source, services);
			const result = {
				constraints: definition.inputConstraints ?? "Initial workflow input",
				schema: z.toJSONSchema(definition.inputSchema, { io: "input" }),
			};
			writeResult(result, invocation, printDiscovery(result));
		});
}

function registerSystem(invocation: Invocation): void {
	const system = invocation.cli
		.command("system")
		.description("Checkpoint and simulation tooling; use inspect for run reads")
		.addHelpText(
			"after",
			"\nUse inspect --help for lifecycle, work and diagram reads. " +
				"System commands require --json; focused help owns their schemas and baselines.",
		);
	system
		.command("checkpoint <run>")
		.description(
			"Read checkpoint identity and update time without importing a definition; requires --json",
		)
		.action(async (id: string) => {
			invocation.kind = "workflow_checkpoint";
			requireSystemJson(invocation);
			writeResult(
				await checkpointVersion(id, invocation.cli.opts<CliOptions>(), invocation.services),
				invocation,
			);
		});
	system
		.command("simulate <run>")
		.description("Replay simulated outcomes without advancing saved work; requires --json")
		.requiredOption("--request <json>", "Baseline, actor, explicit start and original event list")
		.addHelpText(
			"after",
			"\nRead inspect RUN --diagram --instructions --json first. Require diagram.kind available " +
				"and mode instructions. From diagram.data copy checkpoint and savedAt, choose actorId " +
				"from actors[].id, and set definitionHash to definition.currentHash. " +
				"Set start.kind to saved, or use initial with explicit start.input for the root actor. " +
				"Original creation input is not retained. Supply events as {node, command, data} entries " +
				"using original JSON data; an empty list inspects the starting point. " +
				"Read system schema --simulation --json for request and success schemas.\n" +
				"A changed baseline requires a fresh preview. Replay evaluates trusted author calculations " +
				"and rejects encountered actor coordination, timers and custom effects; it starts no live " +
				"actors and performs no engine writes. This is not an I/O sandbox or proof of completed work.",
		)
		.action(async (id: string, selection: { request: string }) => {
			invocation.kind = "workflow_simulation";
			requireSystemJson(invocation);
			const request = workflowSimulationRequestSchema.parse(
				JSON.parse(selection.request) as unknown,
			);
			writeResult(
				await simulate({ id, request }, invocation.cli.opts<CliOptions>(), invocation.services),
				invocation,
			);
		});
	system
		.command("schema")
		.description(
			"Read tooling schemas without tracker access; defaults to the inspect success envelope; requires --json",
		)
		.option("--simulation", "Read simulation request and success schemas")
		.option("--checkpoint", "Read the checkpoint success schema")
		.action(
			// eslint-disable-next-line max-statements -- Publish the requested tooling schema without tracker access.
			(selection: { simulation?: boolean; checkpoint?: boolean }) => {
				if (selection.checkpoint) {
					invocation.kind = "workflow_checkpoint_schema";
					requireSystemJson(invocation);
					const schema = workflowCheckpointSchema.extend({
						ok: z.literal(true),
						kind: z.literal("workflow_checkpoint"),
					});
					writeResult({ schema: z.toJSONSchema(schema) }, invocation);
					return;
				}
				if (selection.simulation) {
					invocation.kind = "workflow_simulation_schema";
					requireSystemJson(invocation);
					const simulationSchema = workflowSimulationSchema.extend({
						ok: z.literal(true),
						kind: z.literal("workflow_simulation"),
					});
					writeResult(
						{
							requestSchema: z.toJSONSchema(workflowSimulationRequestSchema),
							schema: z.toJSONSchema(simulationSchema),
						},
						invocation,
					);
					return;
				}
				invocation.kind = "workflow_lifecycle_schema";
				requireSystemJson(invocation);
				const schema = workflowRunInspectionSchema.extend({
					ok: z.literal(true),
					kind: z.literal("workflow_lifecycle"),
				});
				writeResult({ schema: z.toJSONSchema(schema) }, invocation);
			},
		);
}

function requireSystemJson(invocation: Invocation): void {
	if (!invocation.json) {
		throw new BusyBeeError("json_required", "System tooling commands require --json");
	}
}

function registerSkills(invocation: Invocation): void {
	invocation.cli
		.command("skills [action] [name] [path]")
		.description(
			"Bundled guidance: list (default), get <name>, file <name> <path>; no repository required",
		)
		.addHelpText(
			"after",
			"\nList returns names and descriptions; --json also includes resource paths. Get returns Markdown without " +
				"frontmatter; file reads a listed resource (SKILL.md returns the same body as get).\n" +
				"Use --json for skills_list / skills_get envelopes. Unknown actions, missing or " +
				"unknown names, and missing or unlisted resources fail with a nonzero exit; " +
				"JSON mode returns an error envelope with reason usage.",
		)
		.action(
			async (action: string | undefined, name: string | undefined, path: string | undefined) => {
				invocation.kind = "error";
				const result = await readSkills(action, name, path);
				invocation.kind = result.payload.kind;
				writeResult(result.payload, invocation, `${result.readable.trimEnd()}\n`);
			},
		);
}

function registerPreflight(invocation: Invocation): void {
	const { cli, services } = invocation;
	cli
		.command("preflight <name>")
		.description("Read-only assessment of unfinished named runs; future paths remain unchecked")
		.option(
			"--source <path>",
			"Proposed module without catalogue lookup; version compatibility stays unchecked",
		)
		.action(async (name: string, selection: { source?: string }) => {
			const result = await preflight(name, { ...cli.opts<CliOptions>(), ...selection }, services);
			if (result.status !== "incompatible") {
				writeResult(result, invocation, printPreflight(result));
				return;
			}
			invocation.exitCode = FAILURE;
			writeResult(
				{
					...result,
					reason: "preflight_incompatible",
					message: `Preflight found incompatibilities for workflow ${name}; inspect runs and discovery findings.`,
				},
				invocation,
				printPreflight(result),
			);
		});
}

function registerNavigation(invocation: Invocation): void {
	const { cli, services } = invocation;
	const options = (): CliOptions => cli.opts<CliOptions>();
	cli
		.command("complete <run> <task> <choice>")
		.description("Save the original outcome, then close the worker visit; does not advance")
		.addHelpText(
			"after",
			"\nSatisfy acceptance and child work, and deliver any required answer before completion. " +
				"Read inspect RUN --work --json for CHOICE and its schema. Pass the original payload with " +
				"--data JSON or --data-file FILE; omission supplies {}. Notes hold only {choice,data}; " +
				"put narrative evidence in comments.\n" +
				"Complete validates and saves the original JSON, finishes the checkpoint write and " +
				"releases its lock, then reacquires it briefly to recheck retirement and attempt native " +
				"closure with Beads acceptance and child gates. Retired scope cannot become success. " +
				"Closure refusal preserves the saved result. Inspect the task, resolve the refusal and retry " +
				"with the same original choice and data. A matching retry can finish closure or acknowledge " +
				"an already-closed stage, even after collection. Different or malformed saved results fail; " +
				"a closed stage without saved evidence also fails.\n" +
				"Supports driver-handled and Bee-dispatched visits. The driver separately runs advance RUN " +
				"to advance. Use record-result --help when saving without closure. " +
				"Requires --actor or BD_ACTOR; see busybee --help for global options.",
		)
		.action(async (id: string, bead: string, choice: string) => {
			const data = await payload(options(), services);
			writeResult(await complete({ id, bead, choice, data }, options(), services), invocation);
		});
	cli
		.command("record-result <run> <task> <choice>")
		.description("Validate and save original {choice,data} notes without closure or advancement")
		.addHelpText(
			"after",
			"\nTASK must be an active, unclosed worker visit. Read inspect RUN --work --json for " +
				"CHOICE and its schema. Pass the original payload with --data JSON or --data-file FILE; " +
				"omission supplies {}. Notes are reserved for this result; put narrative evidence in comments.\n" +
				"This save-only primitive supports driver-handled and Bee-dispatched visits. " +
				"For ordinary stage completion, use complete --help; it saves before attempting native closure. " +
				"Mutations require --actor or BD_ACTOR; see busybee --help for global options.",
		)
		.action(async (id: string, bead: string, choice: string) => {
			const data = await payload(options(), services);
			writeResult(await recordResult({ id, bead, choice, data }, options(), services), invocation);
		});
	cli
		.command("advance [run]")
		.description(
			"Consume saved closed-stage results or prepare mutually exclusive driver admission",
		)
		.option(
			"--prepare-driver",
			"Validate driver admission under the checkpoint lock without consuming results",
		)
		.option("--schema", "Read progression success schemas without tracker access")
		.addHelpText(
			"after",
			"\nThe driver consumes original saved {choice,data} results from closed active visits, " +
				"including interrupted deliveries. Workers use complete first; advance accepts no " +
				"choice or payload. Busy Bee publishes the next frontier and closes finished groups " +
				"and the run. Reinspect with inspect RUN --work --json for briefs and schemas.\n\n" +
				"--prepare-driver selects admission preparation instead: it never consumes results. " +
				"It requires an active unassigned run, preserves reservations and worker assignments, " +
				"and may publish readiness/checkpoint bookkeeping under the checkpoint lock. " +
				"It neither claims a driver nor grants a durable lease.\n\n" +
				"--json returns a compact workflow_advance acknowledgment: mode results includes " +
				"runId, status and active bead/request IDs; mode prepare-driver includes runId, status " +
				"and checkpoint. No briefs or history are repeated. Mutations require --actor or " +
				"BD_ACTOR. Use advance --schema --json offline for both success shapes.",
		)
		.action(
			// eslint-disable-next-line max-statements -- Keep schema discovery and exclusive modes at the CLI boundary.
			async (id: string | undefined, selection: { prepareDriver?: boolean; schema?: boolean }) => {
				invocation.kind = "workflow_advance";
				if (selection.schema) {
					invocation.kind = "workflow_advance_schema";
					const envelope = z.object({ ok: z.literal(true), kind: z.literal("workflow_advance") });
					const schema = z.toJSONSchema(workflowAdvanceSchema.and(envelope));
					writeResult({ schema }, invocation);
					return;
				}
				if (!id) {
					throw new BusyBeeError("usage", "advance requires a workflow run ID.");
				}
				if (selection.prepareDriver) {
					writeResult(
						{
							mode: "prepare-driver",
							...(await advance({ id, mode: "prepare-driver" }, options(), services)),
						},
						invocation,
					);
					return;
				}
				const result = await advance({ id, mode: "results" }, options(), services);
				writeResult(
					{
						mode: "results",
						runId: result.id,
						status: result.status,
						active: result.active.map(({ bead, request }) => ({ bead, request })),
					},
					invocation,
				);
			},
		);
}

async function schemaSource(
	selection: { name: string | undefined; path: string | undefined },
	invocation: Invocation,
): Promise<Source> {
	if (selection.path && !selection.name) {
		return { kind: "file", source: resolve(invocation.services.cwd, selection.path) };
	}
	if (selection.name && !selection.path) {
		return await namedDefinition(
			selection.name,
			invocation.cli.opts<CliOptions>().repo,
			invocation.services,
		);
	}
	throw new BusyBeeError("invalid_selection", "Choose a workflow name or --source PATH");
}

async function payload(options: CliOptions, services: Services): Promise<unknown> {
	if (options.data && options.dataFile) {
		throw new BusyBeeError("invalid_payload", "Choose --data or --data-file");
	}
	if (options.dataFile) {
		return JSON.parse(await services.readText(options.dataFile)) as unknown;
	}
	return JSON.parse(options.data ?? "{}") as unknown;
}

function writeRunView(result: RunView, invocation: Invocation, instructions = false): void {
	const active = result.active.map((entry) => {
		const summary = {
			bead: entry.bead,
			commands: entry.commands,
			path: entry.path,
			request: entry.request,
			title: entry.title,
		};
		if (instructions) {
			return { ...summary, instructions: entry.instructions };
		}
		return summary;
	});
	writeResult({ ...result, active }, invocation);
}

function writeResult(result: object, invocation: Invocation, readable?: string): void {
	if (!invocation.json && readable !== undefined) {
		invocation.terminal.stdout(readable);
		return;
	}
	let document = result;
	if (invocation.json) {
		document = { ...result, kind: invocation.kind, ok: invocation.exitCode === SUCCESS };
	}
	invocation.terminal.stdout(`${JSON.stringify(document, undefined, INDENT)}\n`);
}

function reportFailure(error: unknown, invocation: Invocation): number {
	if (error instanceof CommanderError && error.exitCode === SUCCESS) {
		writeResult({ help: invocation.help }, invocation, invocation.help);
		return SUCCESS;
	}
	const failure = { ...failureDocument(error), kind: invocation.kind, target: invocation.target };
	if (invocation.json) {
		invocation.terminal.stdout(`${JSON.stringify(failure, undefined, INDENT)}\n`);
	} else {
		invocation.terminal.stderr(`${failure.message}\n`);
	}
	return FAILURE;
}

function failureDocument(error: unknown) {
	const failure = { message: errorMessages(error).join("\n"), ok: false, reason: "command_failed" };
	if (error instanceof BusyBeeError) {
		return { ...error.context, ...failure, reason: error.reason };
	}
	if (error instanceof z.ZodError) {
		return { ...failure, reason: "invalid_input" };
	}
	if (error instanceof CommanderError) {
		return { ...failure, reason: error.code };
	}
	return failure;
}

function errorMessages(error: unknown): string[] {
	const messages: string[] = [];
	let cause = error;
	while (cause) {
		if (cause instanceof Error) {
			messages.push(cause.message);
			({ cause } = cause);
		} else {
			messages.push(String(cause));
			cause = undefined;
		}
	}
	return messages;
}

function printDiscovery(result: Discovery): string {
	const lines = [
		result.constraints ?? "Initial workflow input",
		"Use --json for the complete authoritative schema, including nested or conditional constraints.",
	];
	if (result.schema) {
		lines.push(...readableSchema(result.schema));
	}
	for (const task of result.active ?? []) {
		lines.push(...readableTask(task));
	}
	return `${lines.join("\n")}\n`;
}

function printPreflight(result: PreflightReport): string {
	const lines = [
		`${result.name} ` +
			`${result.version ?? "(version unchecked)"}: ` +
			`${result.status} (` +
			`${result.runs.length} unfinished runs)`,
	];
	for (const diagnostic of result.discovery) {
		lines.push(`${diagnostic.checkpoint}: ${diagnostic.message}`);
	}
	for (const run of result.runs) {
		lines.push(`${run.id} [${run.checkpoint}]: ${run.status}`);
		for (const finding of run.findings) {
			lines.push(`  ${finding.status} ${finding.check}: ${finding.message}`);
		}
	}
	lines.push(...result.limits);
	return `${lines.join("\n")}\n`;
}

function readableTask(task: NonNullable<Discovery["active"]>[number]): string[] {
	let constraints = "";
	if (task.constraints) {
		constraints = ` — ${String(task.constraints)}`;
	}
	const lines = [`\n${task.bead}: ${task.title}${constraints}`];
	for (const { choice, schema } of task.choices) {
		lines.push(`Choice: ${choice}`, ...readableSchema(schema));
	}
	return lines;
}

function readableSchema(schema: JsonSchema | boolean, indent = ""): string[] {
	if (typeof schema === "boolean") {
		return [];
	}
	const lines: string[] = [];
	for (const variant of schema.anyOf ?? schema.oneOf ?? []) {
		lines.push(...readableSchema(variant, indent));
	}
	for (const [name, field] of Object.entries(schema.properties ?? {})) {
		if (typeof field !== "boolean") {
			lines.push(
				...readableField({
					field,
					indent,
					name,
					required: schema.required?.includes(name) ?? false,
				}),
			);
		}
	}
	return lines;
}

function readableField(input: {
	field: JsonSchema;
	indent: string;
	name: string;
	required: boolean;
}): string[] {
	const { field, indent, name, required } = input;
	const constraints = Object.fromEntries(
		Object.entries(field).filter(([key]) => constraintKeys.has(key)),
	);
	let requirement = "optional";
	if (required) {
		requirement = "required";
	}
	return [
		`${indent}` +
			`${name} (` +
			`${requirement}, ` +
			`${String(field.type ?? "variant")}) ` +
			`${field.description ?? ""} ` +
			`${JSON.stringify(constraints)}`,
		...readableChildren(field.items ?? field, `${indent}  `),
	];
}

function readableChildren(
	children: JsonSchema | boolean | (JsonSchema | boolean)[],
	indent: string,
): string[] {
	if (Array.isArray(children)) {
		return children.flatMap((child) => readableSchema(child, indent));
	}
	return readableSchema(children, indent);
}
