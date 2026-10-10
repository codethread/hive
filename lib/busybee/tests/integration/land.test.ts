/* eslint-disable import/no-nodejs-modules -- Land integration deletes only disposable feature checkouts. */
import { commandSchemas, inputSchema, machine } from "../../../../.workflows/land/workflow.ts";
import { cp, mkdir } from "node:fs/promises";
import { createRepository, invoke, issueIds, optionsArgs, useNativeFixture } from "./support.ts";
import { describe, expect, test } from "bun:test";
import { initialTransition, transition } from "xstate";
import { metadataSchema, resolvedTaskSchema } from "../../src/definition.ts";
import type { ResolvedTask } from "../../src/definition.ts";
import type { SnapshotFrom } from "xstate";
import { join } from "node:path";
import manifest from "../../../../.workflows/land/busybee.toml" with { type: "text" };

const FIRST = 0;
const worktreeTarget = { kind: "worktree", branch: "simulated-work" } as const;
const renderedTaskSchema = resolvedTaskSchema.partial();
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
		name: "unfinished work, failed checks, review findings, changed commits and retriage",
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
		name: "PR fixes, rebuttals, stale review, late feedback and fresh readiness",
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
		name: "reviewed PR already merged remotely",
		target: { kind: "pr", url: "https://github.com/example/repo/pull/2" },
		steps: [["triage", "reviewed"], ["pr", "integrated"], ...completion],
	},
	{
		name: "worktree already integrated",
		target: { kind: "worktree", branch: "already-integrated" },
		steps: [["triage", "integrated"], ...completion],
	},
	{
		name: "checks already passed without local approval",
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
		name: "reviewed content not yet committed",
		target: { kind: "worktree", branch: "reviewed-not-committed" },
		steps: [["triage", "commit"], ["commit", "next"], ["finish", "next"], ...completion],
	},
];

test.each(paths)(
	"the actual land chart navigates $name without executing landing effects",
	({ target, steps }) => {
		const input = landingInput("/selected/beads.db", "/surviving", target);
		let [snapshot, effects] = initialTransition(machine, input);
		expect(effects).toEqual([]);
		for (const [stage, choice] of steps) {
			assertChartTask(snapshot, { choice, stage }, input);
			[snapshot, effects] = transition(machine, snapshot, {
				data: commandSchemas[choice].parse(payload(choice)),
				type: events[choice],
			});
			expect(effects).toEqual([]);
			if (snapshot.status === "active") {
				expect(landingTask(snapshot).instructions).toContain(evidence);
			}
		}
		expect(snapshot.status).toBe("done");
	},
);

test("landing briefs keep the passing check gate with the worker before agent review", () => {
	const input = landingInput("/selected/beads.db", "/surviving", worktreeTarget);
	const [triage] = initialTransition(machine, input);
	const [check] = transition(machine, triage, { data: outcome, type: "CHECK" });
	expect(landingTask(check).instructions).toContain("Run `bun run check` for the complete change");
	expect(landingTask(check).instructions).toContain(
		"Choose passed only when `bun run check` exits successfully for that revision",
	);
	const [reviewing] = transition(machine, check, { data: outcome, type: "PASSED" });
	expect(landingTask(reviewing).instructions).toContain(
		"reviewer consultation only after `bun run check` passes for this revision",
	);
	expect(landingTask(reviewing).instructions).toContain(
		"reviewer assesses code and test quality without rerunning checks or auditing test-run evidence",
	);
});

describe("native land navigation and continuation", () => {
	const fixture = useNativeFixture("busybee-land-");

	test("a land run requires retained input before publishing any tasks", async () => {
		const { feature } = await portableDefinitions();
		const before = await issueIds(fixture);
		await expect(
			invoke([...optionsArgs(fixture), "--repo", feature, "run", "land"], fixture.services),
		).resolves.toMatchObject({ document: { ok: false, reason: "invalid_input" } });
		expect(await issueIds(fixture)).toEqual(before);
	});

	async function portableDefinitions() {
		const feature = join(fixture.root, "feature");
		const surviving = join(fixture.root, "surviving");
		await Promise.all([createRepository(fixture, feature), createRepository(fixture, surviving)]);
		await Promise.all([installDefinition(feature), installDefinition(surviving)]);
		return { feature, surviving };
	}

	async function installDefinition(repo: string) {
		const folder = join(repo, ".workflows/land");
		await mkdir(folder, { recursive: true });
		await cp(
			new URL("../../../../.workflows/land/workflow.ts", import.meta.url),
			join(folder, "workflow.ts"),
		);
		await Bun.write(join(folder, "busybee.toml"), manifest);
	}
});

// --- Private helpers ---

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
	snapshot: SnapshotFrom<typeof machine>,
	{ choice, stage }: { choice: Choice; stage: Stage },
	input: LandingInput,
): void {
	const task = landingTask(snapshot);
	expect(task.title).toBe(titles[stage]);
	expect(task.commands?.[choice]).toBe(events[choice]);
	assertRetainedContext(task.instructions, input);
}

function landingTask(snapshot: SnapshotFrom<typeof machine>): ResolvedTask {
	const metadata = metadataSchema.parse(Object.values(snapshot.getMeta())[FIRST]);
	const rendered = renderedTaskSchema.parse(metadata.task!({ context: { ...snapshot.context } }));
	return resolvedTaskSchema.parse({ ...metadata, ...rendered });
}

function assertRetainedContext(instructions: string, input: LandingInput): void {
	expect(instructions).toContain(input.canonicalRoot);
	expect(instructions).toContain(input.beadsDb);
	expect(instructions).toContain(input.request);
	expect(instructions).toContain("simulated-task-reference");
	expect(instructions).toContain(JSON.stringify(input.target));
	expect(instructions).toContain("None yet; record final commits before integration");
}
