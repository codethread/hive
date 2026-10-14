/* eslint-disable max-dependencies --
 * Launch boundary composes receipt, identity, configuration and detached executable
 * ownership.
 */
import type { Bead, BeadsService } from "@hive/beads";
import type { Formula, RepositoryEndpoint, SpawnRequest } from "@hive/shared";
import { colonyEntry, entryCommand } from "./executables.ts";
import {
	formulaSchema,
	invocationSchema,
	readSpawnRequest,
	recipeSchema,
	renderFormula,
	workflowAssignmentSchema,
} from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Supply the host home at the native invocation boundary.
import { homedir, hostname } from "node:os";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve owned receipt and execution directories.
import { join, resolve as resolvePath } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Own process log files and canonicalize launch cwd.
import { link, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { agentEnvironment } from "./identity.ts";
import { loadBeesConfig } from "./config.ts";
import { match } from "ts-pattern";
import { runOwnedExecution } from "./processes.ts";
/* eslint-disable-next-line import/no-nodejs-modules --
 * Launch the existing detached supervisor for ordinary attempts and drones.
 */
import { spawn as spawnSupervisor } from "node:child_process";
import { trackerScope } from "./tracker.ts";
import { z } from "zod";

const EMPTY = 0;
const SUCCESS = 0;
const JSON_INDENT = 2;
const FIRST_ATTEMPT = 1;
const NONEMPTY = 1;
export const launchReceiptSchema = z.strictObject({
	/** Work scope captured with the invocation, independent of its recipe. */
	assignment: workflowAssignmentSchema,
	attemptNumber: z.number().int().positive(),
	beadsDb: z.string(),
	bucket: z.string(),
	createdAt: z.string(),
	cwd: z.string(),
	directory: z.string(),
	formula: formulaSchema,
	id: z.string(),
	/** Requesting host captured for local inventory and durable reconciliation. */
	// eslint-disable-next-line unicorn/no-null -- Historical receipts without provenance are unbound, never adopted.
	host: z.string().trim().min(NONEMPTY).nullable().default(null),
	identity: z.string(),
	invocation: invocationSchema,
	policyRevisionId: z.string().nullable(),
	recipe: recipeSchema,
	spawnId: z.string(),
	taskIds: z.array(z.string()),
	token: z.string(),
});
const finishOutcomeSchema = z.discriminatedUnion("outcome", [
	z.strictObject({ outcome: z.literal("success") }),
	z.strictObject({ outcome: z.literal("blocked"), reason: z.string().trim().min(NONEMPTY) }),
]);
const finishReportSchema = z.strictObject({
	attemptId: z.string().uuid(),
	result: finishOutcomeSchema,
	spawnId: z.string().min(NONEMPTY),
	token: z.string().uuid(),
});
export interface FinishResult {
	/** Durable submission; an awake Colony still validates current-attempt authority. */
	kind: "finish_submitted";
	/** Spawn whose execution submitted the report. */
	requestId: string;
	/** Attempt-scoped provenance, never a replacement request. */
	attemptId: string;
}
const workerFields = { startedAt: z.string(), supervisorPid: z.number(), token: z.string() };
export const workerReceiptSchema = z.discriminatedUnion("kind", [
	z.strictObject({ ...workerFields, harnessPid: z.number(), kind: z.literal("running") }),
	z.strictObject({
		...workerFields,
		code: z.number(),
		harnessPid: z.number(),
		kind: z.literal("exited"),
	}),
	z.strictObject({ ...workerFields, kind: z.literal("failed"), message: z.string() }),
]);
export type LaunchReceipt = z.infer<typeof launchReceiptSchema>;
export interface LaunchRequest extends RepositoryEndpoint {
	/** Injected tracker used during preparation only. */
	beads: BeadsService;
	/** Spawn request to execute. */
	id: string;
	/** Explicit private execution state directory. */
	state: string;
}
type Eligibility =
	| { kind: "eligible"; tasks: Bead[] }
	| { kind: "finished" }
	| { kind: "waiting"; reason: string };
export interface Scheduling {
	/** Highest urgency across every related task. */
	priority: number;
	/** Native creation time of the spawn request. */
	createdAt: string;
	/** All related tasks used for same-tier ranking. */
	taskIds: string[];
}
export type Preparation =
	| { kind: "prepared"; receipt: LaunchReceipt; scheduling: Scheduling }
	| Exclude<Eligibility, { kind: "eligible" }>;
type Outcome = { kind: "exited"; code: number } | { kind: "failed"; message: string };

export async function launch(request: LaunchRequest): Promise<unknown> {
	const { config } = await loadBeesConfig(request.root);
	const prepared = await prepareLaunch(request, config.formulas, crypto.randomUUID());
	const receipt = match(prepared)
		.with({ kind: "prepared" }, (value) => value.receipt)
		.with({ kind: "waiting" }, ({ reason }) => {
			throw new Error(reason);
		})
		.with({ kind: "finished" }, () => {
			throw new Error(`Request ${request.id} has no unfinished tasks`);
		})
		.exhaustive();
	await writeReceipt(receipt);
	const outcome = await executeWorker(receipt, request.state);
	const result = { ...receipt, outcome };
	await Bun.write(
		join(receipt.directory, "receipt.json"),
		JSON.stringify(result, undefined, JSON_INDENT),
	);
	return match(outcome)
		.with({ kind: "failed" }, ({ message }) => {
			throw new Error(`Launch failed (${receipt.directory}): ${message}`);
		})
		.with({ kind: "exited" }, ({ code }) => {
			if (code !== SUCCESS) {
				throw new Error(`Worker exited ${code}; receipt and logs: ${receipt.directory}`);
			}
			return result;
		})
		.exhaustive();
}

/** One preparation path serves synchronous launch and daemon reservations. */
/* eslint-disable-next-line max-statements, max-params --
 * Keep eligibility and immutable snapshot creation before any process side effect.
 */
export async function prepareLaunch(
	request: LaunchRequest,
	formulas: Record<string, Formula>,
	attemptId: string,
	attemptNumber = FIRST_ATTEMPT,
	// eslint-disable-next-line unicorn/no-null -- Manual launches have no daemon policy revision.
	policyRevisionId: string | null = null,
): Promise<Preparation> {
	const { beads } = request;
	const spawn = await beads.show(trackerScope(request, "colony"), request.id);
	if (spawn.status !== "open") {
		throw new Error(`Request ${spawn.id} is ${spawn.status}, expected open`);
	}
	const assignmentRequest = readSpawnRequest(spawn);
	const { recipe, identity, taskIds, host, assignment } = assignmentRequest;
	if (host !== hostname()) {
		throw new Error(`Request ${spawn.id} belongs to host ${host ?? "unbound"}, not ${hostname()}`);
	}
	const tasks = await Promise.all(
		taskIds.map((id) => beads.show(trackerScope(request, identity), id)),
	);
	const ready = await beads.ready(trackerScope(request, identity), { limit: 0 });
	const eligible = eligibility(tasks, ready, identity);
	if (eligible.kind !== "eligible") {
		return eligible;
	}
	const formula = formulas[recipe.harness];
	if (!formula) {
		throw new Error(`No formula named ${recipe.harness}`);
	}
	const prompt = renderExecutionPrompt(assignmentRequest);
	const invocation = renderFormula(formula, { ...recipe, prompt }, "headless", homedir());
	let executionDirectory = request.root;
	if (recipe.cwd !== null) {
		executionDirectory = resolvePath(request.root, recipe.cwd);
	}
	const cwd = await realpath(executionDirectory);
	return {
		kind: "prepared",
		receipt: {
			assignment,
			attemptNumber,
			beadsDb: request.beadsDb,
			bucket: await launchBucket(cwd),
			createdAt: new Date().toISOString(),
			cwd,
			directory: join(resolvePath(request.state), attemptId),
			formula,
			id: attemptId,
			host,
			identity,
			invocation,
			policyRevisionId,
			recipe,
			spawnId: spawn.id,
			taskIds: tasks.map((task) => task.id),
			token: crypto.randomUUID(),
		},
		scheduling: {
			createdAt: spawn.created_at,
			priority: Math.min(...tasks.map((task) => task.priority)),
			taskIds: tasks.map((task) => task.id),
		},
	};
}

/** Materialize the captured role's delivery protocol without changing the stored recipe. */
export function renderExecutionPrompt({
	assignment: scope,
	recipe,
	taskIds,
}: Pick<SpawnRequest, "assignment" | "recipe" | "taskIds">): string {
	const blocked =
		"If blocked, complete all possible work, record the blocker and required next " +
		"action on unfinished tasks, leave them unclosed, then call bee finish blocked " +
		'--reason "<unfinished task, blocker and required next action>".';
	const protocol = match(scope)
		.with(
			{ kind: "driver" },
			(assignment) =>
				"Coordinate the existing Busy Bee workflow run " +
				`${assignment.runId}` +
				". Read its instructions and acceptance criteria, then use busybee show " +
				`${assignment.runId}` +
				" --json and busybee discover " +
				`${assignment.runId}` +
				" --json to inspect the active visits, choices and payload schemas. Resume this " +
				"run; do not start another run on retry.\n\nClaim, perform and verify the active " +
				"driver-handled stages. On retry, reacquire unfinished driver-handled visits under your current " +
				"identity, claiming only unassigned visits or your own claims. Preserve other " +
				"identities and human/HITL reservations; record a blocker instead of replacing " +
				"their assignments. Before closing each driver-handled stage, use busybee record-result " +
				`${assignment.runId}` +
				" STAGE CHOICE --data-file FILE to validate and persist its selected outcome and " +
				'original payload as {"choice":"<outcome>","data":{...}}. Comment on that stage ' +
				"with your deliverable and verification evidence, then close it only when its " +
				"acceptance criteria and child work are satisfied. Use busybee collect " +
				`${assignment.runId}` +
				" --json to consume saved closed-stage results, including interrupted driver-handled " +
				"deliveries and Bee-dispatched worker results. Standalone explicit navigation is " +
				"available through busybee next " +
				`${assignment.runId}` +
				" STAGE and busybee choice " +
				`${assignment.runId}` +
				" STAGE CHOICE --data-file FILE. Do not redo closed work. Bee-dispatched workers own " +
				"their assigned stages; collect their results without taking their " +
				"claims.\n\nRemain running while Bee-dispatched work is pending; waiting consumes " +
				"ordinary quota. If waiting drivers starve the pool, the user must increase the " +
				"relevant limits.\n\nBusy Bee alone closes grouping beads and the run. Never " +
				"manually close run " +
				`${assignment.runId}` +
				". Comment on the run with your delivery and verification evidence, and call bee " +
				"finish success only after Busy Bee reports status done.\n\nAdditional task beads " +
				"for work within this workflow must have " +
				`${assignment.runId}` +
				" as their native parent. Independent delegation remains separate; obtain any " +
				"required delegated results before completing the workflow.",
		)
		.with(
			{ kind: "stage" },
			(assignment) =>
				"Perform only the assigned Bee-dispatched visit " +
				`${assignment.stageId}` +
				" in Busy Bee run " +
				`${assignment.runId}` +
				". Read its full instructions, acceptance criteria and result schema. Do and " +
				"verify that work, then use busybee record-result " +
				`${assignment.runId}` +
				" " +
				`${assignment.stageId}` +
				" CHOICE --data-file FILE to validate and save the selected choice and original " +
				'payload as {"choice":"<outcome>","data":{...}}, before closing the stage. ' +
				"Comment on " +
				`${assignment.stageId}` +
				" with your deliverable and verification evidence. Close only your assigned stage " +
				"after satisfying its acceptance criteria and child work, then call bee finish " +
				"success.\n\nNever navigate the workflow: do not call busybee next, choice or " +
				"collect, do not create another run, and do not close grouping beads or run " +
				`${assignment.runId}` +
				". The workflow driver collects your saved result and Busy Bee advances the " +
				"run.\n\nAdditional task beads for work within this workflow must have " +
				`${assignment.runId}` +
				" as their native parent. Independent delegation remains separate; obtain any " +
				"required delegated results before closing your stage.",
		)
		.exhaustive();
	return [recipe.prompt, protocol, blocked, `Related tasks: ${taskIds.join(", ")}`]
		.filter(Boolean)
		.join("\n\n");
}

export async function writeReceipt(receipt: LaunchReceipt): Promise<void> {
	await mkdir(receipt.directory, { recursive: true });
	await Bun.write(
		join(receipt.directory, "receipt.json"),
		JSON.stringify(receipt, undefined, JSON_INDENT),
	);
}

/** The supervisor touches only its own artifacts and never reconciles Beads. */
// eslint-disable-next-line max-statements -- Acquisition and finally-based cleanup stay beside the owned subprocess.
export async function executeWorker(
	receipt: LaunchReceipt,
	state: string,
	options: { deadline?: number; environment?: Record<string, string> } = {},
): Promise<Outcome> {
	const { directory, invocation, cwd, identity, recipe, spawnId, beadsDb, token } = receipt;
	const stdout = await open(join(directory, "stdout.log"), "w");
	const stderr = await open(join(directory, "stderr.log"), "w");
	const ownership = { startedAt: new Date().toISOString(), supervisorPid: process.pid, token };
	try {
		const result = await runOwnedExecution(
			receipt,
			() =>
				Bun.spawn([invocation.executable, ...invocation.argv], {
					cwd,
					env: {
						...process.env,
						...agentEnvironment(identity, recipe),
						BEADS_DB: beadsDb,
						HIVE_ATTEMPT_ID: receipt.id,
						HIVE_ATTEMPT_NUMBER: String(receipt.attemptNumber),
						HIVE_ATTEMPT_TOKEN: token,
						HIVE_COLONY_STATE: resolvePath(state),
						HIVE_SPAWN_ID: spawnId,
						...options.environment,
					},
					stderr: stderr.fd,
					stdout: stdout.fd,
				}),
			(harnessPid) => writeWorkerReceipt(directory, { ...ownership, harnessPid, kind: "running" }),
			options.deadline,
		);
		const { code } = result;
		await writeWorkerReceipt(directory, {
			...ownership,
			code,
			harnessPid: result.pid,
			kind: "exited",
		});
		return { code, kind: "exited" };
	} catch (error) {
		let message = String(error);
		if (error instanceof Error) {
			({ message } = error);
		}
		await writeWorkerReceipt(directory, { ...ownership, kind: "failed", message });
		return { kind: "failed", message };
	} finally {
		await stdout.close();
		await stderr.close();
	}
}

/** Submit once to the injected attempt; no native spawn mutation is trusted to the worker. */
// eslint-disable-next-line max-statements -- Validate provenance and atomically publish one immutable attempt report.
export async function submitFinish(
	outcome: string,
	options: { reason?: string },
	env: Record<string, string | undefined> = process.env,
): Promise<FinishResult> {
	const report = finishReportSchema.parse({
		attemptId: env["HIVE_ATTEMPT_ID"],
		result: { outcome, ...options },
		spawnId: env["HIVE_SPAWN_ID"],
		token: env["HIVE_ATTEMPT_TOKEN"],
	});
	const state = z.string().min(NONEMPTY).parse(env["HIVE_COLONY_STATE"]);
	const directory = join(state, report.attemptId);
	const receipt = launchReceiptSchema.parse(await Bun.file(join(directory, "receipt.json")).json());
	assertFinishAuthority(report, receipt);
	const path = join(directory, "finish.json");
	const temporary = `${path}.${crypto.randomUUID()}.tmp`;
	await Bun.write(temporary, JSON.stringify(report));
	try {
		await link(temporary, path);
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
			throw error;
		}
		const existing = finishReportSchema.parse(await Bun.file(path).json());
		if (JSON.stringify(existing) !== JSON.stringify(report)) {
			throw new Error(`Attempt ${report.attemptId} already submitted a different finish report`, {
				cause: error,
			});
		}
	} finally {
		await unlink(temporary);
	}
	return { attemptId: report.attemptId, kind: "finish_submitted", requestId: report.spawnId };
}

/** Only call for the recorded current attempt; stale artifact directories are never scanned. */
export async function readFinishReport(receipt: LaunchReceipt) {
	const file = Bun.file(join(receipt.directory, "finish.json"));
	if (!(await file.exists())) {
		return;
	}
	const report = finishReportSchema.parse(await file.json());
	assertFinishAuthority(report, receipt);
	return report.result;
}

/** One detached supervisor handoff serves both task execution and one-shot drone reviews. */
export async function startSupervisor(
	receipt: LaunchReceipt,
	state: string,
	onSpawned: (pid: number) => void = () => {},
): Promise<number> {
	const log = await open(join(receipt.directory, "supervisor.log"), "a");
	try {
		const [executable, ...prefix] = entryCommand(colonyEntry("worker"));
		const child = spawnSupervisor(
			executable,
			[...prefix, join(receipt.directory, "receipt.json"), state],
			{
				cwd: receipt.cwd,
				detached: true,
				env: { ...process.env, BEADS_DB: receipt.beadsDb },
				stdio: ["ignore", log.fd, log.fd],
			},
		);
		/* eslint-disable-next-line promise/avoid-new --
		 * Adapt Node subprocess spawn/error events to the reservation handoff.
		 */
		return await new Promise<number>((resolve, reject) => {
			child.once("error", reject);
			child.once("spawn", () => {
				const pid = z.number().int().positive().parse(child.pid);
				onSpawned(pid);
				child.unref();
				resolve(pid);
			});
		});
	} finally {
		await log.close();
	}
}

/** Resolve the canonical capacity bucket without preparing or reserving an execution. */
export async function launchBucket(cwd: string): Promise<string> {
	const child = Bun.spawn(["git", "rev-parse", "--show-toplevel"], {
		cwd,
		env: { ...process.env, LC_ALL: "C" },
		stderr: "pipe",
		stdout: "pipe",
	});
	const [code, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	if (code === SUCCESS) {
		return realpath(stdout.trim());
	}
	if (stderr.startsWith("fatal: not a git repository (or any of the parent directories): .git")) {
		return cwd;
	}
	throw new Error(`Cannot resolve launch bucket for ${cwd}: ${stderr.trim()}`);
}

/** Shared native-ready and reservation decision used before launch and by explain. */
export function eligibility(
	tasks: Bead[],
	ready: Pick<Bead, "id">[],
	identity: string,
): Eligibility {
	if (tasks.length === EMPTY) {
		return { kind: "waiting", reason: "Spawn request has no related tasks" };
	}
	const unfinished = tasks.filter((task) => task.status !== "closed");
	if (unfinished.length === EMPTY) {
		return { kind: "finished" };
	}
	const blocked = unfinished.find(
		(task) =>
			!ready.some((item) => item.id === task.id) ||
			(task.assignee !== undefined && task.assignee !== identity) ||
			task.labels.includes("hitl"),
	);
	if (blocked) {
		return { kind: "waiting", reason: `Task ${blocked.id} is not ready or is reserved` };
	}
	return { kind: "eligible", tasks: unfinished };
}

// --- Private functions ---
async function writeWorkerReceipt(
	directory: string,
	receipt: z.infer<typeof workerReceiptSchema>,
): Promise<void> {
	const temporary = join(directory, "worker.json.tmp");
	await Bun.write(temporary, JSON.stringify(receipt, undefined, JSON_INDENT));
	await rename(temporary, join(directory, "worker.json"));
}

function assertFinishAuthority(
	report: z.infer<typeof finishReportSchema>,
	receipt: LaunchReceipt,
): void {
	if (
		report.attemptId !== receipt.id ||
		report.spawnId !== receipt.spawnId ||
		report.token !== receipt.token
	) {
		throw new Error("Finish report does not match recorded attempt authority");
	}
}
