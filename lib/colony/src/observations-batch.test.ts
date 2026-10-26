/* eslint-disable max-statements -- Keep gate, admission, partial effects and re-entry assertions together. */
/* eslint-disable unicorn/no-null -- Unknown stdout is explicit activity evidence. */
import type { BeadRecord, BeadsScope, BeadsService } from "@hive/beads";
import {
	COLONY_OBSERVATION_PREFIX,
	COLONY_STDOUT_PREFIX,
	latestStdoutActivity,
	spawnRequestLabels,
} from "@hive/shared";
import type { Recipe, WorkflowAssignment } from "@hive/shared";
import type { RunningObservationContext, RunningObservationInput } from "./observations.ts";
import {
	RunningStdoutPublicationError,
	publishRunningStdoutActivities,
	runningObservationCurrent,
} from "./observations.ts";
import { expect, test } from "bun:test";
// eslint-disable-next-line import/no-nodejs-modules -- Bind fixture authority to the publication host.
import { hostname } from "node:os";
// eslint-disable-next-line import/no-nodejs-modules -- Observe completed rejection handling before releasing siblings.
import { setImmediate as nextTurn } from "node:timers/promises";
import { trackerScope } from "./tracker.ts";

const ZERO = 0;
const ONE = 1;
const TWO = 2;
const THREE = 3;
const FOUR = 4;
const stdoutTimestamp = "2026-10-04T10:00:00.000Z";
const oldTimestamp = "2026-10-03T10:00:00.000Z";
const directory = "/fixture/owned-stdout";
const recipe: Recipe = {
	cwd: null,
	effort: "low",
	harness: "fixture",
	kind: "worker",
	model: "fixture",
	prompt: "Complete assigned tasks",
	system_prompt: "Worker role",
};

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
const authorityCases: { change: Change }[] = [
	{ change: "host" },
	{ change: "unbound" },
	{ change: "identity" },
	{ change: "kind" },
	{ change: "run" },
	{ change: "stage" },
	{ change: "tasks" },
];
const mappingCases = [
	{ kind: "missing" },
	{ kind: "duplicate" },
	{ kind: "foreign" },
	{ kind: "decode" },
] as const;
const failureCases = [{ kind: "before" }, { kind: "after" }, { kind: "sync" }] as const;

test.each(countCases)("batch gates only due IDs for $name #test-719", async (scenario) => {
	const fixture = batchFixture(scenario.seeds);
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
		const current = fixture.records.get(input.receipt.spawnId)!;
		if (scenario.due.includes(index)) {
			const comment = current.comments.find(({ text }) => text.startsWith(COLONY_STDOUT_PREFIX));
			const activity = comment && JSON.parse(comment.text.slice(COLONY_STDOUT_PREFIX.length));
			expect(activity?.attemptId).toBe(input.receipt.id);
			expect(activity?.lastOutputAt).toBe(stdoutTimestamp);
		}
		expect(current.comments.every(({ author }) => author === "sys-colony")).toBe(true);
	}
});

test("running fact predicate keeps attempt-specific fact interpretation in observations", () => {
	const currentFact = batchFixture(["due"]);
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
	"$change drift in the last row admits no cohort comments #test-674",
	async (scenario) => {
		const fixture = batchFixture();
		const input = fixture.inputs[THREE]!;
		const context = withGate(fixture, (scope, ids) => {
			mutateAuthority(fixture, input, scenario.change);
			return fixture.beads.showMany(scope, ids);
		});
		await expect(
			publishRunningStdoutActivities(context, fixture.inputs, fixture.readActivity),
		).rejects.toBeInstanceOf(Error);
		expect(fixture.writes).toEqual([]);
		for (const candidate of fixture.inputs) {
			const current = fixture.records.get(candidate.receipt.spawnId)!;
			expect(latestStdoutActivity(current)).toBeUndefined();
		}
	},
);

test.each([...mappingCases])(
	"$kind native ID mapping fails before any comments",
	async (scenario) => {
		const fixture = batchFixture();
		const context = withGate(fixture, async (scope, ids) => {
			const rows = await fixture.beads.showMany(scope, ids);
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

test("later cohorts have a separate fresh gate and cannot erase earlier committed effects #test-745", async () => {
	const laterCohorts = batchFixture(["due", "due", "due", "due", "due", "due"]);
	const first = laterCohorts.inputs.slice(ZERO, FOUR);
	const later = laterCohorts.inputs.slice(FOUR);
	await publishRunningStdoutActivities(laterCohorts.context, first, laterCohorts.readActivity);
	mutateAuthority(laterCohorts, later[ONE]!, "identity");
	await expect(
		publishRunningStdoutActivities(laterCohorts.context, later, laterCohorts.readActivity),
	).rejects.toBeInstanceOf(Error);
	expect(laterCohorts.reads).toEqual([
		first.map(({ receipt }) => receipt.spawnId),
		later.map(({ receipt }) => receipt.spawnId),
	]);
	expect(laterCohorts.writes).toEqual(first.map(({ receipt }) => receipt.spawnId));
	const current = await laterCohorts.beads.showMany(
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
	const eligibility = batchFixture();
	const context = withGate(eligibility, async (scope, ids) => {
		eligibility.records.get(ids[ZERO]!)!.status = "closed";
		await seedActivity(eligibility, eligibility.inputs[ONE]!, stdoutTimestamp);
		await seedActivity(
			eligibility,
			eligibility.inputs[TWO]!,
			oldTimestamp,
			new Date().toISOString(),
		);
		const rows = await eligibility.beads.showMany(scope, ids);
		return rows.toReversed();
	});
	await publishRunningStdoutActivities(context, eligibility.inputs, eligibility.readActivity);
	expect(eligibility.writes).toEqual([eligibility.inputs[THREE]!.receipt.spawnId]);
});

test("fresh different-attempt evidence cannot suppress the owned current attempt", async () => {
	const attemptEvidence = batchFixture(["due"]);
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
		return attemptEvidence.beads.showMany(scope, ids);
	});
	await publishRunningStdoutActivities(
		context,
		attemptEvidence.inputs,
		attemptEvidence.readActivity,
	);
	expect(attemptEvidence.writes).toEqual([input.receipt.spawnId]);
	const current = attemptEvidence.records.get(input.receipt.spawnId)!;
	expect(latestStdoutActivity(current)?.attemptId).toBe(input.receipt.id);
});

test("snapshot reuse authorizes only a no-op even if native detail has since changed", async () => {
	const noOpOnly = batchFixture(["unchanged"]);
	mutateAuthority(noOpOnly, noOpOnly.inputs[ZERO]!, "host");
	await publishRunningStdoutActivities(noOpOnly.context, noOpOnly.inputs, noOpOnly.readActivity);
	expect(noOpOnly.trace).toEqual([]);
});

test("all stdout sampling precedes the final gate and comments retain the sampled source time #test-742", async () => {
	const sampling = batchFixture(["due", "due"], "/fixture/sampling-order");
	let gated = false;
	const context = withGate(sampling, (scope, ids) => {
		expect(sampling.samples).toEqual(sampling.inputs.map(({ receipt }) => receipt.directory));
		gated = true;
		sampling.sourceTime.value = oldTimestamp;
		return sampling.beads.showMany(scope, ids);
	});
	await publishRunningStdoutActivities(context, sampling.inputs, (path) => {
		expect(gated).toBe(false);
		return sampling.readActivity(path);
	});
	for (const input of sampling.inputs) {
		const current = sampling.records.get(input.receipt.spawnId)!;
		expect(latestStdoutActivity(current)?.lastOutputAt).toBe(stdoutTimestamp);
	}
});

test("stdout sampling failure preserves its cause before any native gate or comment #test-730", async () => {
	const samplingFailure = batchFixture();
	const error = new Error("Owned stdout metadata is unreadable");
	await expect(
		publishRunningStdoutActivities(samplingFailure.context, samplingFailure.inputs, () =>
			Promise.reject(error),
		),
	).rejects.toBe(error);
	expect(samplingFailure.trace).toEqual([]);
});

test("native gate failure retains its cause and starts no comments", async () => {
	const readFailure = batchFixture();
	const error = new Error("Native read failed");
	const context = withGate(readFailure, () => Promise.reject(error));
	await expect(
		publishRunningStdoutActivities(context, readFailure.inputs, readFailure.readActivity),
	).rejects.toBe(error);
	expect(readFailure.writes).toEqual([]);
});

test("all distinct comments start immediately and retain every sibling effect #test-746", async () => {
	const pending = batchFixture();
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
	await nextTurn();
	expect(finished).toBe(false);
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
	const current = await pending.beads.showMany(pending.scope, started);
	expect(current.map((snapshot) => latestStdoutActivity(snapshot) !== undefined)).toEqual([
		false,
		true,
		true,
		true,
	]);
});

test.each([...failureCases])(
	"$kind failure preserves all causes, siblings and re-entry deduplication #test-661",
	async (scenario) => {
		const fixture = batchFixture();
		const { errors, started, context } = failureContext(fixture, scenario.kind);
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
		const snapshots = await fixture.beads.showMany(fixture.scope, started);
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
		const current = await fixture.beads.showMany(fixture.scope, started);
		expect(
			current.map(
				(snapshot) =>
					snapshot.comments.filter(({ text }) => text.startsWith(COLONY_STDOUT_PREFIX)).length,
			),
		).toEqual([ONE, ONE, ONE, ONE]);
	},
);

// --- Fixtures ---
function batchFixture(
	seeds: readonly Seed[] = ["due", "due", "due", "due"],
	stdoutDirectory = directory,
) {
	const repository = { beadsDb: "/fixture/tracker.db", root: "/fixture" };
	const scope = trackerScope(repository, "sys-colony");
	const prepared = seeds.map((seed, index) => runningInput(index, seed, stdoutDirectory));
	const inputs = prepared.map(({ input }) => input);
	const requests = new Map(prepared.map(({ input, request }) => [input.receipt.spawnId, request]));
	// Detach backing records so gate-time drift leaves captured authority unchanged.
	const records = new Map(inputs.map(({ snapshot }) => [snapshot.id, structuredClone(snapshot)]));
	const beads: Pick<BeadsService, "showMany"> & {
		comments: Pick<BeadsService["comments"], "add">;
	} = {
		showMany: (_scope, ids) => Promise.resolve(ids.map((id) => structuredClone(records.get(id)!))),
		comments: {
			add: (writeScope, id, text) => {
				const snapshot = records.get(id)!;
				const comment = {
					id: snapshot.comments.length + ONE,
					issue_id: id,
					author: writeScope.actor!,
					created_at: oldTimestamp,
					text,
				};
				snapshot.comments.push(comment);
				return Promise.resolve({ ...comment });
			},
		},
	};
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
	const context: RunningObservationContext = {
		repository,
		beads: {
			showMany: (readScope: BeadsScope, ids: readonly string[]) => {
				expect(readScope).toEqual(scope);
				reads.push([...ids]);
				trace.push(`showMany:${ids.join(",")}`);
				return beads.showMany(readScope, ids);
			},
			comments: {
				add: (...args: Parameters<BeadsService["comments"]["add"]>) => {
					expect(args[ZERO]).toEqual(scope);
					writes.push(args[ONE]);
					trace.push(`add:${args[ONE]}`);
					return beads.comments.add(...args);
				},
			},
		},
	};
	return {
		beads,
		records,
		requests,
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

function runningInput(index: number, seed: Seed, stdoutDirectory: string) {
	const id = `request-${index}`;
	const stageId = `stage-${index}`;
	const request = {
		...recipe,
		host: hostname(),
		assignment: { kind: "stage" as const, runId: `run-${index}`, stageId },
	};
	const receipt: RunningObservationInput["receipt"] = {
		id: `attempt-${index}`,
		attemptNumber: ONE,
		spawnId: id,
		directory: `${stdoutDirectory}/${index}`,
	};
	const snapshot: BeadRecord = {
		id,
		title: "Running request",
		issue_type: "task",
		notes: "",
		design: "",
		acceptance_criteria: "",
		assignee: `worker-${index}`,
		owner: "ct",
		status: "open",
		priority: ONE,
		description: JSON.stringify(request),
		labels: spawnRequestLabels("worker"),
		created_at: oldTimestamp,
		updated_at: oldTimestamp,
		dependencies: [
			{ dependency_type: "related", id: stageId, title: "Work", status: "open", priority: ONE },
		],
		dependents: [],
		comments: [
			{
				id: ONE,
				issue_id: id,
				author: "sys-colony",
				created_at: oldTimestamp,
				text: `${COLONY_OBSERVATION_PREFIX} running: attempt 1`,
			},
		],
	};
	if (seed !== "due") {
		let lastOutputAt = stdoutTimestamp;
		let recordedAt = oldTimestamp;
		if (seed === "throttled") {
			lastOutputAt = oldTimestamp;
			recordedAt = new Date().toISOString();
		}
		snapshot.comments.push({
			id: TWO,
			issue_id: id,
			author: "sys-colony",
			created_at: oldTimestamp,
			text: `${COLONY_STDOUT_PREFIX} ${JSON.stringify({
				attemptId: receipt.id,
				attemptNumber: receipt.attemptNumber,
				lastOutputAt,
				recordedAt,
			})}`,
		});
	}
	return { input: { receipt, snapshot }, request };
}

function withGate(fixture: ReturnType<typeof batchFixture>, showMany: BeadsService["showMany"]) {
	return { ...fixture.context, beads: { ...fixture.context.beads, showMany } };
}

function mutateAuthority(
	fixture: ReturnType<typeof batchFixture>,
	input: RunningObservationInput,
	change: Change,
) {
	const id = input.receipt.spawnId;
	const snapshot = fixture.records.get(id)!;
	if (change === "identity") {
		snapshot.assignee = "other-worker";
		return;
	}
	const original = fixture.requests.get(id)!;
	let host: string | undefined = original.host;
	let assignment: WorkflowAssignment = original.assignment;
	if (change === "host") {
		host = "foreign-host";
	} else if (change === "unbound") {
		host = undefined;
	} else if (change === "kind") {
		assignment = { kind: "driver", runId: original.assignment.stageId };
	} else if (change === "run") {
		assignment = { ...original.assignment, runId: "other-run" };
	} else if (change === "stage") {
		assignment = { ...original.assignment, stageId: "other-stage" };
		snapshot.dependencies = [{ ...snapshot.dependencies[ZERO]!, id: "other-stage" }];
	} else {
		snapshot.dependencies.push({ ...snapshot.dependencies[ZERO]!, id: "other-task" });
	}
	snapshot.description = JSON.stringify({ ...original, host, assignment });
}

/* eslint-disable-next-line max-params -- Seed stdout evidence with independent source and publication times. */
function seedActivity(
	fixture: ReturnType<typeof batchFixture>,
	input: RunningObservationInput,
	lastOutputAt: string,
	recordedAt = oldTimestamp,
) {
	return fixture.beads.comments.add(
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
	fixture: ReturnType<typeof batchFixture>,
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
