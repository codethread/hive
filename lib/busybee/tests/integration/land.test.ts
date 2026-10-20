import {
	commandSchemas,
	inputSchema,
	machine,
	runBrief,
} from "../../../../.workflows/land/workflow.ts";
import { describe, expect, test } from "bun:test";
import { initialTransition, transition } from "xstate";
import { metadataSchema, renderTask } from "../../src/definition.ts";
import { navigate, recordResult, start } from "../../src/runtime.ts";
import type { ResolvedTask } from "../../src/definition.ts";
import type { SnapshotFrom } from "xstate";
import { createMemoryBeads } from "@hive/beads";
import { createServices } from "../../src/native.ts";
import { invoke } from "./support.ts";
import manifest from "../../../../.workflows/land/busybee.toml" with { type: "text" };
import { spawnRequestLabels } from "@hive/shared";

const FIRST = 0;
const ID_ARGUMENT = 1;
const ONE_REQUEST = 1;
const DISPATCH_STAGE_ARGUMENT = 4;
const DISPATCH_RUN_ARGUMENT = 6;
const DISPATCH_PREFIX = 7;
const worktreeTarget = { kind: "worktree", branch: "simulated-work" } as const;
const evidence = "SIMULATED transport evidence only; no real approval, merge or publication.";
const outcome = { evidence };
const titles = {
	check: "Finish and check",
	review: "Review",
	finish: "Commit and land",
	verify: "Verify integration",
	"local-update": "Update local tools",
};
const events = {
	approved: "APPROVED",
	changes: "CHANGES",
	integrated: "INTEGRATED",
	next: "NEXT",
	passed: "PASSED",
} as const;
type LandingInput = ReturnType<typeof inputSchema.parse>;
type Stage = keyof typeof titles;
type Choice = keyof typeof commandSchemas;
type TraceStep = readonly [Stage, Choice];
const completion: TraceStep[] = [
	["verify", "next"],
	["local-update", "next"],
];
const paths: { name: string; target: LandingInput["target"]; steps: TraceStep[] }[] = [
	{
		name: "worktree findings and changed delivery require checked repairs and renewed review",
		target: worktreeTarget,
		steps: [
			["check", "passed"],
			["review", "changes"],
			["check", "passed"],
			["review", "approved"],
			["finish", "changes"],
			["check", "passed"],
			["review", "approved"],
			["finish", "next"],
			...completion,
		],
	},
	{
		name: "PR delivery follows checked work and independent review",
		target: { kind: "pr", url: "https://github.com/example/repo/pull/1" },
		steps: [["check", "passed"], ["review", "approved"], ["finish", "next"], ...completion],
	},
	{
		name: "already integrated work proceeds to verification and local update",
		target: { kind: "worktree", branch: "already-integrated" },
		steps: [["check", "integrated"], ...completion],
	},
];
const closureCases = [
	{ caller: "standalone-caller", completeParent: true },
	{ caller: "land-driver", completeParent: true },
	{ caller: "standalone-caller", completeParent: false },
	{ caller: "land-driver", completeParent: false },
];
// Prepare independent runs at their final visit; assertions exercise collection and caller closure.
const closureRuns = new Map(
	await Promise.all(
		closureCases.map(
			async (entry) => [JSON.stringify(entry), await closureFixture(entry)] as const,
		),
	),
);
// Warm the runtime's done projection before measuring independently prepared lifecycle cases.
const closureWarmup = await closureFixture(closureCases[FIRST]!);
await closureWarmup.beads.close(closureWarmup.scope, closureWarmup.run.active[FIRST]!.bead);
await navigate({ id: closureWarmup.run.id, operation: "collect" }, {}, closureWarmup.io);

// Warm dispatch parsing before measuring independently prepared publication and collection cases.
const reviewerWarmup = await reviewerFixture("check");
await saveReviewOutcome(reviewerWarmup, "passed");
await navigate({ id: reviewerWarmup.run.id, operation: "collect" }, {}, reviewerWarmup.io);
const dispatchRun = await reviewerFixture("check");
await saveReviewOutcome(dispatchRun, "passed");
const reviewCases: { choice: "approved" | "changes"; target: "finish" | "check" }[] = [
	{ choice: "approved", target: "finish" },
	{ choice: "changes", target: "check" },
];
const reviewRuns = new Map(
	await Promise.all(
		reviewCases.map(async ({ choice }) => {
			const fixture = await reviewerFixture("review");
			await saveReviewOutcome(fixture, choice);
			return [choice, fixture] as const;
		}),
	),
);

const repairRun = await reviewerFixture("review");
const previousReview = repairRun.run.active[FIRST]!;
await saveReviewOutcome(repairRun, "changes");
repairRun.run = await navigate({ id: repairRun.run.id, operation: "collect" }, {}, repairRun.io);
await saveReviewOutcome(repairRun, "passed");

// The authored workflow drives dispatch; only the process and tracker adapters are replaced.
// eslint-disable-next-line max-statements
test("Land dispatches its existing review visit after the driver's passing checks #test-393", async () => {
	const { beads, calls, io, run, scope } = dispatchRun;
	expect(calls).toEqual([]);
	const reviewing = await navigate({ id: run.id, operation: "collect" }, {}, io);
	const stage = reviewing.active[FIRST]!;
	expect(stage.title).toBe(`${titles.review}: worktree ${worktreeTarget.branch}`);
	expect(calls[FIRST]!.slice(FIRST, DISPATCH_PREFIX)).toEqual([
		"bee",
		"system",
		"dispatch-stage",
		"reviewer",
		stage.bead,
		"--run",
		run.id,
	]);
	const task = await beads.show(scope, stage.bead);
	expect(task).toMatchObject({
		dependencies: expect.arrayContaining([
			expect.objectContaining({ id: run.id, dependency_type: "parent-child" }),
		]),
	});
	expect(task.assignee).toBeUndefined();
	expect(await beads.show(scope, stage.request!)).toMatchObject({
		description: expect.stringContaining(
			JSON.stringify({ kind: "stage", runId: run.id, stageId: stage.bead }),
		),
	});
	expect(await navigate({ id: run.id, operation: "collect" }, {}, io)).toEqual(reviewing);
	expect(calls).toHaveLength(ONE_REQUEST);
});

test.each(reviewCases)(
	"Land collects reviewer $choice into driver-owned $target #test-521",
	async ({ choice, target }) => {
		const { beads, calls, io, run, scope } = reviewRuns.get(choice)!;
		const next = await navigate({ id: run.id, operation: "collect" }, {}, io);
		expect(next.active).toMatchObject([
			{ title: `${titles[target]}: worktree ${worktreeTarget.branch}`, context: { evidence } },
		]);
		expect(next.active[FIRST]!.request).toBeNull();
		expect(await beads.show(scope, next.active[FIRST]!.bead)).toMatchObject({
			assignee: "land-driver",
		});

		expect(calls).toHaveLength(ONE_REQUEST);
	},
);

test("Land dispatches a fresh reviewer visit after driver repair and checks", async () => {
	const { beads, calls, io, run, scope } = repairRun;
	const next = await navigate({ id: run.id, operation: "collect" }, {}, io);
	const stage = next.active[FIRST]!;
	expect(stage.title).toBe(`${titles.review}: worktree ${worktreeTarget.branch}`);
	expect(await beads.show(scope, previousReview.bead)).toMatchObject({
		status: "closed",
		notes: JSON.stringify({ choice: "changes", data: outcome }),
	});
	expect(stage.bead).not.toBe(previousReview.bead);
	expect(stage.request).not.toBe(previousReview.request);
	expect(calls.at(-ONE_REQUEST)!.slice(FIRST, DISPATCH_PREFIX)).toEqual([
		"bee",
		"system",
		"dispatch-stage",
		"reviewer",
		stage.bead,
		"--run",
		run.id,
	]);
});

test.each(paths)(
	"the actual land chart navigates $name without executing landing effects #test-405",
	({ target, steps }) => {
		const input = landingInput("/selected/beads.db", "/surviving", target);
		let snapshot = assertPureTransition(initialTransition(machine, input));
		let task = landingTask(snapshot);
		for (const [stage, choice] of steps) {
			assertChartTask(task, { choice, stage }, input);
			snapshot = advanceChart(snapshot, choice);
			if (snapshot.status === "active") {
				task = landingTask(snapshot);
				expect(task.instructions).toContain(evidence);
			}
		}
		expect(snapshot.status).toBe("done");
	},
);

test.each(closureCases)(
	"$caller closes proven tasks after the Land run (completeParent: $completeParent) #test-368",
	// Verify durable evidence and caller ordering as one lifecycle.
	// eslint-disable-next-line max-statements
	async (entry) => {
		const { beads, io, run, scope, parent, completed, order } = closureRuns.get(
			JSON.stringify(entry),
		)!;
		const stage = run.active[FIRST]!.bead;
		expect(await beads.show(scope, completed)).toMatchObject({ status: "open" });
		expect(await beads.comments.list(scope, run.id)).toMatchObject([{ text: evidence }]);
		await beads.close(scope, stage);
		const done = await navigate({ id: run.id, operation: "collect" }, {}, io);
		expect(done).toMatchObject({ status: "done", active: [] });
		expect(await beads.show(scope, run.id)).toMatchObject({ status: "closed" });
		expect(await beads.show(scope, completed)).toMatchObject({ status: "open" });
		await beads.close(scope, completed, { reason: evidence });
		order.push("SIMULATED final publication");
		expect(order).toEqual([stage, run.id, completed, "SIMULATED final publication"]);
		let parentStatus = "open";
		if (entry.completeParent) {
			parentStatus = "closed";
		}
		expect(await beads.show(scope, parent)).toMatchObject({ status: parentStatus });
	},
);

test("Land retains caller authorization and task references in its run brief", () => {
	const input = landingInput("/selected/beads.db", "/surviving", worktreeTarget);
	const brief = runBrief(input);
	expect(brief.title).toBe("Land worktree simulated-work");
	for (const retained of [
		input.request,
		input.beadsDb,
		input.canonicalRoot,
		"simulated-task-reference",
	]) {
		expect(brief.description).toContain(retained);
	}
});

test("Land verifies integration before updating local tools and completing", () => {
	const [check] = initialTransition(
		machine,
		landingInput("/selected/beads.db", "/surviving", worktreeTarget),
	);
	const verify = advanceChart(check, "integrated");
	expect(verify.value).toBe("verify");
	expect(landingTask(verify).instructions).toContain("/surviving");
	const update = advanceChart(verify, "next");
	expect(update).toMatchObject({ status: "active", value: "local-update" });
	expect(landingTask(update).instructions).toMatch(
		/bun install --frozen-lockfile.*bun run --filter '\*' build.*bun run --filter '\*' install:bin/u,
	);
	expect(advanceChart(update, "next").status).toBe("done");
});

describe("land definition loading", () => {
	test("a land run requires retained input before publishing any tasks #test-21", async () => {
		const repo = "/land-input";
		const beads = createMemoryBeads();
		const scope = { cwd: repo };
		const parent = await beads.create(
			{ ...scope, actor: "test-agent" },
			{ title: "Original work", owner: "test-human" },
		);
		const selection = { all: true, limit: 0 };
		const services = {
			...createServices(),
			actor: "test-agent",
			beads,
			cwd: repo,
			beforeWrite: () => {
				throw new Error("Invalid retained input must fail before publication");
			},
			execute: () => Promise.resolve(repo),
			importModule: () => Promise.resolve({ commandSchemas, inputSchema, machine, runBrief }),
			isFile: () => Promise.resolve(true),
			readBytes: () => Promise.resolve(new ArrayBuffer(FIRST)),
			readDirectory: () => Promise.resolve([{ kind: "file" as const, name: "workflow.ts" }]),
			readText: () => Promise.resolve(manifest),
		};
		const before = await beads.list(scope, selection);
		await expect(
			invoke(["--owner", "test-human", "--parent", parent.id, "run", "land"], services),
		).resolves.toMatchObject({ document: { ok: false, reason: "invalid_input" } });
		expect(await beads.list(scope, selection)).toEqual(before);
	});
});

// --- Private helpers ---

// Only memory Beads and the real chart/runtime execute here; no landing or publication process runs.
// eslint-disable-next-line max-statements
async function closureFixture({ caller, completeParent }: (typeof closureCases)[number]) {
	const repo = "/land-closure";
	const scope = { actor: caller, cwd: repo };
	const beads = createMemoryBeads();
	const parent = await beads.create(scope, { title: "Original work", owner: "ct" });
	let completed = parent;
	if (!completeParent) {
		completed = await beads.create(scope, { title: "Authorized scope", parent: parent.id });
		await beads.create(scope, { title: "Unrelated unfinished work", parent: parent.id });
	}
	const input = {
		...landingInput("/selected/beads.db", "/surviving", worktreeTarget),
		completedTasks: [completed.id],
	};
	const order: string[] = [];
	const io = {
		...createServices(),
		actor: caller,
		cwd: repo,
		beads: {
			...beads,
			close: async (...args: Parameters<typeof beads.close>) => {
				const result = await beads.close(...args);
				order.push(args[ID_ARGUMENT]);
				return result;
			},
		},
		importModule: () => Promise.resolve({ commandSchemas, inputSchema, machine, runBrief }),
		readBytes: () => Promise.resolve(new ArrayBuffer(FIRST)),
		readText: () => Promise.resolve(JSON.stringify(input)),
		execute: () => Promise.reject(new Error("Land traversal must not execute processes")),
	};
	let run = await start(
		"workflow.ts",
		{ owner: "ct", parent: parent.id, inputFile: "input.json" },
		io,
	);
	// Each frontier depends on collection of the preceding visit.
	/* eslint-disable no-await-in-loop */
	for (const choice of ["integrated", "next"]) {
		const stage = run.active[FIRST]!.bead;
		await recordResult({ id: run.id, bead: stage, choice, data: outcome }, {}, io);
		await beads.close(scope, stage);
		run = await navigate({ id: run.id, operation: "collect" }, {}, io);
	}
	/* eslint-enable no-await-in-loop */
	await beads.comments.add(scope, run.id, evidence);
	await recordResult(
		{ id: run.id, bead: run.active[FIRST]!.bead, choice: "next", data: outcome },
		{},
		io,
	);
	return { beads: io.beads, completed: completed.id, io, order, parent: parent.id, run, scope };
}

// Prepare the authored frontier with only memory tracker and process adapters.
// eslint-disable-next-line max-statements
async function reviewerFixture(initial: "check" | "review") {
	const repo = "/land-review";
	const db = "/land-review-tracker/beads.db";
	const scope = { actor: "land-driver", cwd: repo, db };
	const beads = createMemoryBeads({ db });
	const calls: string[][] = [];
	const input = landingInput(db, "/surviving", worktreeTarget);
	const io = {
		...createServices(),
		actor: scope.actor,
		cwd: repo,
		beads,
		importModule: () => Promise.resolve({ commandSchemas, inputSchema, machine, runBrief }),
		readBytes: () => Promise.resolve(new ArrayBuffer(FIRST)),
		readText: () => Promise.resolve(JSON.stringify(input)),
		execute: async (argv: string[]) => {
			calls.push(argv);
			const stageId = argv[DISPATCH_STAGE_ARGUMENT]!;
			const runId = argv[DISPATCH_RUN_ARGUMENT]!;
			const request = await beads.create(scope, {
				title: "Simulated reviewer request",
				owner: "ct",
				assignee: "simulated-reviewer",
				labels: spawnRequestLabels("reviewer"),
				description: JSON.stringify({
					cwd: repo,
					effort: "low",
					harness: "fixture",
					kind: "reviewer",
					model: "fixture",
					prompt: "Review assigned visit",
					system_prompt: "Reviewer",
					assignment: { kind: "stage", runId, stageId },
				}),
			});
			await beads.dep.add(scope, request.id, stageId, "related");
			return JSON.stringify({ ok: true, request: { id: request.id } });
		},
	};
	const parent = await beads.create(scope, { title: "Original work", owner: "ct" });
	const run = await start(
		"workflow.ts",
		{ owner: "ct", assignee: scope.actor, parent: parent.id, inputFile: "input.json" },
		io,
	);
	if (initial === "review") {
		const check = run.active[FIRST]!.bead;
		await recordResult({ id: run.id, bead: check, choice: "passed", data: outcome }, {}, io);
		await beads.close(scope, check);
	}
	return {
		beads,
		calls,
		io,
		run: await navigate({ id: run.id, operation: "collect" }, {}, io),
		scope,
	};
}

async function saveReviewOutcome(
	fixture: Awaited<ReturnType<typeof reviewerFixture>>,
	choice: Choice,
) {
	const { beads, io, run, scope } = fixture;
	const { bead } = run.active[FIRST]!;
	await recordResult({ id: run.id, bead, choice, data: outcome }, {}, io);
	await beads.close(scope, bead);
}

function assertPureTransition([snapshot, effects]: [SnapshotFrom<typeof machine>, unknown[]]) {
	expect(effects).toEqual([]);
	return snapshot;
}

function advanceChart(snapshot: SnapshotFrom<typeof machine>, choice: Choice) {
	const data = commandSchemas[choice].parse(outcome);
	return assertPureTransition(transition(machine, snapshot, { data, type: events[choice] }));
}

function landingInput(
	beadsDb: string,
	canonicalRoot: string,
	target: LandingInput["target"],
): LandingInput {
	return inputSchema.parse({
		beadsDb,
		canonicalRoot,
		completedTasks: ["simulated-task-reference"],
		request: "SIMULATED transport only: verify navigation without landing real work.",
		target,
	});
}

function assertChartTask(
	task: ResolvedTask,
	{ choice, stage }: { choice: Choice; stage: Stage },
	input: LandingInput,
): void {
	switch (input.target.kind) {
		case "worktree": {
			expect(task.title).toBe(`${titles[stage]}: worktree ${input.target.branch}`);
			break;
		}
		case "pr": {
			expect(task.title).toBe(`${titles[stage]}: PR ${input.target.url}`);
			break;
		}
	}
	expect(task.commands?.[choice]).toBe(events[choice]);
	if (stage === "review") {
		expect(task.bee).toEqual({ kind: "reviewer" });
	} else {
		expect(task.bee).toBeUndefined();
	}
}

function landingTask(snapshot: SnapshotFrom<typeof machine>): ResolvedTask {
	const metadata = metadataSchema.parse(Object.values(snapshot.getMeta())[FIRST]);
	return renderTask(metadata, { ...snapshot.context });
}
