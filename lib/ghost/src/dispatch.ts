import type { BeesConfig, RepositoryEndpoint } from "@hive/shared";
import type { LaunchReceipt, Preparation } from "./launch.ts";
import { SPAWN_REQUEST_LABELS, beadSchema, beads, showBead } from "@hive/shared";
import { assertRequestAuthority, claimRequest, newRequest, reconcileRequests } from "./request.ts";
import { compareCandidates, hasCapacity } from "./scheduler.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Locate the worker entry and its owned receipt.
import { join, resolve as resolvePath } from "node:path";
import { prepareLaunch, writeReceipt } from "./launch.ts";
import type { Occupant } from "./scheduler.ts";
import type { RequestRecord } from "./request.ts";
import type { Store } from "./store.ts";
import { match } from "ts-pattern";
// eslint-disable-next-line import/no-nodejs-modules -- Supervisor startup errors have an owned log.
import { open } from "node:fs/promises";
import { pageRanks } from "./ranking.ts";
// eslint-disable-next-line import/max-dependencies -- Dispatch publishes native observations after its lifecycle effects.
import { publishObservation } from "./observations.ts";
// eslint-disable-next-line import/max-dependencies -- Dispatch completes the verified execution handoff.
import { resumeExecution } from "./processes.ts";
// eslint-disable-next-line import/no-nodejs-modules, import/max-dependencies -- Dispatch owns the detached supervisor handoff.
import { spawn } from "node:child_process";
// eslint-disable-next-line import/max-dependencies -- Dispatch composes tracker, ranking, inventory and subprocess boundaries.
import { z } from "zod";

const EMPTY = 0;
const NEXT = 1;
const requestListSchema = z.object({ issues: z.array(beadSchema) });
export interface DispatchInput {
	/** Canonical repository and explicit tracker authority. */
	repository: RepositoryEndpoint;
	/** Private daemon state directory. */
	state: string;
	/** Concrete durable reservation owner. */
	store: Store;
}

interface Candidate extends Extract<Preparation, { kind: "prepared" }> {
	/** Captured request authority used when acquiring this candidate. */
	record: RequestRecord;
}

/** Complete one serial pass; callers drain it before acknowledging sleep or replacing policy. */
export async function dispatch(
	input: DispatchInput,
	config: BeesConfig,
	revisionId: string,
): Promise<void> {
	const candidates = await prepareCandidates(input, config, revisionId);
	if (candidates.length === EMPTY) {
		return;
	}
	const ranked = await rankCandidates(input, config, candidates);
	await launchCandidates(input, config, ranked);
}

// --- Private functions ---
// eslint-disable-next-line max-statements -- Keep request hydration, preparation and durable waiting or settlement decisions together.
async function prepareCandidates(
	input: DispatchInput,
	config: BeesConfig,
	revisionId: string,
): Promise<Candidate[]> {
	const { repository, state, store } = input;
	await reconcileRequests({ config, repository, store });
	const { issues } = requestListSchema.parse(
		await beads(repository, "colony", [
			"list",
			"--status",
			"open",
			...SPAWN_REQUEST_LABELS.flatMap((label) => ["--label", label]),
			"--limit",
			"0",
		]),
	);
	const candidates: Candidate[] = [];
	const records = new Map(store.requests(repository.root).map((record) => [record.id, record]));
	for (const request of issues) {
		let record = records.get(request.id);
		if (!record) {
			// eslint-disable-next-line no-await-in-loop -- Hydrate complete related-task authority once when registering a request.
			record = newRequest(await showBead(repository, "colony", request.id), repository);
			store.saveRequest(repository.root, record);
			records.set(request.id, record);
		}
		if (record.state === "waiting") {
			const id = crypto.randomUUID();
			// eslint-disable-next-line no-await-in-loop -- Keep tracker decisions and reservations ordered within the bounded pass.
			const prepared = await prepareLaunch(
				{ ...repository, id: request.id, state },
				config.formulas,
				id,
				record.context.attempts + NEXT,
				revisionId,
			);
			// eslint-disable-next-line no-await-in-loop -- Keep tracker decisions and reservations ordered within the bounded pass.
			await match(prepared)
				.with({ kind: "waiting" }, async ({ reason }) => {
					store.advanceRequest(repository.root, record, { message: reason, type: "WAIT" });
					await publishObservation(repository, record.id, `waiting: ${reason}`);
				})
				.with({ kind: "finished" }, async () => {
					store.advanceRequest(repository.root, record, {
						message: "All related tasks are closed",
						outcome: "completed",
						type: "SETTLE",
					});
					await reconcileRequests({ config, repository, store });
				})
				.with({ kind: "prepared" }, (candidate) => {
					assertRequestAuthority(record, candidate.receipt.identity, candidate.receipt.taskIds);
					candidates.push({ ...candidate, record });
				})
				.exhaustive();
		}
	}
	return candidates;
}

async function rankCandidates(
	{ repository, state }: DispatchInput,
	config: BeesConfig,
	candidates: Candidate[],
): Promise<Candidate[]> {
	let scores: Record<string, number> = {};
	if (config.ranking === "bv-pagerank") {
		scores = await pageRanks(
			repository,
			state,
			candidates.flatMap(({ scheduling }) => scheduling.taskIds),
		);
	}
	return candidates
		.map((candidate) => {
			let score = 0;
			if (config.ranking === "bv-pagerank") {
				score = Math.max(...candidate.scheduling.taskIds.map((id) => scores[id]!));
			}
			return {
				candidate,
				order: { ...candidate.scheduling, id: candidate.receipt.spawnId, score },
			};
		})
		.toSorted((left, right) => compareCandidates(left.order, right.order))
		.map(({ candidate }) => candidate);
}

// eslint-disable-next-line max-statements -- Capacity, claims, durable reservation and verified supervisor permission form one ordered handoff.
async function launchCandidates(
	{ repository, state, store }: DispatchInput,
	config: BeesConfig,
	candidates: Candidate[],
): Promise<void> {
	const inventory = await store.inventory(repository.root);
	const occupied: Occupant[] = inventory
		.filter(({ state: attemptState }) => attemptState === "starting" || attemptState === "running")
		.map(({ receipt }) => ({ bucket: receipt.bucket, kind: receipt.recipe.kind }));
	for (const { receipt, record } of candidates) {
		const occupant = { bucket: receipt.bucket, kind: receipt.recipe.kind };
		if (hasCapacity(occupant, occupied, config.limits)) {
			// eslint-disable-next-line no-await-in-loop -- Capacity precedes acquisition and process reservation.
			const claimed = await claimRequest({ config, repository, store }, record);
			if (claimed !== null) {
				store.reserve(repository.root, receipt, claimed);
				occupied.push(occupant);
				// eslint-disable-next-line no-await-in-loop -- Keep tracker decisions and reservations ordered within the bounded pass.
				await writeReceipt(receipt);
				// eslint-disable-next-line no-await-in-loop -- Keep tracker decisions and reservations ordered within the bounded pass.
				const pid = await startSupervisor(receipt, state);
				// eslint-disable-next-line no-await-in-loop -- Persist the matching supervisor before publishing launch permission.
				await resumeExecution(receipt, (supervisor) => {
					if (supervisor.pid !== pid) {
						throw new Error("Supervisor handoff does not match the launched child");
					}
					store.supervisor(receipt.id, pid);
				});
				// eslint-disable-next-line no-await-in-loop -- Report a durable launch without interrupting its reservation handoff.
				await publishObservation(
					repository,
					record.id,
					`starting: attempt ${receipt.attemptNumber}`,
				);
			}
		} else {
			// eslint-disable-next-line no-await-in-loop -- Keep capacity observations ordered with reservations in this pass.
			await publishObservation(repository, record.id, "waiting: capacity unavailable");
		}
	}
}

async function startSupervisor(receipt: LaunchReceipt, state: string): Promise<number> {
	const log = await open(join(receipt.directory, "supervisor.log"), "a");
	try {
		const child = spawn(
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
				child.unref();
				resolve(pid);
			});
		});
	} finally {
		await log.close();
	}
}
