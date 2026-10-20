/* eslint-disable unicorn/no-null -- Retained request and receipt fixtures have explicit absent fields. */
/* eslint-disable import/max-dependencies -- Compose real retained fixtures with the injected actor clock and hints. */
/* eslint-disable max-statements -- Each scenario follows one continuous deadline, scan or drain lifetime. */
import { SimulatedClock, waitFor } from "xstate";
import { afterAll, expect, test } from "bun:test";
import { createSpawn, createTask, memoryTracker } from "./tracker.test-support.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Allocate one disposable backing store outside behavior timing.
import { mkdtemp, rm } from "node:fs/promises";
import type { AttemptInventory } from "./store.ts";
import type { ColonyHintEvent } from "./wake-hints.ts";
import type { RequestRecord } from "./request.ts";
import { beesConfigSchema } from "@hive/shared";
import { createColony } from "./colony.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve isolated fixture paths.
import { join } from "node:path";
import { newRequest } from "./request.ts";
import { openStore } from "./store.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Use temporary state, never the daemon's store.
import { tmpdir } from "node:os";
import { trackerScope } from "./tracker.ts";

const ZERO = 0;
const ONE = 1;
const TWO = 2;
const THREE = 3;
const FOUR = 4;
const SECOND = 1000;
const FIVE_SECONDS = 5000;
const SIXTY_SECONDS = 60_000;
const state = await mkdtemp(join(tmpdir(), "colony-cadence-"));
const store = openStore(state);
const tracker = memoryTracker();
const taskId = await createTask(tracker);
const spawnId = await createSpawn(tracker, taskId);
const saved = newRequest(
	await tracker.beads.show(trackerScope(tracker.repository, "worker"), spawnId),
	tracker.repository,
);
const config = beesConfigSchema.parse({ owner: "ct", humans: ["ct"], formulas: {} });
const activity = { state: "awake" as const, config, revisionId: "fixture-revision" };
const running: RequestRecord = {
	...saved,
	state: "executing",
	context: { ...saved.context, attemptId: "current", attempts: ONE },
};
const attempt: AttemptInventory = {
	id: "current",
	spawnId,
	state: "running",
	receipt: {
		assignment: saved.assignment,
		attemptNumber: ONE,
		beadsDb: tracker.repository.beadsDb,
		bucket: tracker.repository.root,
		createdAt: "2026-10-20T00:00:00.000Z",
		cwd: tracker.repository.root,
		directory: "/fixture/current",
		formula: { argv: [], executable: "fixture", headless: [] },
		host: saved.host,
		id: "current",
		identity: saved.context.identity,
		invocation: { argv: [], executable: "fixture" },
		policyRevisionId: null,
		recipe: {
			cwd: null,
			effort: "low",
			harness: "fixture",
			kind: "worker",
			model: "fixture",
			prompt: "",
			system_prompt: "",
		},
		spawnId,
		taskIds: [taskId],
		token: "fixture-token",
	},
};
const retainedCases = [
	{
		selection: "latest",
		root: "/fixture/retained-latest",
		expected: "latest-local-current",
	},
	{
		selection: "history",
		root: "/fixture/retained-history",
		expected: "history-local-history",
	},
];
for (const { selection, root, expected } of retainedCases) {
	for (const name of ["local", "foreign-request", "foreign-receipt", "terminal"]) {
		const id = `${selection}-${name}`;
		const record = { ...saved, id, state: "claiming" as const };
		let receipt = { ...attempt.receipt, id: `${id}-current`, spawnId: id };
		if (name === "local") {
			store.reserve(root, { ...receipt, id: `${id}-history` }, record);
		} else if (name === "foreign-request") {
			record.host = "foreign-host";
		} else if (name === "foreign-receipt") {
			receipt = { ...receipt, host: "foreign-host" };
		}
		const retained = store.reserve(root, receipt, record);
		if (name === "terminal") {
			store.saveRequest(root, { ...retained, state: "terminal" });
		}
	}
	store.currentAttempts(root);
	if (selection === "history") {
		const local = store.request(root, `${selection}-local`)!;
		store.saveRequest(root, {
			...local,
			context: { ...local.context, attemptId: expected },
		});
	}
}
const actors: ReturnType<typeof createColony>[] = [];
const warm = fixture();
await idle(warm);
warm.actor.stop();
const hintCases = [{ hintAt: ONE }, { hintAt: 9000 }, { hintAt: 59_999 }];
const hintFixtures = hintCases.map(() => fixture());
const failureCases = [{ failedAt: ONE }, { failedAt: 9000 }, { failedAt: 59_999 }];
const failureFixtures = failureCases.map(() => fixture());
const waitingStates = ["waiting", "claiming", "retrying", "settling"] as const;
const waitingFixtures = waitingStates.map((requestState) =>
	fixture(undefined, [{ ...saved, state: requestState }]),
);
const busyGate = Promise.withResolvers<void>();
const drainGate = Promise.withResolvers<void>();
const transitionGate = Promise.withResolvers<void>();
const scenarios = {
	startup: fixture(),
	storm: fixture(),
	busy: fixture(() => busyGate.promise),
	drain: fixture(() => drainGate.promise),
	nativeFailure: fixture(() => Promise.reject(new Error("native failure"))),
	transition: fixture(() => transitionGate.promise),
	recovery: fixture(undefined, [running], [attempt]),
};
await Promise.all(
	[
		...hintFixtures,
		...failureFixtures,
		...waitingFixtures,
		scenarios.startup,
		scenarios.storm,
		scenarios.recovery,
	].map((current) => idle(current)),
);
afterAll(async () => {
	for (const actor of actors) {
		actor.stop();
	}
	store.close();
	await rm(state, { force: true, recursive: true });
});

test("startup seeds watches then scans immediately; empty passes have a fixed 60-second fallback", async () => {
	const current = scenarios.startup;
	expect(current.order.slice(ZERO, TWO)).toEqual(["watch:", "scan"]);
	expect(current.scans).toEqual([ZERO]);
	current.clock.increment(SIXTY_SECONDS - ONE);
	expect(current.scans).toHaveLength(ONE);
	current.clock.increment(ONE);
	await idle(current);
	expect(current.scans).toEqual([ZERO, SIXTY_SECONDS]);
});

test.each(hintCases)(
	"an idle hint at $hintAt starts one full scan at the earlier paced deadline",
	async ({ hintAt }) => {
		const current = hintFixtures[hintCases.findIndex((entry) => entry.hintAt === hintAt)]!;
		current.clock.increment(hintAt);
		current.notify({ type: "HINT" });
		const remaining = Math.max(ZERO, FIVE_SECONDS - hintAt);
		if (remaining > ZERO) {
			current.clock.increment(remaining - ONE);
		}
		expect(current.scans).toHaveLength(ONE);
		current.clock.increment(Math.min(ONE, remaining));
		await idle(current);
		expect(current.scans).toEqual([ZERO, Math.max(hintAt, FIVE_SECONDS)]);
	},
);

test("a storm coalesces without postponing the first hint deadline or producing repeated scans", async () => {
	const current = scenarios.storm;
	for (let index = ONE; index < FIVE_SECONDS / SECOND; index += ONE) {
		current.clock.increment(SECOND);
		current.notify({ type: "HINT" });
	}
	expect(current.scans).toHaveLength(ONE);
	current.clock.increment(SECOND);
	await idle(current);
	expect(current.scans).toHaveLength(TWO);
	current.clock.increment(SIXTY_SECONDS - ONE);
	expect(current.scans).toHaveLength(TWO);
	current.clock.increment(ONE);
	await idle(current);
	expect(current.scans).toHaveLength(THREE);
});

test("hints during a blocked scan survive completion and produce one spaced follow-up with no overlap", async () => {
	const gate = busyGate;
	const current = scenarios.busy;
	current.clock.increment(SIXTY_SECONDS);
	current.notify({ type: "HINT" });
	current.notify({ type: "HINT" });
	expect(current.scans).toEqual([ZERO]);
	gate.resolve();
	await idle(current);
	current.clock.increment(FIVE_SECONDS - ONE);
	expect(current.scans).toHaveLength(ONE);
	current.clock.increment(ONE);
	await idle(current);
	expect(current.scans).toEqual([ZERO, SIXTY_SECONDS + FIVE_SECONDS]);
	current.clock.increment(SIXTY_SECONDS - ONE);
	expect(current.scans).toHaveLength(TWO);
});

test("STOP discards pending hints, disposes watches immediately and drains the in-flight pass", async () => {
	const gate = drainGate;
	const current = scenarios.drain;
	current.notify({ type: "HINT" });
	current.actor.send({ type: "STOP" });
	expect(current.disposed).toBe(true);
	current.notify({ type: "HINT" });
	current.clock.increment(SIXTY_SECONDS);
	expect(current.actor.getSnapshot().matches({ awake: { busy: "draining" } })).toBe(true);
	gate.resolve();
	await waitFor(current.actor, (snapshot) => snapshot.status === "done");
	current.clock.increment(SIXTY_SECONDS);
	expect(current.scans).toHaveLength(ONE);
});

test("native pass failure remains failed and closes hints and timers", async () => {
	const current = scenarios.nativeFailure;
	await waitFor(current.actor, (snapshot) => snapshot.matches("failed"));
	expect(current.actor.getSnapshot().context.message).toBe("native failure");
	expect(current.disposed).toBe(true);
	current.notify({ type: "HINT" });
	current.clock.increment(SIXTY_SECONDS);
	expect(current.scans).toHaveLength(ONE);
});

test.each(failureCases)(
	"watch failure at $failedAt shortens the existing idle deadline and keeps five-second polling",
	async ({ failedAt }) => {
		const current =
			failureFixtures[failureCases.findIndex((entry) => entry.failedAt === failedAt)]!;
		current.clock.increment(failedAt);
		current.notify({ type: "HINT_FAILURE", message: "fixture watcher closed" });
		expect(current.disposed).toBe(true);
		current.clock.increment(Math.max(ZERO, FIVE_SECONDS - failedAt));
		await idle(current);
		expect(current.scans).toEqual([ZERO, Math.max(FIVE_SECONDS, failedAt)]);
		expect(current.actor.getSnapshot().context.degraded).toBe(true);
		current.clock.increment(FIVE_SECONDS);
		await idle(current);
		expect(current.scans).toHaveLength(THREE);
	},
);

test.each([...waitingStates])(
	"retained %s work keeps the five-second cadence even without hints",
	async (requestState) => {
		const current = waitingFixtures[waitingStates.indexOf(requestState)]!;
		current.clock.increment(FIVE_SECONDS);
		await idle(current);
		expect(current.scans).toEqual([ZERO, FIVE_SECONDS]);
	},
);

test("only unchanged running attempts qualify; starting and newly stable work get a transitional pass", async () => {
	const gate = transitionGate;
	const current = scenarios.transition;
	current.records = [running];
	current.attempts = [{ ...attempt, state: "starting" }];
	gate.resolve();
	await idle(current);
	current.clock.increment(FIVE_SECONDS);
	await idle(current);
	expect(current.scans).toHaveLength(TWO);
	current.attempts = [attempt];
	current.clock.increment(FIVE_SECONDS);
	await idle(current);
	current.clock.increment(SIXTY_SECONDS - ONE);
	expect(current.scans).toHaveLength(THREE);
	current.clock.increment(ONE);
	await idle(current);
	expect(current.scans).toHaveLength(FOUR);
});

test("recovery seeds current attempts before dispatch and refreshes watches after dispatch", async () => {
	const current = scenarios.recovery;
	expect(current.order.slice(ZERO, TWO)).toEqual(["watch:/fixture/current", "scan"]);
	current.records = [];
	current.attempts = [];
	current.notify({ type: "HINT" });
	current.clock.increment(FIVE_SECONDS);
	await idle(current);
	expect(current.order.at(-ONE)).toBe("watch:");
	current.actor.send({ type: "STOP" });
	expect(current.disposed).toBe(true);
	current.clock.increment(SIXTY_SECONDS);
	expect(current.scans).toHaveLength(TWO);
});

test.each(retainedCases)(
	"retained subscriptions select the current local nonterminal attempt ($selection pointer) without artifact I/O",
	({ root, expected }) => {
		expect(store.currentAttempts(root).map(({ id }) => id)).toEqual([expected]);
	},
);

// --- Fixtures ---
function fixture(
	scan: () => Promise<void> = () => Promise.resolve(),
	records: RequestRecord[] = [],
	attempts: AttemptInventory[] = [],
) {
	const clock = new SimulatedClock();
	const scans: number[] = [];
	const order: string[] = [];
	const current = {
		records,
		attempts,
		disposed: false,
		notify: (_event: ColonyHintEvent) => {},
	};
	const actor = createColony(
		{
			...tracker,
			state,
			store: {
				...store,
				requests: () => current.records,
				currentAttempts: () => current.attempts,
				inventory: () => {
					throw new Error("Hint selection must not observe processes or refresh inventory");
				},
			},
		},
		activity,
		{
			clock,
			now: () => clock.now(),
			observeHints: (notify) => {
				current.notify = notify;
				return {
					update: (directories) => order.push(`watch:${directories.join(",")}`),
					dispose: () => {
						current.disposed = true;
					},
				};
			},
			scan: () => {
				order.push("scan");
				scans.push(clock.now());
				return scan();
			},
		},
	);
	actors.push(actor);
	actor.start();
	return Object.assign(current, { actor, clock, order, scans });
}

function idle({ actor }: ReturnType<typeof fixture>) {
	return waitFor(actor, (snapshot) => snapshot.matches({ awake: "idle" }));
}
