/* eslint-disable import/max-dependencies -- Reconcile request authority with memory Beads and private SQLite. */
/* eslint-disable unicorn/no-null -- Request receipts preserve absent policy revisions explicitly. */
import { afterAll, expect, test } from "bun:test";
import { claimRequest, newRequest, reconcileRequests } from "./request.ts";
import { createSpawn, createTask, memoryTracker } from "./tracker.test-support.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Prepare and clean state directories outside behavior timing.
import { mkdtemp, rm } from "node:fs/promises";
import type { Store } from "./store.ts";
import { beesConfigSchema } from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Use the established disposable private SQLite fixture boundary.
import { join } from "node:path";
import { openStore } from "./store.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Locate disposable state, never the running Colony's database.
import { tmpdir } from "node:os";
import { trackerScope } from "./tracker.ts";

const state = await mkdtemp(join(tmpdir(), "colony-request-authority-"));
const store = openStore(state);
const config = beesConfigSchema.parse({ formulas: {}, humans: ["ct"], owner: "ct" });
// Operation evidence is orthogonal to authority; mirror claims.test.ts's no-op evidence.
const history: Store["history"] = {
	run: (_input, action) =>
		action({
			completed: () => {},
			failed: () => {},
			reference: () => {},
			step: () => {},
		}),
};
afterAll(async () => {
	store.close();
	await rm(state, { force: true, recursive: true });
});

test.each(["acquisition", "unlaunched"])(
	"%s rejects an unclassified anchor without request success",
	/* eslint-disable-next-line max-statements --
	 * Preserve the unchanged native request and checkpoint on diagnostic failure.
	 */
	async (path) => {
		const tracker = memoryTracker();
		tracker.repository = { ...tracker.repository, root: `/fixture/legacy-${path}` };
		const taskId = await createTask(tracker, { status: "closed" });
		const id = await createSpawn(tracker, taskId);
		const scope = trackerScope(tracker.repository, "worker");
		const record = newRequest(await tracker.beads.show(scope, id), tracker.repository);
		store.saveRequest(tracker.repository.root, record);
		const runtime = {
			...tracker,
			config,
			store: { ...store, history, inventory: () => Promise.resolve([]) },
		};
		const operation = () => {
			if (path === "acquisition") {
				return claimRequest(runtime, record);
			}
			return reconcileRequests(runtime);
		};
		await expect(operation()).rejects.toBeInstanceOf(Error);
		expect(await tracker.beads.show(scope, id)).toMatchObject({ status: "open" });
		expect(store.requests(tracker.repository.root)).toEqual([record]);
	},
);
