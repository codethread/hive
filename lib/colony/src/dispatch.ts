/* eslint-disable import/max-dependencies -- Compose existing runtime boundaries with the independent advisory assessment lifecycle. */
import type { BeesConfig, RepositoryEndpoint } from "@hive/shared";
import { SPAWN_REQUEST_LABELS, beadSchema, beads } from "@hive/shared";
import { assertRequestAuthority, claimRequest, newRequest, reconcileRequests } from "./request.ts";
import { compareCandidates, hasCapacity, hasContention } from "./scheduler.ts";
import { prepareLaunch, startSupervisor, writeReceipt } from "./launch.ts";
import { publishObservation, publishStdoutActivity } from "./observations.ts";
import { publishRequestLabels, reconcileClosedRequestLabels } from "./requests.ts";
import type { Occupant } from "./scheduler.ts";
import type { OperationEvidence } from "./history.ts";
import type { Preparation } from "./launch.ts";
import type { RequestRecord } from "./request.ts";
import type { Store } from "./store.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Reference the existing daemon log in operation history.
import { join } from "node:path";
import { match } from "ts-pattern";
// eslint-disable-next-line import/max-dependencies -- Dispatch ranks admitted candidates after preparation.
import { pageRanks } from "./ranking.ts";
import { reconcileAssessments } from "./postrun.ts";
// eslint-disable-next-line import/max-dependencies -- Dispatch completes the verified execution handoff.
import { resumeExecution } from "./processes.ts";
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
	await input.store.history.run(
		{
			operation: "dispatch",
			repository: input.repository,
			// eslint-disable-next-line unicorn/no-null -- Repository-wide dispatch has no single request checkpoint.
			requestId: null,
		},
		async (evidence) => {
			evidence.reference(join(input.state, "daemon.log"));
			evidence.step("dispatch.prepare", input.repository.root);
			const candidates = await prepareCandidates(input, config, revisionId, evidence);
			await reconcileAssessments({ ...input, config });
			if (candidates.length === EMPTY) {
				return;
			}
			await dispatchPriorityGroups(input, config, candidates, evidence);
		},
	);
}

// --- Private functions ---
// eslint-disable-next-line max-statements, max-params -- Keep request hydration, preparation and durable waiting or settlement decisions together.
async function prepareCandidates(
	input: DispatchInput,
	config: BeesConfig,
	revisionId: string,
	evidence: OperationEvidence,
): Promise<Candidate[]> {
	const { repository, state, store } = input;
	evidence.step("requests.reconcile", repository.root);
	await reconcileRequests({ config, repository, store });
	evidence.step("labels.reconcile-closed", repository.root);
	await reconcileClosedRequestLabels(repository);
	evidence.step("tracker.list", repository.root);
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
		// eslint-disable-next-line no-await-in-loop -- Retain each request's preparation boundary independently.
		await store.history.run(
			{
				checkpoint: () => store.requests(repository.root).find(({ id }) => id === request.id),
				operation: "prepare",
				repository,
				requestId: request.id,
			},
			// eslint-disable-next-line max-statements -- Preparation keeps hydration and the waiting or settlement checkpoint together.
			async (preparation) => {
				let record = records.get(request.id);
				if (!record) {
					preparation.step("labels.publish", request.id);
					record = newRequest(
						await publishRequestLabels(repository, "colony", request.id),
						repository,
					);
					store.saveRequest(repository.root, record);
					records.set(request.id, record);
				}
				if (record.state === "waiting") {
					const id = crypto.randomUUID();
					preparation.step("launch.prepare", request.id);
					const prepared = await prepareLaunch(
						{ ...repository, id: request.id, state },
						config.formulas,
						id,
						record.context.attempts + NEXT,
						revisionId,
					);
					await match(prepared)
						.with({ kind: "waiting" }, async ({ reason }) => {
							store.advanceRequest(repository.root, record, { message: reason, type: "WAIT" });
							preparation.step("observation.publish", record.id);
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
			},
		);
	}
	return candidates;
}

// eslint-disable-next-line max-params, max-statements -- One dispatch pass shares its current reservations and operation evidence.
async function dispatchPriorityGroups(
	input: DispatchInput,
	config: BeesConfig,
	candidates: Candidate[],
	evidence: OperationEvidence,
): Promise<void> {
	const inventory = await input.store.inventory(input.repository.root);
	const occupied: Occupant[] = inventory
		.filter(({ state }) => state === "starting" || state === "running")
		.map(({ receipt }) => ({ bucket: receipt.bucket, kind: receipt.recipe.kind }));
	const groups = Map.groupBy(candidates, ({ scheduling }) => scheduling.priority);
	for (const [, group] of [...groups].toSorted(([left], [right]) => left - right)) {
		const feasible = group.filter((candidate) =>
			hasCapacity(candidateOccupant(candidate), occupied, config.limits),
		);
		let ordered = orderCandidates(group, () => EMPTY);
		if (
			config.ranking === "bv-pagerank" &&
			hasContention(
				feasible.map((candidate) => candidateOccupant(candidate)),
				occupied,
				config.limits,
			)
		) {
			evidence.step("dispatch.rank", input.repository.root);
			// eslint-disable-next-line no-await-in-loop -- Lower priorities see actual reservations, including failed claims.
			ordered = await rankCandidates(input, feasible);
			ordered.push(...group.filter((candidate) => !feasible.includes(candidate)));
		}
		evidence.step("dispatch.launch", input.repository.root);
		// eslint-disable-next-line no-await-in-loop -- Finish higher-priority acquisition before testing the next group's contention.
		await launchCandidates(input, config, ordered, occupied);
	}
}

function candidateOccupant({ receipt }: Candidate): Occupant {
	return { bucket: receipt.bucket, kind: receipt.recipe.kind };
}

async function rankCandidates(
	{ repository, state }: DispatchInput,
	candidates: Candidate[],
): Promise<Candidate[]> {
	const scores = await pageRanks(
		repository,
		state,
		candidates.flatMap(({ scheduling }) => scheduling.taskIds),
	);
	return orderCandidates(candidates, ({ scheduling }) =>
		Math.max(...scheduling.taskIds.map((id) => scores[id]!)),
	);
}

function orderCandidates(
	candidates: Candidate[],
	score: (candidate: Candidate) => number,
): Candidate[] {
	return candidates
		.map((candidate) => ({
			candidate,
			order: { ...candidate.scheduling, id: candidate.receipt.spawnId, score: score(candidate) },
		}))
		.toSorted((left, right) => compareCandidates(left.order, right.order))
		.map(({ candidate }) => candidate);
}

// eslint-disable-next-line max-statements, max-params -- Capacity, claims, durable reservation and verified supervisor permission form one ordered handoff.
async function launchCandidates(
	{ repository, state, store }: DispatchInput,
	config: BeesConfig,
	candidates: Candidate[],
	occupied: Occupant[],
): Promise<void> {
	for (const { receipt, record } of candidates) {
		const occupant = { bucket: receipt.bucket, kind: receipt.recipe.kind };
		if (hasCapacity(occupant, occupied, config.limits)) {
			// eslint-disable-next-line no-await-in-loop -- Capacity precedes acquisition and process reservation.
			const claimed = await claimRequest({ config, repository, store }, record);
			if (claimed !== null) {
				// eslint-disable-next-line no-await-in-loop -- Complete each reserved launch before selecting the next candidate.
				await store.history.run(
					{
						checkpoint: () => store.requests(repository.root).find(({ id }) => id === record.id),
						operation: "launch",
						repository,
						requestId: record.id,
					},
					// eslint-disable-next-line max-statements -- Record the ordered reservation, supervisor and permission handoff.
					async (evidence) => {
						evidence.reference(receipt.directory);
						evidence.step("attempt.reserve", receipt.id);
						store.reserve(repository.root, receipt, claimed);
						evidence.completed("attempt.reserved", receipt.id);
						occupied.push(occupant);
						evidence.step("receipt.write", receipt.id);
						await writeReceipt(receipt);
						evidence.completed("receipt.written", receipt.id);
						evidence.step("stdout.publish", record.id);
						await publishStdoutActivity(repository, receipt);
						evidence.completed("stdout.published", record.id);
						evidence.step("supervisor.start", receipt.id);
						const pid = await startSupervisor(receipt, state);
						evidence.completed("supervisor.spawned", receipt.id);
						evidence.step("execution.resume", receipt.id);
						await resumeExecution(receipt, (supervisor) => {
							if (supervisor.pid !== pid) {
								throw new Error("Supervisor handoff does not match the launched child");
							}
							store.supervisor(receipt.id, pid);
							evidence.completed("supervisor.recorded", receipt.id);
						});
						evidence.step("observation.publish", record.id);
						await publishObservation(
							repository,
							record.id,
							`starting: attempt ${receipt.attemptNumber}`,
						);
						evidence.completed("observation.published", record.id);
					},
				);
			}
		} else {
			// eslint-disable-next-line no-await-in-loop -- Keep capacity observations ordered with reservations in this pass.
			await publishObservation(repository, record.id, "waiting: capacity unavailable");
		}
	}
}
