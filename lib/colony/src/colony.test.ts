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
import { createAdmissionGate } from "./admission.ts";
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
const waitingStates = ["claiming", "retrying"] as const;
const waitingFixtures = waitingStates.map((requestState) =>
	fixture(undefined, [{ ...saved, state: requestState }]),
);
const scenarios = {
	nativeFailure: fixture(() => Promise.reject(new Error("native failure"))),
	recovery: fixture(undefined, [running], [attempt]),
};
await Promise.all([...waitingFixtures, scenarios.recovery].map((current) => idle(current)));
afterAll(async () => {
	for (const actor of actors) {
		actor.stop();
	}
	store.close();
	await rm(state, { force: true, recursive: true });
});

test("native pass failure remains failed and closes hints and timers", async () => {
	const current = scenarios.nativeFailure;
	await waitFor(current.actor, (snapshot) => snapshot.matches("failed"));
	expect(current.actor.getSnapshot().context.message).toBe("native failure");
	expect(current.diagnostics).toHaveLength(ONE);
	expect(current.diagnostics[ZERO]).toContain("failed: native failure");
	expect(current.disposed).toBe(true);
	current.notify({ type: "HINT" });
	current.clock.increment(SIXTY_SECONDS);
	expect(current.scans).toHaveLength(ONE);
});

test.each([...waitingStates])(
	"retained %s work keeps the five-second cadence even without hints",
	async (requestState) => {
		const current = waitingFixtures[waitingStates.indexOf(requestState)]!;
		current.clock.increment(FIVE_SECONDS);
		await idle(current);
		expect(current.scans).toEqual([ZERO, FIVE_SECONDS]);
	},
);

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
		diagnostics: [] as string[],
		notify: (_event: ColonyHintEvent) => {},
	};
	const actor = createColony(
		{
			...tracker,
			state,
			withAdmission: createAdmissionGate(),
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
			report: (message) => {
				current.diagnostics.push(message);
			},
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
