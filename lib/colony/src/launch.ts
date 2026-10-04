import type { Bead, Formula, RepositoryEndpoint } from "@hive/shared";
import {
	beadSchema,
	beads,
	formulaSchema,
	parseBeesConfig,
	readSpawnRequest,
	recipeSchema,
	renderFormula,
	showBead,
} from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve owned receipt and execution directories.
import { join, resolve } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Own process log files and canonicalize launch cwd.
import { mkdir, open, realpath, rename } from "node:fs/promises";
import { match } from "ts-pattern";
import { runOwnedExecution } from "./processes.ts";
import { z } from "zod";

const EMPTY = 0;
const SUCCESS = 0;
const JSON_INDENT = 2;
const FIRST_ATTEMPT = 1;
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
	invocation: formulaSchema,
	policyRevisionId: z.string().nullable(),
	recipe: recipeSchema,
	spawnId: z.string(),
	taskIds: z.array(z.string()),
	token: z.string(),
});
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
	const config = parseBeesConfig(await Bun.file(join(request.root, "bees.toml")).text());
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
		.array(beadSchema)
		.parse(await beads(request, identity, ["ready", "--limit", "0"]));
	const eligible = eligibility(tasks, ready, identity);
	if (eligible.kind !== "eligible") {
		return eligible;
	}
	const formula = formulas[recipe.harness];
	if (!formula) {
		throw new Error(`No formula named ${recipe.harness}`);
	}
	const invocation = renderFormula(formula, recipe);
	let executionDirectory = request.root;
	if (recipe.cwd !== null) {
		executionDirectory = resolve(request.root, recipe.cwd);
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
			directory: join(resolve(request.state), attemptId),
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
export async function executeWorker(receipt: LaunchReceipt, state: string): Promise<Outcome> {
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
						BD_ACTOR: identity,
						BEADS_DB: beadsDb,
						BR_AGENT_NAME: recipe.kind,
						BR_HARNESS: recipe.harness,
						BR_MODEL: recipe.model,
						HIVE_AGENT_NAME: identity,
						HIVE_ATTEMPT_ID: receipt.id,
						HIVE_ATTEMPT_NUMBER: String(receipt.attemptNumber),
						HIVE_ATTEMPT_TOKEN: token,
						HIVE_COLONY_STATE: resolve(state),
						HIVE_SPAWN_ID: spawnId,
					},
					stderr: stderr.fd,
					stdout: stdout.fd,
				}),
			(harnessPid) => writeWorkerReceipt(directory, { ...ownership, harnessPid, kind: "running" }),
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

// --- Private functions ---
async function launchBucket(cwd: string): Promise<string> {
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

async function writeWorkerReceipt(
	directory: string,
	receipt: z.infer<typeof workerReceiptSchema>,
): Promise<void> {
	const temporary = join(directory, "worker.json.tmp");
	await Bun.write(temporary, JSON.stringify(receipt, undefined, JSON_INDENT));
	await rename(temporary, join(directory, "worker.json"));
}
function eligibility(tasks: Bead[], ready: Bead[], identity: string): Eligibility {
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
