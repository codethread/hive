import { BusyBeeError, createServices, resolveMutation } from "../../src/native.ts";
import { Command, CommanderError } from "commander";
import type { Options, Services } from "../../src/native.ts";
import { CommandError } from "@hive/beads";
import { start } from "../../src/runtime.ts";
import { z } from "zod";

const FIRST = 0;
const FAILURE = 1;
const BEE = new URL("../../../colony/bin/bee.ts", import.meta.url).pathname;
const BUSYBEE = new URL("../../bin/busybee.ts", import.meta.url).pathname;
const DEFAULT = new URL("do-work.ts", import.meta.url).pathname;
const responseSchema = z.object({
	ok: z.literal(true),
	request: z.object({ id: z.string(), assignee: z.string() }),
});

export interface SubmissionOptions extends Options {
	/** Bee kind supplies the existing role and execution defaults. */
	kind: string;
}

export interface Submission {
	/** One driver request linked exclusively to the workflow run. */
	request: { id: string; assignee: string };
	/** The single assignment and completion anchor; stages contain the actual work. */
	run: Awaited<ReturnType<typeof start>>;
}

/** One assignment surface: start a workflow, using the one-stage default when omitted. */
export async function submitWorkflow(
	source: string | undefined,
	options: SubmissionOptions,
	services: Services,
): Promise<Submission> {
	// Validation happens inside start, before any workflow or spawn records are created.
	const run = await start(source ?? DEFAULT, { ...options, assignee: "" }, services);
	if (run.status === "done") {
		throw new BusyBeeError(
			"workflow_already_done",
			`Workflow ${run.id} completed during initialization; no Bee request was created.`,
			{ context: { runId: run.id } },
		);
	}
	const endpoint = await resolveMutation(options, services);
	services.beforeWrite();
	await services.beads.update(
		{ actor: endpoint.actor, cwd: endpoint.repo, db: endpoint.db },
		[run.id],
		{ status: "open", appendNotes: driverInstructions(run.id) },
	);
	return { request: await spawnWorkflow(run.id, options, services), run };
}

/** Executable prototypes; production Bee configuration and commands are unchanged. */
export async function runPrototype(): Promise<void> {
	try {
		await executePrototype();
	} catch (error) {
		if (error instanceof CommanderError && error.exitCode === FIRST) {
			return;
		}
		console.log(JSON.stringify(prototypeFailure(error)));
		process.exitCode = FAILURE;
	}
}

// --- Private helpers ---

async function executePrototype(): Promise<void> {
	const cli = new Command()
		.exitOverride()
		.configureOutput({ writeErr: () => {} })
		.description("Submit one workflow assignment; defaults to a single do-work stage")
		.argument("<kind>", "Existing Bee kind")
		.option("--workflow <source>", "Busy Bee definition; inspect with input-schema --source")
		.requiredOption("--input-file <file>", "Caller assignment and required workflow inputs as JSON")
		.option("--db <path>", "Selected native tracker")
		.option("--repo <path>", "Execution checkout")
		.requiredOption("--actor <agent>", "Audit actor", process.env.BD_ACTOR)
		.requiredOption("--owner <human>", "Accountable human")
		.addHelpText(
			"after",
			"\nDefault input: title, request and acceptance (array of verification " +
				"criteria).\nCustom workflows: inspect required inputs with busybee " +
				"input-schema --source PATH --json.\nThe resulting Bee request watches " +
				"one run; Busy Bee creates stages, workers close them, and Busy Bee " +
				"closes the run.\n",
		);
	cli.parse();
	const { workflow, ...options } = cli.opts<SubmissionOptions & { workflow?: string }>();
	const services = createServices();
	options.kind = cli.args[FIRST]!;
	const result = await submitWorkflow(workflow, options, services);
	console.log(JSON.stringify({ ok: true, kind: "prototype", ...result }));
}

async function spawn(
	run: string,
	options: SubmissionOptions,
	services: Services,
): Promise<{ id: string; assignee: string }> {
	const endpoint = await resolveMutation(options, services);
	const output = await services.execute(
		[
			process.execPath,
			BEE,
			"spawn",
			options.kind,
			run,
			"--repo",
			endpoint.repo,
			"--beads-db",
			endpoint.db,
			"--cwd",
			endpoint.repo,
			"--actor",
			endpoint.actor,
			"--json",
		],
		endpoint.repo,
	);
	return responseSchema.parse(JSON.parse(output) as unknown).request;
}

function driverInstructions(run: string): string {
	return (
		`Drive the existing Busy Bee run ${run}` +
		" to completion. Resume this run; never start a second run.\nUse " +
		`${JSON.stringify(process.execPath)} ` +
		`${JSON.stringify(BUSYBEE)} show ` +
		`${run} --json and discover ` +
		`${run} --json.\nRead active worker beads, respect their assignments, ` +
		"complete their work, close them, and submit the declared outcome " +
		"with next or choice. Claim manual stages with your injected " +
		"identity. For next, supply the active stage bead ID as the task " +
		"argument.\nAutomatic stages have independent Bee requests. Leave " +
		"those assignments intact and use collect for their results; do not " +
		"create a workflow wrapper for them.\nBusy Bee owns closure of this " +
		"run. Do not close it manually. Only report bee finish success once " +
		"the run reports done.\nIf blocked, record the blocker and next action " +
		"on this run, leave it open, and report bee finish blocked. Initial " +
		"workflow inputs are already persisted."
	);
}

function prototypeFailure(error: unknown): Record<string, unknown> {
	const result: Record<string, unknown> = {
		ok: false,
		kind: "prototype",
		reason: "command_failed",
		message: String(error),
	};
	if (error instanceof Error) {
		result.message = error.message;
	}
	if (error instanceof BusyBeeError) {
		if (error.cause !== undefined) {
			result.cause = failureCause(error.cause);
		}
		return { ...result, reason: error.reason, ...error.context };
	}
	if (error instanceof z.ZodError) {
		result.reason = "invalid_input";
	}
	return result;
}

function failureCause(cause: unknown): Record<string, unknown> {
	if (cause instanceof CommandError) {
		return { message: cause.message, code: cause.code, stdout: cause.stdout };
	}
	if (cause instanceof Error) {
		return { message: cause.message };
	}
	return { message: String(cause) };
}

async function spawnWorkflow(run: string, options: SubmissionOptions, services: Services) {
	try {
		return await spawn(run, options, services);
	} catch (error) {
		throw new BusyBeeError(
			"workflow_spawn_failed",
			`Workflow ${run} exists but Bee submission failed. Inspect it before submitting again.`,
			{
				cause: error,
				context: { runId: run },
			},
		);
	}
}
