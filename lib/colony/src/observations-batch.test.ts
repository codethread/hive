/* eslint-disable max-statements -- Keep gate, admission, partial effects and re-entry assertions together. */
/* eslint-disable no-await-in-loop -- Fixtures mutate one memory tracker in native order. */
/* eslint-disable unicorn/no-null -- Unknown stdout is explicit activity evidence. */
import type { BeadsScope, BeadsService } from "@hive/beads";
import {
	COLONY_OBSERVATION_PREFIX,
	COLONY_STDOUT_PREFIX,
	latestStdoutActivity,
} from "@hive/shared";
import {
	RunningStdoutPublicationError,
	publishRunningStdoutActivities,
	runningObservationCurrent,
} from "./observations.ts";
import { createSpawn, createTask, memoryTracker } from "./tracker.test-support.ts";
import { expect, test } from "bun:test";
import type { RunningObservationInput } from "./observations.ts";
import { trackerScope } from "./tracker.ts";

const ZERO = 0;
const ONE = 1;
const TWO = 2;
const THREE = 3;
const FOUR = 4;
const stdoutTimestamp = "2026-10-04T10:00:00.000Z";
const oldTimestamp = "2026-10-03T10:00:00.000Z";
const directory = "/fixture/owned-stdout";

type Seed = "due" | "unchanged" | "throttled";
type Change = "host" | "unbound" | "identity" | "kind" | "run" | "stage" | "tasks";
const countCases = [
	{ name: "empty input", seeds: [], due: [] },
	{ name: "one due request", seeds: ["due"], due: [ZERO] },
	{ name: "four due requests", seeds: ["due", "due", "due", "due"], due: [ZERO, ONE, TWO, THREE] },
	{ name: "all unchanged", seeds: ["unchanged", "unchanged", "unchanged", "unchanged"], due: [] },
	{
		name: "mixed eligibility",
		seeds: ["due", "unchanged", "throttled", "due"],
		due: [ZERO, THREE],
	},
] satisfies { name: string; seeds: Seed[]; due: number[] }[];
const countFixtures = await Promise.all(countCases.map(({ seeds }) => batchFixture(seeds)));
const authorityCases: { change: Change }[] = [
	{ change: "host" },
	{ change: "unbound" },
	{ change: "identity" },
	{ change: "kind" },
	{ change: "run" },
	{ change: "stage" },
	{ change: "tasks" },
];
const authorityFixtures = await Promise.all(authorityCases.map(() => batchFixture()));
const mappingCases = [
	{ kind: "missing" },
	{ kind: "duplicate" },
	{ kind: "foreign" },
	{ kind: "decode" },
] as const;
const mappingFixtures = await Promise.all(mappingCases.map(() => batchFixture()));
const laterCohorts = await batchFixture(["due", "due", "due", "due", "due", "due"]);
const eligibility = await batchFixture();
const attemptEvidence = await batchFixture(["due"]);
const readFailure = await batchFixture();
const samplingFailure = await batchFixture();
const noOpOnly = await batchFixture(["unchanged"]);
const currentFact = await batchFixture(["due"]);
const pending = await batchFixture();
const failureCases = [{ kind: "before" }, { kind: "after" }, { kind: "sync" }] as const;
const failureFixtures = await Promise.all(failureCases.map(() => batchFixture()));
const failureContexts = failureFixtures.map((fixture, index) =>
	failureContext(fixture, failureCases[index]!.kind),
);
const samplingDirectory = "/fixture/sampling-order";
const sampling = await batchFixture(["due", "due"], samplingDirectory);
const warming = await batchFixture();
const warmingSingleton = await batchFixture(["due"]);
await publishRunningStdoutActivities(warming.context, warming.inputs, warming.readActivity);
await publishRunningStdoutActivities(
	warmingSingleton.context,
	warmingSingleton.inputs,
	warmingSingleton.readActivity,
);
for (const { kind } of failureCases) {
	const fixture = await batchFixture();
	const { context } = failureContext(fixture, kind);
	const error = await publicationFailure(
		publishRunningStdoutActivities(context, fixture.inputs, fixture.readActivity),
	);
	if (!(error instanceof RunningStdoutPublicationError)) {
		throw new Error("Independent native-failure warmup did not exercise the publication error");
	}
}

test.each(countCases)("batch gates only due IDs for $name", async (scenario) => {
	const fixture = countFixtures[countCases.indexOf(scenario)]!;
	await publishRunningStdoutActivities(fixture.context, fixture.inputs, fixture.readActivity);
	const ids = scenario.due.map((index) => fixture.inputs[index]!.receipt.spawnId);
	const expectedTrace: string[] = [];
	if (ids.length > ZERO) {
		expectedTrace.push(`showMany:${ids.join(",")}`, ...ids.map((id) => `add:${id}`));
	}
	expect(fixture.trace).toEqual(expectedTrace);
	const expectedReads: string[][] = [];
	if (ids.length > ZERO) {
		expectedReads.push(ids);
	}
	expect(fixture.reads).toEqual(expectedReads);
	expect(fixture.writes).toEqual(ids);
	for (const [index, input] of fixture.inputs.entries()) {
		const current = await fixture.tracker.beads.show(fixture.scope, input.receipt.spawnId);
		if (scenario.due.includes(index)) {
			const activity = latestStdoutActivity(current);
			expect(activity?.attemptId).toBe(input.receipt.id);
			expect(activity?.lastOutputAt).toBe(stdoutTimestamp);
		}
		expect(current.comments.every(({ author }) => author === "sys-colony")).toBe(true);
	}
});

test("running fact predicate keeps attempt-specific fact interpretation in observations", () => {
	const input = currentFact.inputs[ZERO]!;
	expect(runningObservationCurrent(input)).toBe(true);
	expect(
		runningObservationCurrent({
			...input,
			receipt: { ...input.receipt, attemptNumber: TWO },
		}),
	).toBe(false);
	expect(
		runningObservationCurrent({ ...input, snapshot: { ...input.snapshot, comments: [] } }),
	).toBe(false);
});

test.each(authorityCases)(
	"$change drift in the last row admits no cohort comments",
	async (scenario) => {
		const fixture = authorityFixtures[authorityCases.indexOf(scenario)]!;
		const input = fixture.inputs[THREE]!;
		const context = withGate(fixture, async (scope, ids) => {
			await mutateAuthority(fixture, input, scenario.change);
			return fixture.tracker.beads.showMany(scope, ids);
		});
		await expect(
			publishRunningStdoutActivities(context, fixture.inputs, fixture.readActivity),
		).rejects.toBeInstanceOf(Error);
		expect(fixture.writes).toEqual([]);
		for (const candidate of fixture.inputs) {
			const current = await fixture.tracker.beads.show(fixture.scope, candidate.receipt.spawnId);
			expect(latestStdoutActivity(current)).toBeUndefined();
		}
	},
);

test.each([...mappingCases])(
	"$kind native ID mapping fails before any comments",
	async (scenario) => {
		const fixture = mappingFixtures[mappingCases.indexOf(scenario)]!;
		const context = withGate(fixture, async (scope, ids) => {
			const rows = await fixture.tracker.beads.showMany(scope, ids);
			if (scenario.kind === "missing") {
				return rows.slice(ONE);
			}
			if (scenario.kind === "duplicate") {
				return [rows[ZERO]!, rows[ZERO]!, ...rows.slice(TWO)];
			}
			if (scenario.kind === "decode") {
				return [
					...rows.slice(ZERO, THREE),
					{ ...rows[THREE]!, description: "Malformed native detail" },
				];
			}
			return [{ ...rows[ZERO]!, id: "unrequested" }, ...rows.slice(ONE)];
		});
		await expect(
			publishRunningStdoutActivities(context, fixture.inputs, fixture.readActivity),
		).rejects.toBeInstanceOf(Error);
		expect(fixture.writes).toEqual([]);
	},
);

test("later cohorts have a separate fresh gate and cannot erase earlier committed effects", async () => {
	const first = laterCohorts.inputs.slice(ZERO, FOUR);
	const later = laterCohorts.inputs.slice(FOUR);
	await publishRunningStdoutActivities(laterCohorts.context, first, laterCohorts.readActivity);
	await mutateAuthority(laterCohorts, later[ONE]!, "identity");
	await expect(
		publishRunningStdoutActivities(laterCohorts.context, later, laterCohorts.readActivity),
	).rejects.toBeInstanceOf(Error);
	expect(laterCohorts.reads).toEqual([
		first.map(({ receipt }) => receipt.spawnId),
		later.map(({ receipt }) => receipt.spawnId),
	]);
	expect(laterCohorts.writes).toEqual(first.map(({ receipt }) => receipt.spawnId));
	const current = await laterCohorts.tracker.beads.showMany(
		laterCohorts.scope,
		laterCohorts.inputs.map(({ receipt }) => receipt.spawnId),
	);
	expect(current.map((spawn) => latestStdoutActivity(spawn) !== undefined)).toEqual([
		true,
		true,
		true,
		true,
		false,
		false,
	]);
});

test("reversed final detail maps fresh closure, duplicate and throttle to their own requests", async () => {
	const context = withGate(eligibility, async (scope, ids) => {
		await eligibility.tracker.beads.close(scope, ids[ZERO]!);
		await seedActivity(eligibility, eligibility.inputs[ONE]!, stdoutTimestamp);
		await seedActivity(
			eligibility,
			eligibility.inputs[TWO]!,
			oldTimestamp,
			new Date().toISOString(),
		);
		const rows = await eligibility.tracker.beads.showMany(scope, ids);
		return rows.toReversed();
	});
	await publishRunningStdoutActivities(context, eligibility.inputs, eligibility.readActivity);
	expect(eligibility.writes).toEqual([eligibility.inputs[THREE]!.receipt.spawnId]);
});

test("fresh different-attempt evidence cannot suppress the owned current attempt", async () => {
	const input = attemptEvidence.inputs[ZERO]!;
	const context = withGate(attemptEvidence, async (scope, ids) => {
		await seedActivity(
			attemptEvidence,
			{
				...input,
				receipt: { ...input.receipt, id: "prior-attempt", attemptNumber: ONE },
			},
			stdoutTimestamp,
		);
		return attemptEvidence.tracker.beads.showMany(scope, ids);
	});
	await publishRunningStdoutActivities(
		context,
		attemptEvidence.inputs,
		attemptEvidence.readActivity,
	);
	expect(attemptEvidence.writes).toEqual([input.receipt.spawnId]);
	const current = await attemptEvidence.tracker.beads.show(
		attemptEvidence.scope,
		input.receipt.spawnId,
	);
	expect(latestStdoutActivity(current)?.attemptId).toBe(input.receipt.id);
});

test("snapshot reuse authorizes only a no-op even if native detail has since changed", async () => {
	await mutateAuthority(noOpOnly, noOpOnly.inputs[ZERO]!, "host");
	await publishRunningStdoutActivities(noOpOnly.context, noOpOnly.inputs, noOpOnly.readActivity);
	expect(noOpOnly.trace).toEqual([]);
});

test("all stdout sampling precedes the final gate and comments retain the sampled source time", async () => {
	let gated = false;
	const context = withGate(sampling, (scope, ids) => {
		expect(sampling.samples).toEqual(sampling.inputs.map(({ receipt }) => receipt.directory));
		gated = true;
		sampling.sourceTime.value = oldTimestamp;
		return sampling.tracker.beads.showMany(scope, ids);
	});
	await publishRunningStdoutActivities(context, sampling.inputs, (path) => {
		expect(gated).toBe(false);
		return sampling.readActivity(path);
	});
	for (const input of sampling.inputs) {
		const current = await sampling.tracker.beads.show(sampling.scope, input.receipt.spawnId);
		expect(latestStdoutActivity(current)?.lastOutputAt).toBe(stdoutTimestamp);
	}
});

test("stdout sampling failure preserves its cause before any native gate or comment", async () => {
	const error = new Error("Owned stdout metadata is unreadable");
	await expect(
		publishRunningStdoutActivities(samplingFailure.context, samplingFailure.inputs, () =>
			Promise.reject(error),
		),
	).rejects.toBe(error);
	expect(samplingFailure.trace).toEqual([]);
});

test("native gate failure retains its cause and starts no comments", async () => {
	const error = new Error("Native read failed");
	const context = withGate(readFailure, () => Promise.reject(error));
	await expect(
		publishRunningStdoutActivities(context, readFailure.inputs, readFailure.readActivity),
	).rejects.toBe(error);
	expect(readFailure.writes).toEqual([]);
});

test("all distinct comments start immediately and retain every sibling effect", async () => {
	const controls = pending.inputs.map(() => Promise.withResolvers<void>());
	const started: string[] = [];
	let admissionYielded = false;
	const allStarted = Promise.withResolvers<void>();
	const error = new Error("First native comment rejected");
	const context = {
		...pending.context,
		beads: {
			...pending.context.beads,
			comments: {
				...pending.context.beads.comments,
				add: async (...args: Parameters<BeadsService["comments"]["add"]>) => {
					expect(admissionYielded).toBe(false);
					queueMicrotask(() => {
						admissionYielded = true;
					});
					const index = started.length;
					started.push(args[ONE]);
					if (started.length === FOUR) {
						allStarted.resolve();
					}
					await controls[index]!.promise;
					return pending.context.beads.comments.add(...args);
				},
			},
		},
	};
	let finished = false;
	const operation = (async () => {
		try {
			return await publicationFailure(
				publishRunningStdoutActivities(context, pending.inputs, pending.readActivity),
			);
		} finally {
			finished = true;
		}
	})();
	await allStarted.promise;
	expect(started).toEqual(pending.inputs.map(({ receipt }) => receipt.spawnId));
	expect(finished).toBe(false);
	const firstFailed = publicationFailure(controls[ZERO]!.promise);
	controls[ZERO]!.reject(error);
	await firstFailed;
	controls[ONE]!.resolve();
	controls[TWO]!.resolve();
	controls[THREE]!.resolve();
	const failure = await operation;
	expect(failure).toBeInstanceOf(RunningStdoutPublicationError);
	const { failures } = failure as RunningStdoutPublicationError;
	expect(failures).toHaveLength(ONE);
	expect(failures[ZERO]!.requestId).toBe(started[ZERO]!);
	expect(failures[ZERO]!.error).toBe(error);
	expect(finished).toBe(true);
	const current = await pending.tracker.beads.showMany(pending.scope, started);
	expect(current.map((snapshot) => latestStdoutActivity(snapshot) !== undefined)).toEqual([
		false,
		true,
		true,
		true,
	]);
});

test.each([...failureCases])(
	"$kind failure preserves all causes, siblings and re-entry deduplication",
	async (scenario) => {
		const fixture = failureFixtures[failureCases.indexOf(scenario)]!;
		const { errors, started, context } = failureContexts[failureCases.indexOf(scenario)]!;
		const failure = await publicationFailure(
			publishRunningStdoutActivities(context, fixture.inputs, fixture.readActivity),
		);
		expect(started).toEqual(fixture.inputs.map(({ receipt }) => receipt.spawnId));
		expect(failure).toBeInstanceOf(RunningStdoutPublicationError);
		const publicationError = failure as RunningStdoutPublicationError;
		expect(publicationError.errors).toHaveLength(errors.length);
		expect(publicationError.failures).toHaveLength(errors.length);
		for (const [index, error] of errors.entries()) {
			expect(publicationError.errors[index]).toBe(error);
			expect(publicationError.failures[index]!.requestId).toBe(started[index]!);
			expect(publicationError.failures[index]!.error).toBe(error);
		}
		const snapshots = await fixture.tracker.beads.showMany(fixture.scope, started);
		let expectedCommitted = [false, false, true, true];
		let expectedRetry = started.slice(ZERO, TWO);
		if (scenario.kind === "after") {
			expectedCommitted = [true, true, true, true];
			expectedRetry = [];
		}
		expect(snapshots.map((snapshot) => latestStdoutActivity(snapshot) !== undefined)).toEqual(
			expectedCommitted,
		);
		fixture.writes.length = ZERO;
		fixture.trace.length = ZERO;
		await publishRunningStdoutActivities(
			fixture.context,
			fixture.inputs.map((input, index) => ({ ...input, snapshot: snapshots[index]! })),
			fixture.readActivity,
		);
		expect(fixture.writes).toEqual(expectedRetry);
		const current = await fixture.tracker.beads.showMany(fixture.scope, started);
		expect(
			current.map(
				(snapshot) =>
					snapshot.comments.filter(({ text }) => text.startsWith(COLONY_STDOUT_PREFIX)).length,
			),
		).toEqual([ONE, ONE, ONE, ONE]);
	},
);

// --- Fixtures ---
async function batchFixture(
	seeds: readonly Seed[] = ["due", "due", "due", "due"],
	stdoutDirectory = directory,
) {
	const tracker = memoryTracker();
	const scope = trackerScope(tracker.repository, "sys-colony");
	const inputs: RunningObservationInput[] = [];
	for (const [index, seed] of seeds.entries()) {
		const stageId = await createTask(tracker);
		const runId = await createTask(tracker);
		const id = await createSpawn(tracker, stageId, { assignee: `worker-${index}` });
		const original = await tracker.beads.show(scope, id);
		await tracker.beads.update(scope, [id], {
			description: JSON.stringify({
				...JSON.parse(original.description),
				assignment: { kind: "stage", runId, stageId },
			}),
		});
		await tracker.beads.comments.add(scope, id, `${COLONY_OBSERVATION_PREFIX} running: attempt 1`);
		const receipt = {
			id: `attempt-${index}`,
			attemptNumber: ONE,
			spawnId: id,
			directory: `${stdoutDirectory}/${index}`,
		};
		if (seed !== "due") {
			let lastOutputAt = stdoutTimestamp;
			let recordedAt = oldTimestamp;
			if (seed === "throttled") {
				lastOutputAt = oldTimestamp;
				recordedAt = new Date().toISOString();
			}
			await tracker.beads.comments.add(
				scope,
				id,
				`${COLONY_STDOUT_PREFIX} ${JSON.stringify({
					attemptId: receipt.id,
					attemptNumber: receipt.attemptNumber,
					lastOutputAt,
					recordedAt,
				})}`,
			);
		}
		inputs.push({ receipt, snapshot: await tracker.beads.show(scope, id) });
	}
	const sourceTime: { value: string | null } = { value: stdoutTimestamp };
	const directories = new Set(inputs.map(({ receipt }) => receipt.directory));
	const samples: string[] = [];
	const readActivity = (path: string): Promise<string | null> => {
		if (!directories.has(path)) {
			throw new Error("Stdout sampling left the captured fixture directories");
		}
		samples.push(path);
		return Promise.resolve(sourceTime.value);
	};
	const trace: string[] = [];
	const reads: string[][] = [];
	const writes: string[] = [];
	const context = {
		...tracker,
		beads: {
			...tracker.beads,
			show: () => {
				throw new Error("Batch must not use individual show");
			},
			showMany: (readScope: BeadsScope, ids: readonly string[]) => {
				expect(readScope).toEqual(scope);
				reads.push([...ids]);
				trace.push(`showMany:${ids.join(",")}`);
				return tracker.beads.showMany(readScope, ids);
			},
			comments: {
				...tracker.beads.comments,
				add: (...args: Parameters<BeadsService["comments"]["add"]>) => {
					expect(args[ZERO]).toEqual(scope);
					writes.push(args[ONE]);
					trace.push(`add:${args[ONE]}`);
					return tracker.beads.comments.add(...args);
				},
			},
		},
	};
	return {
		tracker,
		scope,
		inputs,
		trace,
		reads,
		writes,
		context,
		readActivity,
		sourceTime,
		samples,
	};
}

function withGate(
	fixture: Awaited<ReturnType<typeof batchFixture>>,
	showMany: BeadsService["showMany"],
) {
	return { ...fixture.context, beads: { ...fixture.context.beads, showMany } };
}

async function mutateAuthority(
	fixture: Awaited<ReturnType<typeof batchFixture>>,
	input: RunningObservationInput,
	change: Change,
) {
	const { tracker, scope } = fixture;
	const id = input.receipt.spawnId;
	if (change === "identity") {
		await tracker.beads.update(scope, [id], { assignee: "other-worker" });
		return;
	}
	const description = JSON.parse(input.snapshot.description);
	if (change === "host") {
		description.host = "foreign-host";
	} else if (change === "unbound") {
		delete description.host;
	} else if (change === "kind") {
		description.assignment = { kind: "driver", runId: description.assignment.stageId };
	} else if (change === "run") {
		description.assignment.runId = await createTask(tracker);
	} else if (change === "stage") {
		const stageId = await createTask(tracker);
		await tracker.beads.dep.remove(scope, id, description.assignment.stageId);
		await tracker.beads.dep.add(scope, id, stageId, "related");
		description.assignment.stageId = stageId;
	} else {
		await tracker.beads.dep.add(scope, id, await createTask(tracker), "related");
	}
	await tracker.beads.update(scope, [id], { description: JSON.stringify(description) });
}

/* eslint-disable-next-line max-params -- Seed native activity with independent source and publication times. */
function seedActivity(
	fixture: Awaited<ReturnType<typeof batchFixture>>,
	input: RunningObservationInput,
	lastOutputAt: string,
	recordedAt = oldTimestamp,
) {
	return fixture.tracker.beads.comments.add(
		fixture.scope,
		input.receipt.spawnId,
		`${COLONY_STDOUT_PREFIX} ${JSON.stringify({
			attemptId: input.receipt.id,
			attemptNumber: input.receipt.attemptNumber,
			lastOutputAt,
			recordedAt,
		})}`,
	);
}

async function publicationFailure(operation: Promise<void>): Promise<unknown> {
	try {
		await operation;
	} catch (error) {
		return error;
	}
	return undefined;
}

function failureContext(
	fixture: Awaited<ReturnType<typeof batchFixture>>,
	kind: "before" | "after" | "sync",
) {
	const errors = [new Error("First native failure"), new Error("Second native failure")];
	const started: string[] = [];
	const context = {
		...fixture.context,
		beads: {
			...fixture.context.beads,
			comments: {
				...fixture.context.beads.comments,
				add: (...args: Parameters<BeadsService["comments"]["add"]>) => {
					const index = started.length;
					started.push(args[ONE]);
					if (index < TWO && kind === "sync") {
						throw errors[index];
					}
					if (index < TWO && kind === "before") {
						return Promise.reject(errors[index]);
					}
					return fixture.context.beads.comments.add(...args).then((result) => {
						if (index < TWO) {
							throw errors[index];
						}
						return result;
					});
				},
			},
		},
	};
	return { errors, started, context };
}
