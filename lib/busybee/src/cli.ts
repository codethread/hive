/* eslint-disable import/max-dependencies --
 * The CLI composes workflow operations and bundled guidance at the command boundary.
 */
import { BusyBeeError, installDefaultWorkflow } from "./native.ts";
import { Command, CommanderError } from "commander";
import type { Options, Services } from "./native.ts";
import {
	changelogHistorySchema,
	changelogQuerySchema,
	changelogSchema,
	queryChangelog,
	renderChangelog,
} from "@hive/shared/changelog";
import { checkpointVersion, inspect, preview } from "./preview.ts";
import {
	complete,
	discover,
	navigate,
	prepareDriver,
	reconcile,
	runViewSchema,
	start,
	startNamed,
} from "./runtime.ts";
import { importDefinition, validate } from "./definition.ts";
import { listWorkflows, namedDefinition } from "./catalogue.ts";
import { settle, settlementRequestSchema, settlementResultSchema } from "./settlement.ts";
import {
	workflowCheckpointSchema,
	workflowInspectionSchema,
	workflowSimulationRequestSchema,
	workflowSimulationSchema,
} from "@hive/shared";
import type { PreflightReport } from "./preflight.ts";
import type { RunView } from "./runtime.ts";
import type { Source } from "./catalogue.ts";
import changelog from "../changelog.json";
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
const navigationHelp = {
	show: {
		description: "Read compact run status, active tasks and generated visit references",
		details:
			"\nRun views from run/start/show/collect omit actor context and instruction bodies. " +
			"They retain run status, active task IDs, titles, commands, request IDs, actor paths and visit references. " +
			"Use show RUN --instructions --json to include each active visit's exact saved instruction text. " +
			"Read br show RUN --json for caller completion instructions and br show TASK --json for the full " +
			"native brief, acceptance, assignment, children, blockers and delivery/closure instructions. " +
			"Use discover --json for outcome payload schemas. " +
			"chartStatus is saved chart state; nativeStatus is the current native run status. " +
			"completion is pending, projection_pending, succeeded, failed or cancelled. " +
			"status is completion_pending when the chart is done without confirmed native success. " +
			"Performs no native writes, but restores, starts and stops a workflow actor. " +
			"For saved diagrams/state without creating actors, use preview --help.",
	},
	collect: {
		description:
			"Advance from closed active tasks with saved results, including interrupted deliveries",
		details:
			"\nWorkers use complete to save their outcomes and close their tasks; the driver collects them. " +
			"Collection can advance both driver-handled and Bee-dispatched visits and publish new work. " +
			"Only saved originals with confirmed successful native closure are consumed. " +
			"Stale completion projections are reconciled through current native gates; " +
			"failed/cancelled visits cannot advance. Accepted history and chart state are saved " +
			"before group/run closure, so a refused container close retries without replaying results. " +
			"Busy Bee reports status done only after successful native run completion. " +
			"Requires --actor or BD_ACTOR; see busybee --help for global options.",
	},
};
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
			"\nWork: show RUN, discover RUN --json, perform the active task, " +
				"complete RUN TASK CHOICE, then the driver runs collect RUN. " +
				"Busy Bee closes groups and the run.\n" +
				"Run views are compact; see show --help for instruction expansion.\n" +
				"Inspect saved diagrams/state with preview RUN --json. " +
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
		.command("preview <run>")
		.description("Preview an active or completed run's latest saved workflow state")
		.addHelpText(
			"after",
			"\nRUN is the workflow run ID, not a generated stage or group ID. " +
				"Use --json for the workflow_preview envelope: structural graphs, original saved " +
				"root/retained-child state and source provenance.\n" +
				"Imports trusted workflow code; creates no actors, calls no workflow callbacks " +
				"and writes no beads. Excludes context, task bodies and implementations. " +
				"Use show for active work and discover --json for outcome payload schemas.",
		)
		.action(async (id: string) => {
			invocation.kind = "workflow_preview";
			writeResult(await preview(id, options(), services), invocation);
		});
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
	cli
		.command("discover <run>")
		.description("Read active outcome choices, payload schemas and author constraints")
		.addHelpText(
			"after",
			"\nUse --json for complete schemas, including nested/conditional fields. " +
				"Use show --help for active-work inspection and complete --help before completing a stage. " +
				"Discovery performs no native writes; it restores, starts and stops a workflow " +
				"actor and calls author discovery/schema code. It is not a reservation.",
		)
		.action(async (id: string) => {
			const result = await discover(id, options(), services);
			writeResult(result, invocation, printDiscovery(result));
		});
}

function registerSystem(invocation: Invocation): void {
	const system = invocation.cli
		.command("system")
		.description("JSON tooling interfaces; use show, discover or preview for routine work")
		.addHelpText(
			"after",
			"\nApplications use these JSON interfaces; Bee uses prepare-driver for driver admission.\n" +
				"Working agents use show for active tasks, discover for choices and preview for saved-state diagrams.\n" +
				"All system commands require --json.",
		);
	system
		.command("prepare-driver <run>")
		.description(
			"Bee integration: prepare an active run for driver admission under its checkpoint lock",
		)
		.addHelpText(
			"after",
			"\nRequires --json. Preserves closed runs, human reservations, blocked work and worker assignments.\n" +
				"For an orphan run, use bee attach-workflow --help; for a failed driver, use bee retry --help.",
		)
		.action(async (id: string) => {
			requireSystemJson(invocation);
			writeResult(
				await prepareDriver(id, invocation.cli.opts<CliOptions>(), invocation.services),
				invocation,
			);
		});
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
		.command("preview <run>")
		.description("Inspect saved graphs and labelled instruction previews; requires --json")
		.addHelpText(
			"after",
			"\nReads one checkpoint without starting actors, evaluating actions or guards, advancing " +
				"the run, acquiring locks or performing engine writes. " +
				"Published active briefs remain frozen; other task callbacks run against each retained " +
				"actor's saved context and are labelled rendered or unavailable. These are previews, " +
				"not published task briefs. Imports and callbacks execute trusted author code; " +
				"this is not an I/O sandbox. " +
				"Use system schema --json for the success envelope schema.",
		)
		.action(async (id: string) => {
			invocation.kind = "workflow_inspection";
			requireSystemJson(invocation);
			writeResult(
				await inspect(id, invocation.cli.opts<CliOptions>(), invocation.services),
				invocation,
			);
		});
	system
		.command("simulate <run>")
		.description("Replay simulated outcomes without advancing saved work; requires --json")
		.requiredOption("--request <json>", "Baseline, actor, explicit start and original event list")
		.addHelpText(
			"after",
			"\nRead system preview RUN --json first. Copy checkpoint and savedAt from that inspection, " +
				"choose actorId from actors[].id, and set definitionHash to definition.currentHash. " +
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
			"Read tooling schemas without tracker access; defaults to workflow_inspection; requires --json",
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
				invocation.kind = "workflow_inspection_schema";
				requireSystemJson(invocation);
				const schema = workflowInspectionSchema.extend({
					ok: z.literal(true),
					kind: z.literal("workflow_inspection"),
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
			"\nSatisfy native acceptance and child work, and deliver any required answer before completion. " +
				"Read discover RUN --json for CHOICE and its schema. Supply original JSON through " +
				"--data or --data-file; omission supplies {}. " +
				"Under the workflow system record's lock, complete saves the immutable original and " +
				"requested successful completion together before guarded native closure. " +
				"Current native checklist items, children, blockers and reservations remain gates; " +
				"the engine never ticks acceptance. Notes remain untouched. If closure is refused after saving, " +
				"result and intent remain; ownership releases when possible. Inspect reported effects, then " +
				"retry with the same original choice/data, or reconcile RUN. " +
				"A conflicting original fails. Matching retries after collection never replay the transition. " +
				"Complete does not advance; the driver runs collect RUN. Requires --actor or BD_ACTOR.",
		)
		.action(async (id: string, bead: string, choice: string) => {
			const data = await payload(options(), services);
			writeResult(await complete({ id, bead, choice, data }, options(), services), invocation);
		});
	registerRunViews(invocation);
	registerSettlement(invocation);
	cli
		.command("reconcile <run>")
		.description(
			"Repair known native completion projections without loading a definition or advancing",
		)
		.addHelpText(
			"after",
			"\nRepairs only generated completion fields and outcome labels through current native " +
				"gates and reservations. A direct close without a saved directive is reopened to open; " +
				"stale confirmed closure or close prose may require guarded reopen/reclose and a new closed_at. " +
				"Briefs, acceptance, notes and assignments are preserved. It never creates work, advances " +
				"the chart or authorizes settlement. Failed/cancelled reclosure requires the same settle " +
				"operation and reason with fresh clearance, even after a previously complete settlement. " +
				"Requires --actor or BD_ACTOR.",
		)
		.action(async (id: string) => {
			writeResult(await reconcile(id, options(), services), invocation);
		});
}

function registerSettlement(invocation: Invocation): void {
	const { cli, services } = invocation;
	cli
		.command("settle [run] [operation]")
		.description("Fail or cancel pending generated scope without changing completed work")
		.option("--schema", "Read input and success schemas without tracker access")
		.option("--reason <text>", "Required retirement explanation")
		.addHelpText(
			"after",
			"\nUse settle RUN cancel|fail --reason TEXT. Requires --actor or BD_ACTOR. " +
				"Read input and success schemas offline with settle --schema --json. " +
				"Success reports runId, operation and closedIds.\n\n" +
				"Retires only pending generated scope, closing visits/groups bottom-up and the run last. " +
				"Preserves original results and successful directives, including requested success: " +
				"after clearance these may be gated-confirmed, never converted to failure/cancellation. " +
				"An existing successful run directive requires collect/reconcile instead. Refuses unfinished manual " +
				"descendants, human/HITL or other-agent reservations and unsupported inventory; native " +
				"acceptance and child gates still apply. It does not close source work or ancestors, " +
				"stop processes, change the saved chart state or recover a held checkpoint lock.\n\n" +
				"Explicit unmanaged checkpoint provenance, complete native inventory agreement and no " +
				"contradictory requests permit daemon-free settlement. Missing/invalid provenance fails. " +
				"Managed exposure requires fresh clearance from the running owning-host Colony " +
				"daemon registered for this repository/database. Use matching Busy Bee/Bee/Colony versions " +
				"on one live database; concurrent tracker exchange is not fenced.\n\n" +
				"The system record's lock and durable settlement intent fence publication/admission. " +
				"Known partial completion retains intent and releases its own lock when possible. " +
				"Every same-operation/reason retry obtains fresh clearance, even after a previously " +
				"complete settlement. " +
				"Unchecked acceptance can leave settlement pending. Notes are untouched; native close " +
				"prose is not machine authority. There is no automatic held-owner recovery.",
		)
		.action(
			async (
				id: string | undefined,
				operation: string | undefined,
				selection: { reason?: string; schema?: boolean },
			) => {
				invocation.kind = "workflow_settlement";
				if (selection.schema) {
					invocation.kind = "workflow_settlement_schema";
					const successSchema = settlementResultSchema.extend({
						ok: z.literal(true),
						kind: z.literal("workflow_settlement"),
					});
					writeResult(
						{
							inputSchema: z.toJSONSchema(settlementRequestSchema),
							schema: z.toJSONSchema(successSchema),
						},
						invocation,
					);
					return;
				}
				const request = settlementRequestSchema.parse({ id, operation, reason: selection.reason });
				writeResult(await settle(request, cli.opts<CliOptions>(), services), invocation);
			},
		);
}

function registerRunViews(invocation: Invocation): void {
	const { cli, services } = invocation;
	for (const operation of ["show", "collect"] as const) {
		const command = cli
			.command(`${operation} <run>`)
			.description(navigationHelp[operation].description)
			.addHelpText("after", navigationHelp[operation].details);
		if (operation === "show") {
			command.option("--instructions", "Include exact saved instructions for active visits");
		}
		command.action(async (id: string, selection: { instructions?: boolean }) => {
			writeRunView(
				await navigate({ id, operation }, cli.opts<CliOptions>(), services),
				invocation,
				selection.instructions === true,
			);
		});
	}
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
