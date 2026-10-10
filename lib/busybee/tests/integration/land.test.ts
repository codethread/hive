/* eslint-disable import/no-nodejs-modules -- Land integration deletes only disposable feature checkouts. */
import {
	assertUnchanged,
	close,
	createRepository,
	invoke,
	issueIds,
	observations,
	optionsArgs,
	record,
	useNativeFixture,
	view,
} from "./support.ts";
import { commandSchemas, inputSchema, machine } from "../../../../.workflows/land/workflow.ts";
import { cp, mkdir, rm } from "node:fs/promises";
import { describe, expect, test } from "bun:test";
import { initialTransition, transition } from "xstate";
import { metadataSchema, resolvedTaskSchema } from "../../src/definition.ts";
import type { ResolvedTask } from "../../src/definition.ts";
import type { RunView } from "../../src/runtime.ts";
import type { SnapshotFrom } from "xstate";
import { join } from "node:path";
import manifest from "../../../../.workflows/land/busybee.toml" with { type: "text" };
import { tracker } from "../../src/native.ts";

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
interface LandingStory {
	/** Retained input for the disposable workflow run. */
	input: LandingInput;
	/** Current execution checkout, changed only when the disposable feature is removed. */
	repo: string;
	/** Latest published frontier and visit history. */
	run: RunView;
}
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

// eslint-disable-next-line max-statements -- Register related native scenarios and their fixture-scoped story helpers together.
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

	test("an unclosed worker cannot advance and discovery exposes review receipt constraints", async () => {
		const story = await startLand();
		const task = current(story, "triage");
		const command = [
			...optionsArgs(fixture),
			"--repo",
			story.repo,
			"choice",
			story.run.id,
			task.bead,
		];
		await expect(
			invoke([...command, "implement", "--data", JSON.stringify(outcome)], fixture.services),
		).resolves.toMatchObject({ document: { ok: false, reason: "task_not_closed" } });
		const discovery = await invoke(
			[...optionsArgs(fixture), "--repo", story.repo, "discover", story.run.id],
			fixture.services,
		);
		expect(discovery.document).toMatchObject({
			active: [
				{ choices: expect.arrayContaining([{ choice: "reviewed", schema: expect.any(Object) }]) },
			],
		});
		const shown = await view(fixture, ["--repo", story.repo, "show", story.run.id]);
		expect(shown.active).toEqual(story.run.active);
	});

	test.each([
		{ choice: "implement", data: {}, mode: "missing evidence" },
		{ choice: "reviewed", data: outcome, mode: "missing reviewed receipt" },
		{ choice: "commit", data: outcome, mode: "missing commit receipt" },
		{ choice: "reviewed", data: { evidence, review: {} }, mode: "malformed receipt" },
		{ choice: "skip", data: outcome, mode: "unknown outcome" },
	])(
		"a closed worker rejects $mode without publication or advancement",
		async ({ choice, data }) => {
			const story = await startLand();
			const task = current(story, "triage");
			await close(fixture, task.bead);
			const before = await observations(fixture, story.run.id);
			const rejected = await invoke(
				[
					...optionsArgs(fixture),
					"--repo",
					story.repo,
					"choice",
					story.run.id,
					task.bead,
					choice,
					"--data",
					JSON.stringify(data),
				],
				fixture.services,
			);
			expect(rejected.document).toMatchObject({ ok: false });
			await assertUnchanged(fixture, before);
			const shown = await view(fixture, ["--repo", story.repo, "show", story.run.id]);
			expect(shown.active).toEqual(story.run.active);
		},
	);

	test("failed checks create a fresh implementation visit", async () => {
		const story = await startLand();
		await step(story, "triage", "implement");
		const firstImplementation = current(story, "implement").bead;
		await step(story, "implement", "next");
		await step(story, "check", "changes");
		expect(current(story, "implement").bead).not.toBe(firstImplementation);
	});

	test("local findings clear approval and the repaired visit creates a fresh review", async () => {
		const story = await startLand();
		await step(story, "triage", "review");
		const firstReview = current(story, "review").bead;
		await step(story, "review", "changes");
		expect(current(story, "implement").instructions).toContain(
			'Local review receipt: "No current approval"',
		);
		await step(story, "implement", "next");
		await step(story, "check", "passed");
		expect(current(story, "review").bead).not.toBe(firstReview);
	});

	test("commit content changes invalidate recorded approval until a fresh closed review supplies it", async () => {
		const story = await startLand();
		await step(story, "triage", "review");
		const firstReceipt = await approve(story);
		expect(current(story, "commit").instructions).toContain(firstReceipt.bead);
		await step(story, "commit", "changed");
		expect(current(story, "check").instructions).toContain(
			'Local review receipt: "No current approval"',
		);
		await step(story, "check", "passed");
		const freshReceipt = await approve(story);
		expect(freshReceipt.bead).not.toBe(firstReceipt.bead);
		expect(current(story, "commit").instructions).toContain(freshReceipt.bead);
	});

	test("a run resumes from a surviving checkout and rejects PR-only feedback for worktree targets", async () => {
		const { feature, surviving } = await portableDefinitions();
		const story = await startLand(
			{ kind: "worktree", branch: "simulated-work" },
			feature,
			surviving,
		);
		await step(story, "triage", "reviewed");
		expect(current(story, "finish").instructions).toContain(review.bead);
		await rm(feature, { recursive: true });
		story.repo = surviving;
		const task = current(story, "finish");
		await rejectWorktreeFeedback(story, task.bead);
		await submit(story, task.bead, { choice: "next", data: outcome });
		await complete(story);
	});

	test("late PR feedback and a rebuttal return to readiness instead of bypassing integration gates", async () => {
		const story = await startLand({ kind: "pr", url: "https://github.com/example/repo/pull/1" });
		await step(story, "triage", "reviewed");
		await step(story, "pr", "ready");
		await step(story, "finish", "feedback");
		await step(story, "comments", "rebutted");
		current(story, "pr");
	});

	async function rejectWorktreeFeedback(story: LandingStory, bead: string) {
		await closeWorker(bead, outcome);
		const before = await observations(fixture, story.run.id);
		await expect(
			invoke(
				[
					...optionsArgs(fixture),
					"--repo",
					story.repo,
					"choice",
					story.run.id,
					bead,
					"feedback",
					"--data",
					JSON.stringify(outcome),
				],
				fixture.services,
			),
		).resolves.toMatchObject({ document: { ok: false } });
		await assertUnchanged(fixture, before);
	}

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

	async function startLand(
		target: LandingInput["target"] = worktreeTarget,
		repo = fixture.options.repo,
		canonicalRoot = fixture.options.repo,
	): Promise<LandingStory> {
		if (repo === fixture.options.repo) {
			await installDefinition(repo);
		}
		const input = landingInput(fixture.options.db, canonicalRoot, target);
		const path = join(fixture.root, "input.json");
		await Bun.write(path, JSON.stringify(input));
		const run = await view(fixture, ["--repo", repo, "run", "land", "--input-file", path]);
		return { input, repo, run };
	}

	async function step(story: LandingStory, stage: Stage, choice: Choice) {
		const data = payload(choice);
		const task = current(story, stage);
		expect(task.commands).toContain(choice);
		await closeWorker(task.bead, data);
		await submit(story, task.bead, { choice, data });
	}

	async function closeWorker(bead: string, data: object) {
		// Simulate evidence and closure in the fixture, never the instructed external operation.
		await tracker(
			fixture.options,
			["update", bead, "--actor", fixture.options.actor, "--notes", JSON.stringify(data)],
			fixture.services,
		);
		await close(fixture, bead);
	}

	async function submit(
		story: LandingStory,
		bead: string,
		{ choice, data }: { choice: Choice; data: object },
	) {
		let args = ["choice", story.run.id, bead, choice];
		if (choice === "next") {
			args = ["next", story.run.id, bead];
		}
		story.run = await view(fixture, [
			"--repo",
			story.repo,
			...args,
			"--data",
			JSON.stringify(data),
		]);
		for (const task of story.run.active) {
			assertRetainedContext(task.instructions, story.input);
			expect(task.instructions).toContain(evidence);
		}
	}

	async function approve(story: LandingStory) {
		const receipt = { ...review, bead: current(story, "review").bead };
		const command = [
			...optionsArgs(fixture),
			"--repo",
			story.repo,
			"choice",
			story.run.id,
			receipt.bead,
			"approved",
			"--data",
		];
		await closeWorker(receipt.bead, { evidence, review: receipt });
		await expect(
			invoke([...command, JSON.stringify(outcome)], fixture.services),
		).resolves.toMatchObject({ document: { ok: false, reason: "invalid_input" } });
		await submit(story, receipt.bead, { choice: "approved", data: { evidence, review: receipt } });
		const bead = await record(fixture, receipt.bead);
		expect(bead.status).toBe("closed");
		expect(bead.notes).toContain(receipt.revision);
		return receipt;
	}

	async function complete(story: LandingStory) {
		await step(story, "verify", "next");
		await step(story, "publish", "next");
		await step(story, "report", "next");
		expect(story.run.status).toBe("done");
		expect(story.run.active).toEqual([]);
		await expect(record(fixture, story.run.id)).resolves.toMatchObject({ status: "closed" });
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

function current(story: LandingStory, stage: Stage) {
	const task = story.run.active[FIRST]!;
	expect(task.title).toBe(titles[stage]);
	assertRetainedContext(task.instructions, story.input);
	return task;
}

function assertRetainedContext(instructions: string, input: LandingInput): void {
	expect(instructions).toContain(input.canonicalRoot);
	expect(instructions).toContain(input.beadsDb);
	expect(instructions).toContain(input.request);
	expect(instructions).toContain("simulated-task-reference");
	expect(instructions).toContain(JSON.stringify(input.target));
	expect(instructions).toContain("None yet; record final commits before integration");
}
