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
const review = {
	base: "simulated-base",
	bead: "simulated-prior-review",
	revision: "simulated-diff",
};
const reviewed = { evidence, review };
const titles = {
	triage: "Triage the authorized landing",
	implement: "Complete implementation or repair findings",
	check: "Tidy and check the complete change",
	review: "Review the current change locally",
	commit: "Commit the reviewed change",
	pr: "Check PR readiness",
	comments: "Verify and act on PR feedback",
	finish: "Integrate the approved work",
	verify: "Verify integration and clean up the worktree",
	"local-update": "Build and update local tools",
	publish: "Record landing completion evidence",
	report: "Deliver the landing report to the caller",
};
const events = {
	addressed: "ADDRESSED",
	approved: "APPROVED",
	changed: "CHANGED",
	changes: "CHANGES",
	check: "CHECK",
	commit: "COMMIT",
	feedback: "FEEDBACK",
	implement: "IMPLEMENT",
	integrated: "INTEGRATED",
	next: "NEXT",
	passed: "PASSED",
	ready: "READY",
	rebutted: "REBUTTED",
	retriage: "RETRIAGE",
	review: "REVIEW",
	reviewed: "REVIEWED",
} as const;
type LandingInput = ReturnType<typeof inputSchema.parse>;
type Stage = keyof typeof titles;
type Choice = keyof typeof events;
type TraceStep = readonly [Stage, Choice];
const completion: TraceStep[] = [
	["verify", "next"],
	["local-update", "next"],
	["publish", "next"],
	["report", "next"],
];
const paths: { name: string; target: LandingInput["target"]; steps: TraceStep[] }[] = [
	{
		name: "unfinished work, failed checks, review findings, changed commits and retriage #test-27",
		target: { kind: "worktree", branch: "simulated-work" },
		steps: [
			["triage", "implement"],
			["implement", "next"],
			["check", "changes"],
			["implement", "next"],
			["check", "passed"],
			["review", "changes"],
			["implement", "next"],
			["check", "passed"],
			["review", "approved"],
			["commit", "changed"],
			["check", "passed"],
			["review", "approved"],
			["commit", "next"],
			["finish", "retriage"],
			["triage", "reviewed"],
			["finish", "next"],
			...completion,
		],
	},
	{
		name: "PR fixes, rebuttals, stale review, late feedback and fresh readiness #test-23",
		target: { kind: "pr", url: "https://github.com/example/repo/pull/1" },
		steps: [
			["triage", "check"],
			["check", "passed"],
			["review", "approved"],
			["commit", "next"],
			["pr", "feedback"],
			["comments", "changes"],
			["implement", "next"],
			["check", "passed"],
			["review", "approved"],
			["commit", "next"],
			["pr", "feedback"],
			["comments", "rebutted"],
			["pr", "review"],
			["review", "approved"],
			["commit", "next"],
			["pr", "ready"],
			["finish", "feedback"],
			["comments", "addressed"],
			["pr", "changes"],
			["implement", "next"],
			["check", "passed"],
			["review", "approved"],
			["commit", "next"],
			["pr", "ready"],
			["finish", "next"],
			...completion,
		],
	},
	{
		name: "reviewed PR already merged remotely #test-25",
		target: { kind: "pr", url: "https://github.com/example/repo/pull/2" },
		steps: [["triage", "reviewed"], ["pr", "integrated"], ...completion],
	},
	{
		name: "worktree already integrated #test-28",
		target: { kind: "worktree", branch: "already-integrated" },
		steps: [["triage", "integrated"], ...completion],
	},
	{
		name: "checks already passed without local approval #test-24",
		target: { kind: "worktree", branch: "checks-already-passed" },
		steps: [
			["triage", "review"],
			["review", "approved"],
			["commit", "next"],
			["finish", "next"],
			...completion,
		],
	},
	{
		name: "reviewed content not yet committed #test-26",
		target: { kind: "worktree", branch: "reviewed-not-committed" },
		steps: [["triage", "commit"], ["commit", "next"], ["finish", "next"], ...completion],
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
await saveReviewOutcome(reviewerWarmup, "passed", outcome);
await navigate({ id: reviewerWarmup.run.id, operation: "collect" }, {}, reviewerWarmup.io);
const dispatchRun = await reviewerFixture("check");
await saveReviewOutcome(dispatchRun, "passed", outcome);
const reviewCases: { choice: "approved" | "changes"; target: "commit" | "implement" }[] = [
	{ choice: "approved", target: "commit" },
	{ choice: "changes", target: "implement" },
];
const reviewRuns = new Map(
	await Promise.all(
		reviewCases.map(async ({ choice }) => {
			const fixture = await reviewerFixture("review");
			let data: typeof outcome | typeof reviewed = outcome;
			const receipt = { ...review, bead: fixture.run.active[FIRST]!.bead };
			if (choice === "approved") {
				data = { evidence, review: receipt };
			}
			await saveReviewOutcome(fixture, choice, data);
			return [choice, { ...fixture, receipt }] as const;
		}),
	),
);

const repairRun = await reviewerFixture("review");
const previousReview = repairRun.run.active[FIRST]!;
await saveReviewOutcome(repairRun, "changes", outcome);
repairRun.run = await navigate({ id: repairRun.run.id, operation: "collect" }, {}, repairRun.io);
await saveReviewOutcome(repairRun, "next", outcome);
repairRun.run = await navigate({ id: repairRun.run.id, operation: "collect" }, {}, repairRun.io);
await saveReviewOutcome(repairRun, "passed", outcome);

// The authored workflow drives dispatch; only the process and tracker adapters are replaced.
// eslint-disable-next-line max-statements
test("Land dispatches its existing review visit after the driver's passing checks", async () => {
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
	"Land collects reviewer $choice into driver-owned $target",
	async ({ choice, target }) => {
		const { beads, calls, io, run, scope, receipt } = reviewRuns.get(choice)!;
		const next = await navigate({ id: run.id, operation: "collect" }, {}, io);
		expect(next.active).toMatchObject([
			{ title: `${titles[target]}: worktree ${worktreeTarget.branch}`, context: { evidence } },
		]);
		expect(next.active[FIRST]!.request).toBeNull();
		expect(await beads.show(scope, next.active[FIRST]!.bead)).toMatchObject({
			assignee: "land-driver",
		});
		if (choice === "approved") {
			expect(next.active[FIRST]!.context["review"]).toEqual(receipt);
		} else {
			expect(next.active[FIRST]!.context["review"]).toBeUndefined();
		}
		expect(calls).toHaveLength(ONE_REQUEST);
	},
);

test("Land dispatches a fresh reviewer visit after driver repair and checks", async () => {
	const { calls, io, run } = repairRun;
	const next = await navigate({ id: run.id, operation: "collect" }, {}, io);
	const stage = next.active[FIRST]!;
	expect(stage.title).toBe(`${titles.review}: worktree ${worktreeTarget.branch}`);
	expect(stage.bead).not.toBe(previousReview.bead);
	expect(stage.request).not.toBe(previousReview.request);
	expect(stage.context["review"]).toBeUndefined();
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
	"the actual land chart navigates $name without executing landing effects",
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

test("landing briefs keep the passing check gate with the worker before agent review #test-22", () => {
	const input = landingInput("/selected/beads.db", "/surviving", worktreeTarget);
	const [triage] = initialTransition(machine, input);
	const [check] = transition(machine, triage, { data: outcome, type: "CHECK" });
	const checkTask = landingTask(check);
	expect(checkTask.instructions).toContain("Run `bun run check` for the complete change");
	expect(checkTask.instructions).toContain(
		"Choose passed only when `bun run check` exits successfully",
	);
	const [reviewing] = transition(machine, check, { data: outcome, type: "PASSED" });
	const reviewTask = landingTask(reviewing);
	expect(reviewTask.instructions).toContain(
		"driver owns the passing `bun run check` prerequisite and its evidence",
	);
	expect(reviewTask.instructions).toContain(
		"Assess code and test quality without rerunning checks or auditing test-run evidence",
	);
});

test.each(closureCases)(
	"$caller closes proven tasks after the Land run (completeParent: $completeParent)",
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

test("Land retains caller scope and failure handoff independently of its final visit", () => {
	const input = landingInput("/selected/beads.db", "/surviving", worktreeTarget);
	const brief = runBrief(input);
	expect(brief.title).toBe("Land worktree simulated-work");
	for (const retained of [
		"Authorized completedTasks: simulated-task-reference",
		input.beadsDb,
		input.canonicalRoot,
		"run's comments before its final visit closes",
		"standalone Land caller or Land driver",
		"After Busy Bee reports status done",
		"Generic driver success requires only its run anchor done",
		"unfinished external task/operation, blocker and next action",
		"neither reopen or replace it nor rely on bee retry",
	]) {
		expect(brief.description).toContain(retained);
	}
});

test("Land requires a verified local build and installation before completion evidence", () => {
	const [triage] = initialTransition(
		machine,
		landingInput("/selected/beads.db", "/surviving", worktreeTarget),
	);
	const verify = advanceChart(triage, "integrated");
	const update = advanceChart(verify, "next");
	expect(update).toMatchObject({ status: "active", value: "local-update" });
	const task = landingTask(update);
	expect(task.commands).toEqual({ next: "NEXT" });
	expect(task.instructions).toMatch(
		/bun install --frozen-lockfile.*bun run --filter '\*' build.*bun run --filter '\*' install:bin/u,
	);
	for (const requirement of [
		"canonicalRoot on clean synchronized main",
		"Only after the full build succeeds",
		"every installed artifact matches its fresh package dist/ build",
		"user's PATH",
		"keeps this task open with diagnostics",
	]) {
		expect(task.instructions).toContain(requirement);
	}
	expect(advanceChart(update, "next").value).toBe("publish");
});

test("the actual Land completion visits deliver evidence before the caller tail", () => {
	const input = landingInput("/selected/beads.db", "/surviving", worktreeTarget);
	const [triage] = initialTransition(machine, input);
	const verify = advanceChart(triage, "integrated");
	const update = advanceChart(verify, "next");
	const publish = advanceChart(update, "next");
	expect(landingTask(publish).instructions).toContain(
		"Keep external tasks open until Busy Bee reports this run done",
	);
	expect(landingTask(publish).instructions).toContain(
		"on this stage, the run and the authorized completedTasks",
	);
	const report = advanceChart(publish, "next");
	expect(landingTask(report).instructions).toContain(
		"caller reads the retained run brief and comments to perform the post-done tail",
	);
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
	for (const choice of ["integrated", "next", "next", "next"]) {
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
	const triage = run.active[FIRST]!.bead;
	await recordResult({ id: run.id, bead: triage, choice: initial, data: outcome }, {}, io);
	await beads.close(scope, triage);
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
	choice: string,
	data: typeof outcome | typeof reviewed,
) {
	const { beads, io, run, scope } = fixture;
	const { bead } = run.active[FIRST]!;
	await recordResult({ id: run.id, bead, choice, data }, {}, io);
	await beads.close(scope, bead);
}

function assertPureTransition([snapshot, effects]: [SnapshotFrom<typeof machine>, unknown[]]) {
	expect(effects).toEqual([]);
	return snapshot;
}

function advanceChart(snapshot: SnapshotFrom<typeof machine>, choice: Choice) {
	const data = commandSchemas[choice].parse(payload(choice));
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
		expectedCommits: [],
		request: "SIMULATED transport only: verify navigation without landing real work.",
		target,
	});
}

function payload(choice: Choice) {
	if (["approved", "commit", "reviewed"].includes(choice)) {
		return reviewed;
	}
	return outcome;
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
	assertRetainedContext(task.instructions, input);
}

function landingTask(snapshot: SnapshotFrom<typeof machine>): ResolvedTask {
	const metadata = metadataSchema.parse(Object.values(snapshot.getMeta())[FIRST]);
	return renderTask(metadata, { ...snapshot.context });
}

function assertRetainedContext(instructions: string, input: LandingInput): void {
	expect(instructions).toContain(input.canonicalRoot);
	expect(instructions).toContain(input.beadsDb);
	expect(instructions).toContain(input.request);
	expect(instructions).toContain("simulated-task-reference");
	expect(instructions).toContain(JSON.stringify(input.target));
	expect(instructions).toContain("None yet; record final commits before integration");
}
