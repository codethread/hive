import { Command, CommanderError } from "commander";
import type { Options, Services } from "./native.ts";
import { discover, navigate, start, startNamed } from "./runtime.ts";
import { importDefinition, validate } from "./definition.ts";
import { listWorkflows, namedDefinition } from "./catalogue.ts";
import { BusyBeeError } from "./native.ts";
import type { PreflightReport } from "./preflight.ts";
import type { Source } from "./catalogue.ts";
import { preflight } from "./preflight.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Explicit source paths resolve against the invoking directory.
import { resolve } from "node:path";
import { z } from "zod";

const SUCCESS = 0;
const FAILURE = 1;
const INDENT = 2;
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
		.option("--db <path>", "Override native br database selection (otherwise BEADS_DB/discovery)")
		.option("--repo <path>", "Repository/execution directory; defaults to current directory")
		.option("--actor <identity>", "Mutation audit actor; defaults to BD_ACTOR")
		.option("--owner <human>", "Accountable human; required when starting")
		.option(
			"-a, --assignee <agent>",
			"Initial run/manual-task assignee; defaults to starting actor",
		)
		.option("--json", "One machine-readable success or failure document")
		.option("--input-file <path>", "Initial actor input as JSON; defaults to an empty object")
		.option("--data <json>", "Event payload; defaults to an empty object")
		.option("--data-file <path>", "Event payload as a JSON file");
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
	cli.command("run <name>").action(async (name: string) => {
		writeResult(await startNamed(name, options(), services), invocation);
	});
	cli.command("start <source>").action(async (source: string) => {
		writeResult(await start(source, options(), services), invocation);
	});
	cli.command("validate <source>").action(async (source: string) => {
		const result = await validate(resolve(services.cwd, source), options().inputFile, services);
		writeResult(result, invocation);
	});
}

function registerInspection(invocation: Invocation): void {
	const { cli, services } = invocation;
	const options = (): CliOptions => cli.opts<CliOptions>();
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
	cli.command("discover <run>").action(async (id: string) => {
		const result = await discover(id, options(), services);
		writeResult(result, invocation, printDiscovery(result));
	});
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
	for (const operation of ["show", "collect"] as const) {
		cli.command(`${operation} <run>`).action(async (id: string) => {
			writeResult(await navigate({ id, operation }, options(), services), invocation);
		});
	}
	cli.command("next <run> <task>").action(async (id: string, bead: string) => {
		const data = await payload(options(), services);
		writeResult(
			await navigate({ bead, choice: "next", data, id, operation: "submit" }, options(), services),
			invocation,
		);
	});
	cli
		.command("choice <run> <task> <choice>")
		.action(async (id: string, bead: string, choice: string) => {
			const data = await payload(options(), services);
			writeResult(
				await navigate({ bead, choice, data, id, operation: "submit" }, options(), services),
				invocation,
			);
		});
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
	if (
		error instanceof CommanderError &&
		(error.code === "commander.helpDisplayed" || error.code === "commander.help")
	) {
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
		`${result.name} ${result.version ?? "(version unchecked)"}: ${result.status} (${result.runs.length} unfinished runs)`,
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
		`${indent}${name} (${requirement}, ${String(field.type ?? "variant")}) ${field.description ?? ""} ${JSON.stringify(constraints)}`,
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
