/* eslint-disable unicorn/no-null -- Unknown checkpoint fields are explicit in durable history. */
import { expect, test } from "bun:test";
// eslint-disable-next-line import/no-nodejs-modules -- Exercise the real private SQLite boundary in disposable directories.
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { CommandError } from "@hive/beads";
import type { RequestRecord } from "./request.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Locate disposable database and module paths.
import { join } from "node:path";
import { openStore } from "./store.ts";
import { readHistory } from "./history.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Match neighboring SQLite integration fixtures.
import { tmpdir } from "node:os";

const FIRST = 0;
const ONE = 1;
const EXIT_FAILURE = 6;
const repository = { beadsDb: "/fixture/beads.db", root: "/fixture" };
const request: RequestRecord = {
	beadsDb: repository.beadsDb,
	host: "fixture-host",
	context: {
		attemptId: null,
		attempts: 0,
		claims: [],
		identity: "fixture-worker",
		message: "PRIVATE PROMPT must never enter history",
		outcome: null,
		pendingClaim: null,
		retryAt: null,
		taskIds: ["task-a", "task-b"],
	},
	id: "spawn-a",
	state: "waiting",
};

// eslint-disable-next-line max-statements -- Exercise one failed operation and verify offline reads preserve its private database.
test("history retains native failure and confirmed partial effects without mutating inspected state", async () => {
	const state = await mkdtemp(join(tmpdir(), "colony-history-"));
	const store = openStore(state);
	try {
		store.saveRequest(repository.root, request);
		const error = new CommandError("br update", {
			code: EXIT_FAILURE,
			stderr: "UNRELATED RAW OUTPUT",
			stdout: JSON.stringify({
				error: {
					code: "SYNC_CONFLICT",
					message:
						"Tracker failed token=secret-value Bearer hidden-value access_token=access-value client_secret=client-value DB_PASSWORD=db-value HIVE_ATTEMPT_TOKEN=attempt-value",
				},
			}),
		});
		await expect(
			store.history.run(
				{
					checkpoint: () => store.requests(repository.root)[FIRST],
					operation: "claim",
					repository,
					requestId: request.id,
				},
				(evidence) => {
					let record = store.advanceRequest(repository.root, request, { type: "READY" });
					evidence.step("tracker.claim", "task-a");
					record = store.advanceRequest(repository.root, record, {
						id: "task-a",
						type: "ACQUIRED",
					});
					evidence.completed("tracker.claimed", "task-a");
					store.advanceRequest(repository.root, record, { id: "task-b", type: "INTEND" });
					evidence.step("tracker.claim", "task-b");
					evidence.reference("/fixture/attempt/receipt.json");
					return Promise.reject(error);
				},
			),
		).rejects.toBe(error);
		store.close();
		const before = await files(state);
		const result = readHistory(state, { failures: true, repository, request: request.id });
		expect(result.events).toHaveLength(ONE);
		expect(result.events[FIRST]).toMatchObject({
			after: { claims: ["task-a"], pendingClaim: "task-b", state: "claiming" },
			before: { claims: [], pendingClaim: null, state: "waiting" },
			completedEffects: [{ operation: "tracker.claimed", target: "task-a" }],
			failure: {
				code: "SYNC_CONFLICT",
				exitCode: EXIT_FAILURE,
				message:
					"Tracker failed token=[redacted] Bearer [redacted] access_token=[redacted] client_secret=[redacted] DB_PASSWORD=[redacted] HIVE_ATTEMPT_TOKEN=[redacted]",
				step: { operation: "tracker.claim", target: "task-b" },
			},
			status: "failed",
		});
		expect(JSON.stringify(result)).not.toMatch(
			/secret-value|hidden-value|access-value|client-value|db-value|attempt-value|PRIVATE PROMPT|UNRELATED RAW OUTPUT/u,
		);
		expect(readHistory(state, { failures: false, repository, request: "other" }).events).toEqual(
			[],
		);
		expect(
			readHistory(state, { failures: false, repository: { ...repository, beadsDb: "/other.db" } })
				.events,
		).toEqual([]);
		expect(await files(state)).toEqual(before);
	} finally {
		store.close();
		await rm(state, { force: true, recursive: true });
	}
});

async function files(state: string): Promise<unknown> {
	const names = await readdir(state);
	return Promise.all(
		names
			.filter((name) => !name.endsWith("-shm"))
			.toSorted()
			.map(async (name) => ({
				hash: Bun.hash(await Bun.file(join(state, name)).arrayBuffer()).toString(),
				name,
			})),
	);
}
