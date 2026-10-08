/* eslint-disable import/no-nodejs-modules -- Native scenarios exercise disposable repositories, executable fixtures and child processes. */
// eslint-disable-next-line import/no-unassigned-import -- The guarded child-process entrypoint is a dependency of this executable test.
import "../../bin/busybee.ts";
import { CommandError, execute } from "@hive/shared";
import {
	assertUnchanged,
	checkpoint,
	close,
	createRepository,
	invoke,
	observations,
	optionsArgs,
	record,
	useNativeFixture,
	view,
	writeDefinition,
} from "./support.ts";
import { chmod, mkdir } from "node:fs/promises";
import { createTask, readBead, tracker } from "../../src/native.ts";
import { dirname, join } from "node:path";
import { expect, test } from "bun:test";
import {
	planSchema,
	resultSchema,
	inputSchema as reviewInput,
} from "../../examples/change-review/workflow.ts";
import type { RunView } from "../../src/runtime.ts";
import type { Services } from "../../src/native.ts";
import { inputSchema as groceriesInput } from "../../examples/groceries/workflow.ts";
import { inputSchema as parallelInput } from "../../examples/parallel/workflow.ts";
import { runViewSchema } from "../../src/runtime.ts";

const fixture = useNativeFixture("busybee-native-");
const FIRST = 0;
const SECOND = 1;
const TWO = 2;
const THREE = 3;
const FOUR = 4;
const SHA_LENGTH = 40;
const EXECUTABLE_MODE = 0o755;
const DEADLINE = 10_000;
const reviewSource = new URL("../../examples/change-review/workflow.ts", import.meta.url).pathname;

interface TrackerSelection {
	/** Native BEADS_DB selects separate storage for this scenario. */
	environment: boolean;
	/** The explicit database argument must override environment selection. */
	explicit: boolean;
	/** Invocation happens outside the repository selecting the database. */
	externalCwd: boolean;
}

test("an open native child prevents worker closure and workflow submission", async () => {
	const { run, worker, child } = await workerWithChild();
	await expect(close(fixture, worker.bead)).rejects.toBeInstanceOf(CommandError);
	const before = await observations(fixture, run.id);
	const rejected = await invoke(
		[...optionsArgs(fixture), "next", run.id, worker.bead],
		fixture.services,
	);
	expect(rejected.document).toMatchObject({ ok: false, reason: "task_not_closed" });
	await assertUnchanged(fixture, before);
	await expect(record(fixture, child)).resolves.toMatchObject({ status: "open" });
});

test("a worker can close after its native children complete", async () => {
	const { worker, child } = await workerWithChild();
	await close(fixture, child);
	await close(fixture, worker.bead);
	await expect(record(fixture, worker.bead)).resolves.toMatchObject({ status: "closed" });
});

test("default native configuration advances a closed worker without changing it", async () => {
	await Bun.write(join(fixture.options.repo, ".beads/config.yaml"), "issue_prefix: test\n");
	const run = await closedSequence();
	const worker = run.active[FIRST]!;
	const completed = await record(fixture, worker.bead);
	await expect(view(fixture, ["next", run.id, worker.bead])).resolves.toMatchObject({
		status: "done",
	});
	expect(await record(fixture, worker.bead)).toEqual(completed);
});

test("discovery is read-only and the system checkpoint stays separate from human task descriptions", async () => {
	const run = await review();
	const before = await checkpoint(fixture, run.id);
	const discovery = await invoke([...optionsArgs(fixture), "discover", run.id], fixture.services);
	expect(discovery.document).toMatchObject({
		active: [
			{ choices: [{ choice: "planned", schema: { properties: { tasks: { minItems: 1 } } } }] },
		],
	});
	expect(await checkpoint(fixture, run.id)).toEqual(before);
	expect(before.labels).toContain("system");
	await expect(record(fixture, run.id)).resolves.toMatchObject({
		description: expect.not.stringContaining('"snapshot"'),
	});
	await expect(record(fixture, run.active[FIRST]!.bead)).resolves.toMatchObject({
		description: expect.not.stringContaining('"choice"'),
	});
});

test("two callers reach the same native lock revision and exactly one submission is accepted", async () => {
	const run = await closedSequence();
	const state = await checkpoint(fixture, run.id);
	const callers = racingCallers(state.id);
	try {
		const command = [...optionsArgs(fixture), "next", run.id, run.active[FIRST]!.bead];
		const results = await Promise.all([callers.submit(command), callers.submit(command)]);
		expect(callers.arrivals()).toBe(TWO);
		assertRaceOutcome(results);
	} finally {
		callers.release();
	}
});

test("a held checkpoint leaves other workflows independent and a waiter resumes after explicit release", async () => {
	const [held, independent] = await Promise.all([
		closedSequence("held"),
		closedSequence("independent"),
	]);
	const state = await holdCheckpoint(held.id);
	const waiter = waitingCaller(held);
	try {
		await waiter.observed;
		await advanceIndependentAndRelease(held, independent, state.description);
		waiter.release();
		await expect(waiter.result).resolves.toMatchObject({ document: { ok: true, status: "done" } });
	} finally {
		waiter.abort();
		await waiter.result;
	}
});

test("parallel review tasks preserve hierarchy and a stale revision cannot change the checkpoint", async () => {
	const run = await plannedReview();
	const workers = await completedReviewWorkers(run);
	const before = await observations(fixture, run.id);
	const rejected = await invoke(
		[
			...optionsArgs(fixture),
			"choice",
			run.id,
			workers[FIRST]!.bead,
			"approved",
			"--data",
			JSON.stringify(approved("old-revision")),
		],
		fixture.services,
	);
	expect(rejected.document).toMatchObject({ ok: false });
	await assertUnchanged(fixture, before);
});

test.each([
	{ ids: [], mode: "empty task list" },
	{ ids: ["same", "same"], mode: "duplicate task IDs" },
])("a review plan with $mode is rejected before checkpoint publication", async ({ ids }) => {
	const run = await review();
	const worker = run.active[FIRST]!;
	await close(fixture, worker.bead);
	const before = await observations(fixture, run.id);
	const result = await invoke(
		[
			...optionsArgs(fixture),
			"choice",
			run.id,
			worker.bead,
			"planned",
			"--data",
			JSON.stringify(invalidPlan(ids)),
		],
		fixture.services,
	);
	expect(result.document).toMatchObject({ ok: false, reason: "invalid_input" });
	await assertUnchanged(fixture, before);
	expect(before.notes).toBe("");
});

test("review findings produce repair work and a repaired visit publishes a fresh planner", async () => {
	const run = await submitReviews(await plannedReview(), ["changes", "approved"]);
	expect(run.active[FIRST]!.title).toMatch(/^Repair/u);
	await close(fixture, run.active[FIRST]!.bead);
	const next = await view(fixture, [
		"choice",
		run.id,
		run.active[FIRST]!.bead,
		"repaired",
		"--data",
		JSON.stringify({
			choice: "repaired",
			summary: "Filter before limit",
			verification: ["Fixture passes"],
		}),
	]);
	expect(next.active[FIRST]!.title).toMatch(/^Plan/u);
	expect(next.created.filter((entry) => entry.node === next.created[FIRST]!.node).length).toBe(TWO);
});

test("concurrent collectors submit scripted Bee results once without launching a model", async () => {
	const run = await collectedPlan();
	expect(run.created.length).toBe(FOUR);
	expect(run.created.filter((entry) => entry.request).length).toBe(THREE);
	for (const task of run.active.filter((entry) => entry.request)) {
		// eslint-disable-next-line no-await-in-loop -- Every current automatic reviewer needs its own closed result before collection.
		await completedResult(task.bead, approved());
	}
	const completed = await collectTogether(run);
	expect(completed.map((result) => result.status)).toEqual(["done", "done"]);
	await expect(record(fixture, run.id)).resolves.toMatchObject({ status: "closed" });
	for (const task of run.created.filter((entry) => entry.request)) {
		// eslint-disable-next-line no-await-in-loop -- Each automatic task independently exposes its native assignment.
		await expect(record(fixture, task.bead)).resolves.not.toHaveProperty("assignee");
	}
});

test("owner, initiating assignment and subsequent caller attribution stay distinct", async () => {
	const run = await assignedRun();
	await expect(record(fixture, run.id)).resolves.toMatchObject({
		assignee: "working-agent",
		created_by: "initiating-agent",
		owner: fixture.options.owner,
	});
	await expect(checkpoint(fixture, run.id)).resolves.not.toHaveProperty("assignee");
	await expect(record(fixture, run.active[FIRST]!.bead)).resolves.toMatchObject({
		assignee: "working-agent",
	});
	await close(fixture, run.active[FIRST]!.bead);
	const advanced = await view(fixture, [
		"--actor",
		"finishing-agent",
		"next",
		run.id,
		run.active[FIRST]!.bead,
	]);
	await expect(record(fixture, advanced.active[FIRST]!.bead)).resolves.toMatchObject({
		assignee: "working-agent",
		created_by: "finishing-agent",
		owner: fixture.options.owner,
	});
});

test("mutations require distinct actor and owner inputs while inspection does not require an actor", async () => {
	const source = await sequentialSource("identity");
	const noActor = await invoke(
		["--db", fixture.options.db, "--owner", fixture.options.owner, "start", source],
		fixture.services,
	);
	expect(noActor.document).toMatchObject({ ok: false, reason: "missing_actor" });
	const noOwner = await invoke(
		["--db", fixture.options.db, "--actor", fixture.options.actor, "start", source],
		fixture.services,
	);
	expect(noOwner.document).toMatchObject({ ok: false, reason: "missing_owner" });
	const run = await view(fixture, ["start", source]);
	await expect(
		invoke(["--db", fixture.options.db, "show", run.id], fixture.services),
	).resolves.toMatchObject({ document: { ok: true } });
});

test.each([
	{ environment: false, explicit: false, externalCwd: false, mode: "repository" },
	{ environment: true, explicit: false, externalCwd: false, mode: "environment" },
	{ environment: true, explicit: true, externalCwd: false, mode: "explicit database" },
	{ environment: false, explicit: false, externalCwd: true, mode: "explicit repository" },
])(
	"native tracker selection follows $mode independently of the execution directory",
	async (selection) => {
		const { argv, expectedDb, services } = await trackerSelection(selection);
		const source = await sequentialSource("selection");
		const result = await invoke([...argv, "start", source], services);
		expect(result.document).toMatchObject({ ok: true });
		const started = runViewSchema.parse(result.document);
		await expect(
			readBead({ db: expectedDb, repo: fixture.options.repo }, started.id, services),
		).resolves.toMatchObject({ owner: fixture.options.owner });
	},
);

test("schema discovery works without a database while starting from the same checkout fails clearly", async () => {
	const empty = join(fixture.root, "empty");
	await createRepository(fixture, empty);
	const source = await sequentialSource("without-db");
	const services = { ...fixture.services, cwd: empty };
	await expect(invoke(["input-schema", "--source", source], services)).resolves.toMatchObject({
		document: {
			kind: "input-schema",
			ok: true,
		},
	});
	await expect(
		invoke(
			["--actor", fixture.options.actor, "--owner", fixture.options.owner, "start", source],
			services,
		),
	).resolves.toMatchObject({ document: { ok: false, reason: "command_failed" } });
});

test("the public executable emits one JSON error document and keeps stderr silent", async () => {
	const runner = new URL("../../bin/busybee.ts", import.meta.url).pathname;
	const proc = Bun.spawn([process.execPath, runner, "--not-an-option", "--json"], {
		cwd: fixture.options.repo,
		env: fixture.env,
		stderr: "pipe",
		stdout: "pipe",
	});
	try {
		const [stdout, stderr, code] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		expect(code).not.toBe(FIRST);
		expect(stderr).toBe("");
		expect(JSON.parse(stdout)).toMatchObject({ ok: false, reason: "commander.unknownOption" });
	} finally {
		proc.kill();
	}
});

test("the parallel example publishes sibling groups instead of children of the preceding stage", async () => {
	const input = join(fixture.root, "parallel.json");
	await Bun.write(input, JSON.stringify(parallelInput.parse({})));
	const source = new URL("../../examples/parallel/workflow.ts", import.meta.url).pathname;
	const started = await view(fixture, ["start", source, "--input-file", input]);
	await close(fixture, started.active[FIRST]!.bead);
	const run = await view(fixture, ["next", started.id, started.active[FIRST]!.bead]);
	const group = run.active.find((entry) => entry.title === "Implementation")!;
	await expect(record(fixture, group.bead)).resolves.toMatchObject({
		dependencies: expect.arrayContaining([
			{
				dependency_type: "parent-child",
				id: run.id,
			},
		]),
	});
	await expect(record(fixture, group.bead)).resolves.toMatchObject({
		dependencies: expect.not.arrayContaining([
			{
				dependency_type: "parent-child",
				id: started.active[FIRST]!.bead,
			},
		]),
	});
});

test("the groceries example derives its next task and context from a validated outcome", async () => {
	const input = join(fixture.root, "groceries.json");
	await Bun.write(input, JSON.stringify(groceriesInput.parse({})));
	const source = new URL("../../examples/groceries/workflow.ts", import.meta.url).pathname;
	const run = await view(fixture, ["start", source, "--input-file", input]);
	await close(fixture, run.active[FIRST]!.bead);
	const next = await view(fixture, [
		"choice",
		run.id,
		run.active[FIRST]!.bead,
		"busy",
		"--data",
		JSON.stringify({ meals: FOUR }),
	]);
	expect(next.active[FIRST]!.title).toBe("Choose quick recipes");
	expect(next.active[FIRST]!.context["plannedMeals"]).toBe(FOUR);
});

// --- Fixture stories ---

// --- Private helpers ---

function sequentialSource(name: string, transition = '"done"') {
	return writeDefinition(
		fixture,
		name,
		`export const commandSchemas={next:z.object({})};export const machine=createMachine({initial:"work",states:{work:{meta:{title:"Worker",task:()=>({instructions:"Complete work"}),commands:{next:"NEXT"}},on:{NEXT:${transition}}},second:{meta:{title:"Second",task:()=>({instructions:"Complete second"}),commands:{next:"DONE"}},on:{DONE:"done"}},done:{type:"final"}}});`,
	);
}

async function sequential(name = "sequence") {
	return view(fixture, ["start", await sequentialSource(name)]);
}

async function review(mode = "manual") {
	let execution: { kind?: string; mode: string } = { mode };
	if (mode !== "manual") {
		execution = { kind: "reviewer", mode };
	}
	const input = reviewInput.parse({
		base: "a".repeat(SHA_LENGTH),
		execution,
		request: "Verify scripted review transport",
		title: "Review a change",
	});
	const path = join(fixture.root, "review.json");
	await Bun.write(path, JSON.stringify(input));
	return view(fixture, ["start", reviewSource, "--input-file", path]);
}

function plan() {
	return planSchema.parse({
		choice: "planned",
		revision: "diff-v1",
		summary: "Review two independent scopes",
		tasks: [
			{
				checks: ["Inspect behavior"],
				files: ["tasks.ts"],
				id: "behavior",
				instructions: "Review behavior",
				title: "Review behavior",
			},
			{
				checks: ["Inspect documentation"],
				files: ["README.md"],
				id: "docs",
				instructions: "Review documentation",
				title: "Review docs",
			},
		],
	});
}

function invalidPlan(ids: readonly string[]) {
	const valid = plan();
	return { ...valid, tasks: ids.map((id) => ({ ...valid.tasks[FIRST]!, id })) };
}

function approved(revision = "diff-v1") {
	return resultSchema.parse({
		choice: "approved",
		evidence: ["Scripted transport evidence"],
		findings: [],
		revision,
	});
}

async function plannedReview() {
	const run = await review();
	await close(fixture, run.active[FIRST]!.bead);
	return view(fixture, [
		"choice",
		run.id,
		run.active[FIRST]!.bead,
		"planned",
		"--data",
		JSON.stringify(plan()),
	]);
}

async function completedResult(id: string, result: unknown): Promise<void> {
	await tracker(
		fixture.options,
		["update", id, "--notes", JSON.stringify(result), "--actor", fixture.options.actor],
		fixture.services,
	);
	await close(fixture, id);
}

async function configureBee(): Promise<void> {
	const bin = join(fixture.root, "bin");
	await mkdir(bin);
	const beeSource = new URL("../../../colony/bin/bee.ts", import.meta.url).pathname;
	await Bun.write(
		join(bin, "bee"),
		`#!${process.execPath}\nimport ${JSON.stringify(beeSource)};\n`,
	);
	await chmod(join(bin, "bee"), EXECUTABLE_MODE);
	fixture.env.PATH = `${bin}:${dirname(process.execPath)}:${fixture.env.PATH ?? ""}`;
	await Bun.write(
		join(fixture.options.repo, ".hive", "bees.toml"),
		`owner="test-human"\nhumans=["test-human"]\n[kinds.reviewer]\ndescription="Complete the fixture review"\nharness="codex"\nmodel="fixture"\neffort="low"\nprompt="Complete the fixture task"\n[formulas.codex]\nexecutable="false"\nargv=[]\n`,
	);
}

async function closedSequence(name = "sequence") {
	const run = await sequential(name);
	await close(fixture, run.active[FIRST]!.bead);
	return run;
}

async function workerWithChild() {
	const run = await sequential();
	const worker = run.active[FIRST]!;
	const child = await createTask(
		fixture.options,
		{
			description: "Complete the fixture investigation",
			labels: [],
			owner: fixture.options.owner,
			parent: worker.bead,
			status: "open",
			title: "Worker investigation",
		},
		fixture.services,
	);
	return { child, run, worker };
}

function racingCallers(id: string) {
	const ready = Promise.withResolvers<void>();
	const finished = Promise.withResolvers<void>();
	let arrivals = FIRST;
	const services: Services = {
		...fixture.services,
		execute: async (argv, cwd) => {
			if (
				arrivals < TWO &&
				argv[FIRST] === "br" &&
				argv[SECOND] === "update" &&
				argv[TWO] === id &&
				argv.includes("--notes")
			) {
				arrivals += SECOND;
				if (arrivals === TWO) {
					ready.resolve();
				}
				await ready.promise;
			}
			return fixture.services.execute(argv, cwd);
		},
		now: () => FIRST,
		sleep: () => finished.promise,
	};
	return {
		arrivals: () => arrivals,
		release: () => {
			ready.resolve();
			finished.resolve();
		},
		submit: async (command: string[]) => {
			const result = await invoke(command, services);
			if (result.code === FIRST) {
				finished.resolve();
			}
			return result;
		},
	};
}

async function holdCheckpoint(id: string) {
	const state = await checkpoint(fixture, id);
	await tracker(
		fixture.options,
		[
			"update",
			state.id,
			"--notes",
			JSON.stringify({ owner: "held-test-owner", pid: process.pid }),
			"--if-unchanged",
			state.updated_at,
			"--actor",
			fixture.options.actor,
		],
		fixture.services,
	);
	return state;
}

function waitingCaller(run: RunView) {
	const observed = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	let now = FIRST;
	const services = {
		...fixture.services,
		now: () => now,
		sleep: () => {
			observed.resolve();
			return release.promise;
		},
	};
	return {
		abort: () => {
			now = DEADLINE;
			release.resolve();
		},
		observed: observed.promise,
		release: release.resolve,
		result: invoke([...optionsArgs(fixture), "next", run.id, run.active[FIRST]!.bead], services),
	};
}

async function releaseCheckpoint(id: string): Promise<void> {
	const locked = await checkpoint(fixture, id);
	await tracker(
		fixture.options,
		[
			"update",
			locked.id,
			"--notes",
			"",
			"--force",
			"--if-unchanged",
			locked.updated_at,
			"--actor",
			fixture.options.actor,
		],
		fixture.services,
	);
}

async function completedReviewWorkers(run: RunView) {
	const group = run.active.find((entry) => entry.commands.length === FIRST)!;
	const workers = run.active.filter((entry) => entry.commands.includes("approved"));
	expect(workers.length).toBe(TWO);
	await expect(record(fixture, group.bead)).resolves.toMatchObject({
		dependencies: expect.arrayContaining([{ dependency_type: "parent-child", id: run.id }]),
	});
	for (const worker of workers) {
		// eslint-disable-next-line no-await-in-loop -- Each worker's native parent is verified before closure.
		await expect(record(fixture, worker.bead)).resolves.toMatchObject({
			dependencies: expect.arrayContaining([{ dependency_type: "parent-child", id: group.bead }]),
		});
		// eslint-disable-next-line no-await-in-loop -- Native worker closures precede outcome submission.
		await close(fixture, worker.bead);
	}
	return workers;
}

async function submitReviews(initial: RunView, choices: string[]) {
	let run = initial;
	for (const [index, worker] of initial.active
		.filter((entry) => entry.commands.includes("approved"))
		.entries()) {
		// eslint-disable-next-line no-await-in-loop -- Native worker closure precedes each accepted review outcome.
		await close(fixture, worker.bead);
		const choice = choices[index]!;
		const result = reviewOutcome(choice);
		// eslint-disable-next-line no-await-in-loop -- A review join consumes the preceding checkpoint.
		run = await view(fixture, [
			"choice",
			run.id,
			worker.bead,
			choice,
			"--data",
			JSON.stringify(result),
		]);
	}
	return run;
}

function reviewOutcome(choice: string) {
	if (choice === "approved") {
		return approved();
	}
	return {
		choice,
		evidence: ["Scripted review transport"],
		findings: [
			{
				fix: "Filter first",
				location: "tasks.ts:12",
				problem: "Ordering",
				verification: "Check the fixture",
			},
		],
		revision: "diff-v1",
	};
}

async function collectedPlan() {
	await configureBee();
	const run = await review("bee");
	await completedResult(run.active[FIRST]!.bead, plan());
	const collected = await collectTogether(run);
	return collected[SECOND]!;
}

async function collectTogether(run: RunView) {
	const state = await checkpoint(fixture, run.id);
	const callers = racingCallers(state.id);
	try {
		const command = [...optionsArgs(fixture), "collect", run.id];
		const results = await Promise.all([callers.submit(command), callers.submit(command)]);
		expect(callers.arrivals()).toBe(TWO);
		expect(results.map((result) => result.code)).toEqual([FIRST, FIRST]);
		return results.map((result) => runViewSchema.parse(result.document));
	} finally {
		callers.release();
	}
}

async function assignedRun() {
	const source = await sequentialSource("identity", '"second"');
	return view(fixture, [
		"--actor",
		"initiating-agent",
		"--assignee",
		"working-agent",
		"start",
		source,
	]);
}

async function trackerSelection(selection: TrackerSelection) {
	const selectedDb = await alternativeDatabase();
	const services = selectedServices(selection, selectedDb);
	const argv = ["--actor", fixture.options.actor, "--owner", fixture.options.owner];
	if (selection.explicit) {
		argv.push("--db", fixture.options.db);
	}
	if (selection.externalCwd) {
		argv.push("--repo", fixture.options.repo);
	}
	return { argv, expectedDb: selectedDatabase(selection, selectedDb), services };
}

function selectedServices(selection: TrackerSelection, selectedDb: string): Services {
	const env = { ...fixture.env };
	if (selection.environment) {
		env.BEADS_DB = selectedDb;
	}
	let cwd = fixture.options.repo;
	if (selection.externalCwd) {
		cwd = join(fixture.root, "empty");
	}
	return { ...fixture.services, cwd, execute: (argv, directory) => execute(argv, directory, env) };
}

function assertRaceOutcome(results: Awaited<ReturnType<typeof invoke>>[]): void {
	expect(results.map((result) => result.code === FIRST).toSorted()).toEqual([false, true]);
	expect(results.find((result) => result.code !== FIRST)!.document).toMatchObject({
		reason: "inactive_task",
	});
	expect(results.find((result) => result.code === FIRST)!.document).toMatchObject({
		status: "done",
	});
}

async function advanceIndependentAndRelease(
	held: RunView,
	independent: RunView,
	description: string,
): Promise<void> {
	await expect(
		view(fixture, ["next", independent.id, independent.active[FIRST]!.bead]),
	).resolves.toMatchObject({ status: "done" });
	await expect(checkpoint(fixture, held.id)).resolves.toMatchObject({ description });
	await releaseCheckpoint(held.id);
}

function selectedDatabase(selection: TrackerSelection, selected: string): string {
	if (selection.environment && !selection.explicit) {
		return selected;
	}
	return fixture.options.db;
}

async function alternativeDatabase(): Promise<string> {
	const selected = join(fixture.root, "selected");
	const empty = join(fixture.root, "empty");
	await Promise.all([createRepository(fixture, selected), createRepository(fixture, empty)]);
	const selectedDb = join(selected, ".beads/beads.db");
	await fixture.services.execute(
		["br", "init", "--db", selectedDb, "--prefix", "selected", "--actor", fixture.options.actor],
		selected,
	);
	return selectedDb;
}
