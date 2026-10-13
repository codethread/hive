import type { AttemptDetails, ColonyInspection, RepositoryEndpoint } from "@hive/shared";
import type { AttemptInventory, Store } from "./store.ts";
/* eslint-disable-next-line import/no-nodejs-modules --
 * Inspection returns owned artifact locations without reading log contents.
 */
import { join } from "node:path";

/** Inspect retained daemon evidence without registering a repository or reconciling its tracker. */
export function inspectRepository(
	repository: RepositoryEndpoint,
	store: Store,
): Omit<ColonyInspection, "colony"> {
	store.assertRepository(repository);
	const inventory = store.retainedInventory(repository.root);
	return {
		attempts: inventory.map((attempt) => attemptDetails(attempt)),
		history: store.policyHistory(repository.root),
		kind: "inspection",
		observedAt: new Date().toISOString(),
		repository,
		requests: store.requests(repository.root).map(({ id, state, context }) => ({
			attemptId: context.attemptId,
			attempts: context.attempts,
			id,
			identity: context.identity,
			message: context.message,
			outcome: context.outcome,
			retryAt: context.retryAt,
			state,
			taskIds: context.taskIds,
		})),
	};
}

// --- Private functions ---
function attemptDetails({ id, spawnId, state, receipt }: AttemptInventory): AttemptDetails {
	return {
		attemptNumber: receipt.attemptNumber,
		bucket: receipt.bucket,
		createdAt: receipt.createdAt,
		cwd: receipt.cwd,
		harness: receipt.recipe.harness,
		id,
		identity: receipt.identity,
		kind: receipt.recipe.kind,
		model: receipt.recipe.model,
		paths: {
			receipt: join(receipt.directory, "receipt.json"),
			stderr: join(receipt.directory, "stderr.log"),
			stdout: join(receipt.directory, "stdout.log"),
			supervisor: join(receipt.directory, "supervisor.log"),
			worker: join(receipt.directory, "worker.json"),
		},
		policyRevisionId: receipt.policyRevisionId,
		spawnId,
		state,
		taskIds: receipt.taskIds,
	};
}
