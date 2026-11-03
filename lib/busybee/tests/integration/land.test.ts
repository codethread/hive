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

test("Land verifies integration before updating local tools and completing #test-606", () => {
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
