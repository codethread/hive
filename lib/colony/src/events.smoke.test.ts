/* eslint-disable max-statements -- Keep real socket/SQLite scenario setup, assertions and teardown together. */
/* eslint-disable import/max-dependencies -- Exercise the journal, public SDK and authored example through their real interfaces. */
/* eslint-disable unicorn/no-null -- Match the established durable request checkpoint fixture. */
import { COLONY_EVENT_RETENTION, openEventJournal } from "./events.ts";
import type { ColonyEventCursor, ColonyEventMessage } from "@hive/shared/colony-events";
import { ColonyEventStreamError, colonyEventSubscriptionSchema } from "@hive/shared/colony-events";
import { ColonyListener, subscribeColonyEvents } from "@hive/shared/colony-events/client";
import { expect, test } from "bun:test";
import { fileCheckpoint, listListenerSpikes, runListenerSpike } from "./listener-spike.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Real disposable SQLite/socket and evidence files match the existing integration harness.
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { Database } from "bun:sqlite";
import type { RepositoryEndpoint } from "@hive/shared";
import type { Store } from "./store.ts";
import { createListener as intakeListener } from "../../../.hive/listeners/assessment-intake/listener.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Keep all test state under one disposable directory.
import { join } from "node:path";
import { openStore } from "./store.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Use the operating system's temporary root.
import { tmpdir } from "node:os";

const FIRST = 0;
const ONE = 1;
const TWO = 2;
const TIMEOUT = 10_000;
const first = { root: "/fixture/first", beadsDb: "/fixture/first.db" };
const second = { root: "/fixture/second", beadsDb: "/fixture/second.db" };
const checkout = new URL("../../../", import.meta.url).pathname;

test(
	"live subscriptions filter exact colony pairs and replay from a durable cursor after reopening",
	async () => {
		await fixture(async ({ state, socket, store }) => {
			const stream = subscribeColonyEvents({
				state,
				socket,
				subscription: {
					colonies: [first, second],
					types: ["request.settled"],
					start: { kind: "live" },
				},
			});
			const baseline = await stream.next();
			expect(baseline.value).toMatchObject({ kind: "checkpoint", cursor: { sequence: FIRST } });
			settle(store, { ...first, beadsDb: "/different.db" }, "unselected");
			settle(store, first, "shared-id");
			settle(store, second, "shared-id");
			const eventA = await nextEvent(stream);
			const eventB = await nextEvent(stream);
			expect([eventA.repository, eventB.repository]).toEqual([first, second]);
			expect(eventB.cursor.sequence).toBeGreaterThan(eventA.cursor.sequence);
			// eslint-disable-next-line unicorn/no-useless-undefined -- AsyncGenerator.return requires its explicit return value.
			await stream.return(undefined);
			store.close();
			const reopened = openStore(state);
			try {
				const response = reopened.events.stream(
					{
						colonies: [first, second],
						types: ["request.settled"],
						start: { kind: "after", cursor: eventA.cursor },
					},
					new AbortController().signal,
				);
				const reader = response.body!.getReader();
				await reader.read();
				const chunk = await reader.read();
				const page = new TextDecoder().decode(chunk.value);
				expect(page).toContain(JSON.stringify(eventB));
				expect(page).not.toContain(JSON.stringify(eventA));
				await reader.cancel();
				expect(() =>
					reopened.events.stream(
						{
							colonies: [first],
							types: ["request.settled"],
							start: { kind: "after", cursor: { ...eventA.cursor, logId: crypto.randomUUID() } },
						},
						new AbortController().signal,
					),
				).toThrow(ColonyEventStreamError);
			} finally {
				reopened.close();
			}
		});
	},
	TIMEOUT,
);

test(
	"async handlers finish before checkpointing and failed effects replay on restart",
	async () => {
		await fixture(async ({ state, socket, store }) => {
			const progress: { saved?: ColonyEventCursor } = {};
			const ready = Promise.withResolvers<void>();
			const entered = Promise.withResolvers<void>();
			const release = Promise.withResolvers<void>();
			const checkpoint = {
				load: () => Promise.resolve(progress.saved),
				save: (cursor: ColonyEventCursor) => {
					progress.saved = cursor;
					ready.resolve();
					return Promise.resolve();
				},
			};
			const options = {
				state,
				socket,
				colonies: [first],
				start: { kind: "live" as const },
				checkpoint,
			};
			const failure = new Error("fixture handler failed");
			const firstRun = new ColonyListener(options)
				.on("request.settled", async () => {
					entered.resolve();
					await release.promise;
					throw failure;
				})
				.run();
			const rejected = firstRun.catch((error: unknown) => error);
			await ready.promise;

			settle(store, first, "to-replay");
			await entered.promise;

			expect(progress.saved?.sequence).toBe(FIRST);
			release.resolve();
			expect(await rejected).toBe(failure);

			const finished = Promise.withResolvers<void>();
			const effects: string[] = [];
			const secondRun = new ColonyListener({
				...options,
				checkpoint: {
					...checkpoint,
					save: async (cursor) => {
						await checkpoint.save(cursor);
						if (cursor.sequence > FIRST) {
							finished.resolve();
						}
					},
				},
			})
				.on("request.settled", (event) => {
					effects.push(event.request.id);
				})
				.run();
			await finished.promise;

			expect(progress.saved?.sequence).toBe(ONE);
			expect(effects).toEqual(["to-replay"]);
			store.events.close();
			await secondRun;
		});
	},
	TIMEOUT,
);

test(
	"named listener discovery and the external intake consumer use public event data",
	async () => {
		await fixture(async ({ state, socket, store, root }) => {
			const catalogue = await listListenerSpikes(checkout);
			expect(catalogue.map(({ name }) => name).toSorted()).toEqual([
				"assessment-intake",
				"settlement-log",
			]);
			const outputDirectory = join(root, "intake");
			const checkpointFile = join(root, "listener.json");
			const collected = Promise.withResolvers<void>();
			const progress: { saved?: ColonyEventCursor } = {};
			const intake = intakeListener(
				{
					state,
					socket,
					colonies: [first],
					start: { kind: "retained" },
					checkpoint: {
						// eslint-disable-next-line unicorn/no-useless-undefined -- A new consumer has no saved cursor.
						load: () => Promise.resolve<ColonyEventCursor | undefined>(undefined),
						save: (cursor) => {
							progress.saved = cursor;
							if (cursor.sequence > FIRST) {
								collected.resolve();
							}
							return Promise.resolve();
						},
					},
				},
				{ outputDirectory },
			);
			settle(store, first, "evidence");
			const running = intake.run();
			await collected.promise;
			store.events.close();
			await running;
			const artifacts = await readdir(outputDirectory);
			expect(artifacts).toHaveLength(ONE);
			expect(await Bun.file(join(outputDirectory, artifacts[FIRST]!)).json()).toMatchObject({
				event: { request: { id: "evidence" }, repository: first },
				attempts: [],
			});
			const checkpoint = fileCheckpoint(checkpointFile, "fixture");
			await checkpoint.save(progress.saved!);
			expect(await checkpoint.load()).toEqual(progress.saved);
			await expect(
				fileCheckpoint(checkpointFile, "changed-selection").load(),
			).rejects.toBeInstanceOf(Error);
			// The real named runner imports the same example; a deliberately mismatched checkpoint fails before subscribing.
			await expect(
				runListenerSpike(
					checkout,
					"assessment-intake",
					{
						state,
						socket,
						colonies: [first],
						start: { kind: "retained" },
						checkpointFile,
						outputDirectory,
					},
					new AbortController().signal,
				),
			).rejects.toBeInstanceOf(Error);
		});
	},
	TIMEOUT,
);

test(
	"duplicate settlement and failed transactions do not publish another committed fact",
	async () => {
		await fixture(({ store, state }) => {
			settle(store, first, "once");
			const original = store.events.cursor();
			settle(store, first, "once");
			expect(store.events.cursor()).toEqual(original);
			expect(store.requests(first.root)).toHaveLength(ONE);
			settle(store, first, "twice");
			expect(store.requests(first.root)).toHaveLength(TWO);
			const database = new Database(join(state, "colony.sqlite"));
			database.exec(
				"CREATE TRIGGER fail_event BEFORE INSERT ON colony_events WHEN new.request_id = 'broken' BEGIN SELECT RAISE(ABORT, 'fixture publication failure'); END",
			);
			database.close();
			const beforeFailure = store.events.cursor();
			expect(() => settle(store, first, "broken")).toThrow(Error);
			expect(store.requests(first.root)).toHaveLength(TWO);
			expect(store.events.cursor()).toEqual(beforeFailure);
			return Promise.resolve();
		});
	},
	TIMEOUT,
);

test("retention expires idle readers explicitly and keeps the retained replay boundary", async () => {
	const database = new Database(":memory:");
	const journal = openEventJournal(database);
	const cursor = journal.cursor();
	const subscription = {
		colonies: [first],
		types: ["request.settled" as const],
		start: { kind: "after" as const, cursor },
	};
	const reader = journal.stream(subscription, new AbortController().signal).body!.getReader();
	try {
		// Leave the initial checkpoint unread while the producer passes the retention horizon.
		database.transaction(() => {
			for (let index = FIRST; index <= COLONY_EVENT_RETENTION; index += ONE) {
				journal.append({
					type: "request.settled",
					repository: first,
					recordedAt: "2026-10-09T00:00:00.000Z",
					request: {
						id: `event-${index}`,
						identity: "fixture",
						outcome: "completed",
						taskIds: [],
						attempts: [],
					},
				});
			}
		})();
		journal.notify();
		await reader.read();
		const failure = await reader.read();
		expect(new TextDecoder().decode(failure.value)).toContain('"code":"cursor_expired"');
		const ended = await reader.read();
		expect(ended.done).toBe(true);
		expect(() => journal.stream(subscription, new AbortController().signal)).toThrow(
			ColonyEventStreamError,
		);
		const retained = journal
			.stream({ ...subscription, start: { kind: "retained" } }, new AbortController().signal)
			.body!.getReader();
		const baseline = await retained.read();
		expect(new TextDecoder().decode(baseline.value)).toContain('"sequence":1');
		const page = await retained.read();
		expect(new TextDecoder().decode(page.value)).toContain('"id":"event-1"');
		expect(new TextDecoder().decode(page.value)).not.toContain('"id":"event-0"');
		await retained.cancel();
	} finally {
		await reader.cancel();
		journal.close();
		database.close();
	}
});

// --- Private functions ---
function settle(store: Store, repository: RepositoryEndpoint, id: string): void {
	store.settleRequest(
		repository.root,
		{
			beadsDb: repository.beadsDb,
			id,
			state: "terminal",
			context: {
				attemptId: null,
				attempts: FIRST,
				claims: [],
				identity: "fixture-bee",
				message: "private context",
				outcome: "completed",
				pendingClaim: null,
				retryAt: null,
				taskIds: ["task-1"],
			},
		},
		undefined,
	);
}

async function nextEvent(stream: AsyncGenerator<ColonyEventMessage>) {
	let result = await stream.next();
	while (!result.done) {
		if (result.value.kind === "event") {
			return result.value.event;
		}
		// eslint-disable-next-line no-await-in-loop -- Consume ordered protocol checkpoints before the next domain event.
		result = await stream.next();
	}
	throw new Error("Event stream ended before the expected event");
}

async function fixture(
	run: (input: { root: string; state: string; socket: string; store: Store }) => Promise<void>,
): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), "colony-event-spike-"));
	const state = join(root, "state");
	const socket = join(root, "events.sock");
	await mkdir(state);
	const store = openStore(state);
	const server = Bun.serve({
		unix: socket,
		async fetch(request, serving) {
			serving.timeout(request, FIRST);
			return store.events.stream(
				colonyEventSubscriptionSchema.parse(await request.json()),
				request.signal,
			);
		},
	});
	try {
		await run({ root, state, socket, store });
	} finally {
		store.close();
		await server.stop(true);
		await rm(root, { recursive: true, force: true });
	}
}
