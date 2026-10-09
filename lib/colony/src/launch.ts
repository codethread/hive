import type { Bead, Formula, RepositoryEndpoint } from "@hive/shared";
import {
	beadSchema,
	beads,
	formulaSchema,
	invocationSchema,
	readSpawnRequest,
	recipeSchema,
	renderFormula,
	showBead,
} from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve owned receipt and execution directories.
import { join, resolve as resolvePath } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Own process log files and canonicalize launch cwd.
import { link, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { agentEnvironment } from "./identity.ts";
import { loadBeesConfig } from "./config.ts";
import { match } from "ts-pattern";
import { runOwnedExecution } from "./processes.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Launch the existing detached supervisor for ordinary attempts and drones.
import { spawn as spawnSupervisor } from "node:child_process";
import { z } from "zod";

const EMPTY = 0;
const SUCCESS = 0;
const JSON_INDENT = 2;
const FIRST_ATTEMPT = 1;
const NONEMPTY = 1;
export const launchReceiptSchema = z.strictObject({
	attemptNumber: z.number().int().positive(),
	beadsDb: z.string(),
	bucket: z.string(),
	createdAt: z.string(),
	cwd: z.string(),
	directory: z.string(),
	formula: formulaSchema,
	id: z.string(),
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
// eslint-disable-next-line max-statements, max-params -- Keep eligibility and immutable snapshot creation before any process side effect.
export async function prepareLaunch(
	request: LaunchRequest,
	formulas: Record<string, Formula>,
	attemptId: string,
	attemptNumber = FIRST_ATTEMPT,
	// eslint-disable-next-line unicorn/no-null -- Manual launches have no daemon policy revision.
	policyRevisionId: string | null = null,
): Promise<Preparation> {
	const spawn = await showBead(request, "colony", request.id);
	if (spawn.status !== "open") {
		throw new Error(`Request ${spawn.id} is ${spawn.status}, expected open`);
	}
	const { recipe, identity, taskIds } = readSpawnRequest(spawn);
	const tasks = await Promise.all(taskIds.map((id) => showBead(request, identity, id)));
	const ready = z
		.array(beadSchema.pick({ id: true }))
		.parse(await beads(request, identity, ["ready", "--brief", "--limit", "0"]));
	const eligible = eligibility(tasks, ready, identity);
	if (eligible.kind !== "eligible") {
		return eligible;
	}
	const formula = formulas[recipe.harness];
	if (!formula) {
		throw new Error(`No formula named ${recipe.harness}`);
	}
	const prompt = [
		recipe.prompt,
		`Read the full instructions and acceptance criteria on the related task beads. They define the assignment and completion requirements.\n\nRelated tasks: ${taskIds.join(", ")}`,
	]
		.filter(Boolean)
		.join("\n\n");
	const invocation = renderFormula(formula, { ...recipe, prompt }, "headless");
	let executionDirectory = request.root;
	if (recipe.cwd !== null) {
		executionDirectory = resolvePath(request.root, recipe.cwd);
	}
	const cwd = await realpath(executionDirectory);
	return {
		kind: "prepared",
		receipt: {
			attemptNumber,
			beadsDb: request.beadsDb,
			bucket: await launchBucket(cwd),
			createdAt: new Date().toISOString(),
			cwd,
			directory: join(resolvePath(request.state), attemptId),
			formula,
			id: attemptId,
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
		const child = spawnSupervisor(
			process.execPath,
			[
				resolvePath(import.meta.dirname, "../bin/worker.ts"),
				join(receipt.directory, "receipt.json"),
				state,
			],
			{
				cwd: receipt.cwd,
				detached: true,
				env: { ...process.env, BEADS_DB: receipt.beadsDb },
				stdio: ["ignore", log.fd, log.fd],
			},
		);
		// eslint-disable-next-line promise/avoid-new -- Adapt Node subprocess spawn/error events to the reservation handoff.
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
