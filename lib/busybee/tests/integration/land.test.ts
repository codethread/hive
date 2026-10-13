import {
	commandSchemas,
	inputSchema,
	machine,
	runBrief,
} from "../../../../.workflows/land/workflow.ts";
import { describe, expect, test } from "bun:test";
import { initialTransition, transition } from "xstate";
import { metadataSchema, renderTask } from "../../src/definition.ts";
import type { ResolvedTask } from "../../src/definition.ts";
import type { SnapshotFrom } from "xstate";
import { createMemoryBeads } from "@hive/beads";
import { createServices } from "../../src/native.ts";
import { invoke } from "./support.ts";
import manifest from "../../../../.workflows/land/busybee.toml" with { type: "text" };

const FIRST = 0;
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
	publish: "Record completed task state",
	report: "Report landing and publish final bookkeeping",
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
		"Choose passed only when `bun run check` exits successfully for that revision",
	);
	const [reviewing] = transition(machine, check, { data: outcome, type: "PASSED" });
	const reviewTask = landingTask(reviewing);
	expect(reviewTask.instructions).toContain(
		"reviewer consultation only after `bun run check` passes for this revision",
	);
	expect(reviewTask.instructions).toContain(
		"reviewer assesses code and test quality without rerunning checks or auditing test-run evidence",
	);
});

describe("land definition loading", () => {
	test("a land run requires retained input before publishing any tasks #test-21", async () => {
		const repo = "/land-input";
		const beads = createMemoryBeads();
		const scope = { cwd: repo };
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
		await expect(invoke(["--owner", "test-human", "run", "land"], services)).resolves.toMatchObject(
			{ document: { ok: false, reason: "invalid_input" } },
		);
		expect(await beads.list(scope, selection)).toEqual(before);
	});
});

// --- Private helpers ---

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
	expect(task.title).toBe(titles[stage]);
	expect(task.commands?.[choice]).toBe(events[choice]);
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
