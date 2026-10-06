/* eslint-disable import/no-nodejs-modules -- Native integration probe manages disposable filesystem fixtures. */
import { chmod, mkdir, mkdtemp } from "node:fs/promises";
import { createServices, tracker as nativeTracker, readBead } from "../src/native.ts";
import type { Endpoint } from "../src/native.ts";
import type { RunView } from "../src/runtime.ts";
import { execute as executeProcess } from "@hive/shared";
import { expect } from "bun:test";
import { join } from "node:path";
import { runViewSchema } from "../src/runtime.ts";
import { tmpdir } from "node:os";
import { z } from "zod";

const ZERO = 0;
const EXECUTABLE_MODE = 0o755;
const SHA_LENGTH = 40;
const ONE = 1;
const FOUR = 4;
const TWO = 2;
const THREE = 3;
const failureSchema = z.object({ message: z.string(), ok: z.literal(false) });
let services = createServices();
function execute(argv: string[], cwd = services.cwd): Promise<string> {
	return services.execute(argv, cwd);
}
const issueSchema = z.object({ id: z.string() });
const nativeResult = z.object({
	id: z.string().default(""),
	issues: z.array(issueSchema).default([]),
});
async function tracker(endpoint: Endpoint, command: string[]) {
	const result = await nativeTracker(endpoint, [...command, "--actor", "probe-agent"], services);
	if (command[ZERO] === "create" || command[ZERO] === "list") {
		return nativeResult.parse(result);
	}
	return { id: "", issues: [] };
}

const root = await mkdtemp(join(tmpdir(), "busybee-native-"));
const repo = join(root, "repo");
await mkdir(repo);
const options = {
	actor: "probe-agent",
	db: join(repo, ".beads/beads.db"),
	owner: "probe-human",
	repo,
};
const runner = new URL("../bin/busybee.ts", import.meta.url).pathname;
const source = new URL("../examples/change-review/workflow.ts", import.meta.url).pathname;
const trace: unknown[] = [];
const testBin = join(root, "bin");
await mkdir(testBin);
const beeSource = new URL("../../colony/bin/bee.ts", import.meta.url).pathname;
await Bun.write(join(testBin, "bee"), `#!/usr/bin/env bun\nimport ${JSON.stringify(beeSource)};\n`);
await chmod(join(testBin, "bee"), EXECUTABLE_MODE);
const testEnv = { ...process.env, PATH: `${testBin}:${process.env.PATH ?? ""}` };
services = { ...services, execute: (argv, cwd) => executeProcess(argv, cwd, testEnv) };
console.log(`Evidence directory: ${root}`);
await execute(["git", "init", "--quiet", repo]);
await execute(["br", "init", "--prefix", "lock", "--db", options.db, "--actor", "codex"], repo);
await Bun.write(
	join(repo, "bees.toml"),
	`owner = "ct"\nhumans = ["ct"]\n[kinds.reviewer]\nharness = "codex"\nmodel = "fixture"\neffort = "low"\nprompt = "Follow the task brief."\n[formulas.codex]\nexecutable = "false"\nargv = []\n`,
);

function args(command: string[]) {
	return [
		"bun",
		runner,
		"--db",
		options.db,
		"--repo",
		repo,
		"--owner",
		options.owner,
		"--actor",
		options.actor,
		...command,
	];
}
async function run(...command: string[]): Promise<RunView> {
	const stdout = await execute(args([...command, "--json"]));
	const result = runViewSchema.parse(JSON.parse(stdout));
	trace.push({ command, result });
	return result;
}
const propertySchema = z
	.object({ minItems: z.number().optional(), type: z.string().optional() })
	.passthrough();
const choiceSchema = z.object({ properties: z.record(z.string(), propertySchema) }).passthrough();
const discoveredChoice = z.object({ choice: z.string(), schema: choiceSchema });
const discoveredTask = z.object({ choices: z.array(discoveredChoice) });
const discoverySchema = z.object({
	active: z.array(discoveredTask),
	kind: z.literal("discover"),
	ok: z.literal(true),
});
async function discoverRun(id: string) {
	const stdout = await execute(args(["discover", id, "--json"]));
	return discoverySchema.parse(JSON.parse(stdout));
}
function launch(...command: string[]) {
	const proc = Bun.spawn(args(command), { env: testEnv, stderr: "pipe", stdout: "pipe" });
	return (async () => {
		const [stdout, stderr, code] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		const result = { code, command, stderr, stdout };
		trace.push(result);
		return result;
	})();
}
function read(id: string) {
	return readBead(options, id, services);
}
async function checkpoint(id: string) {
	const record = await read(id);
	return await read(record.dependencies.find((edge) => edge.dependency_type === "related")!.id);
}
const resultsSchema = z.record(z.string(), z.unknown());
const contextSchema = z.object({
	plannedMeals: z.number().optional(),
	results: resultsSchema.optional(),
	substitutions: z.number().optional(),
});
const snapshotSchema = z.object({ context: contextSchema });
const stateSchema = z.object({ history: z.array(z.unknown()), snapshot: snapshotSchema });
async function state(id: string) {
	const checkpointResult1 = await checkpoint(id);
	return stateSchema.parse(JSON.parse(checkpointResult1.description));
}
async function start(mode = "manual", kind = "reviewer") {
	const input = join(root, `${crypto.randomUUID()}.json`);
	let execution: { kind?: string; mode: string } = { mode };
	if (mode !== "manual") {
		execution = { kind, mode };
	}
	await Bun.write(
		input,
		JSON.stringify({
			base: "a".repeat(SHA_LENGTH),
			execution,
			request:
				"Review the changed task-list limit behavior, repair findings, then review the updated change.",
			title: "Review limit semantics",
		}),
	);
	return await run("start", source, "--input-file", input);
}
async function closeTask(task: string) {
	await tracker(options, ["close", task, "--reason", "Completed: scripted transport evidence."]);
}
async function submit(runId: string, task: string, result: { choice: string; data: unknown }) {
	await closeTask(task);
	return await run("choice", runId, task, result.choice, "--data", JSON.stringify(result.data));
}
const plan = {
	choice: "planned",
	revision: "diff-v1",
	summary: "Review limit execution and documentation independently.",
	tasks: [
		{
			checks: ["Run task-list --status open --limit 0"],
			files: ["tasks.js"],
			id: "behavior",
			instructions: "Inspect filter-before-limit ordering and zero limit behavior.",
			title: "Review limit behavior",
		},
		{
			checks: ["Compare README examples to task-list output"],
			files: ["README.md"],
			id: "docs",
			instructions: "Check the documented zero limit semantics against executable behavior.",
			title: "Review limit documentation",
		},
	],
};
function reviewResult(choice = "approved", revision = "diff-v1") {
	const findings = [];
	if (choice !== "approved") {
		findings.push({
			fix: "Filter before slicing.",
			location: "tasks.js:12",
			problem: "Limit applied before filtering.",
			verification: "Run --status open --limit 1 with a closed first task.",
		});
	}
	return {
		choice,
		evidence: ["Inspected the task-list fixture contract; transport verification only."],
		findings,
		revision,
	};
}

let manual = await start();
const first = manual.active[ZERO]!.bead;
const beforeDiscovery = await checkpoint(manual.id);
const discovery = await discoverRun(manual.id);
expect(discovery.active[ZERO]!.choices[ZERO]!.schema.properties.tasks!.minItems).toBe(ONE);
const checkpointResult2 = await checkpoint(manual.id);
expect(checkpointResult2.updated_at).toBe(beforeDiscovery.updated_at);
const executeResult1 = await execute(args(["discover", manual.id]));
expect(executeResult1.includes("tasks (required, array)")).toBeTruthy();
const readResult1 = await read(manual.id);
expect(!readResult1.description.includes('"snapshot"')).toBeTruthy();
const readResult2 = await read(first);
expect(!readResult2.description.includes('"choice"')).toBeTruthy();
const checkpointResult3 = await checkpoint(manual.id);
expect(checkpointResult3.labels.includes("system")).toBeTruthy();
// Native child completion owns the gate; rejected submissions have no workflow effects.
const trackerResult1 = await tracker(options, [
	"create",
	"--title",
	"Planner investigation",
	"--parent",
	first,
	"--owner",
	"ct",
]);
const child = trackerResult1.id;
const blockedClosure = Bun.spawn(
	["br", "close", first, "--db", options.db, "--actor", "codex", "--json"],
	{ cwd: repo },
);
expect(await blockedClosure.exited).not.toBe(ZERO);
const readResult3 = await read(first);
expect(readResult3.status).not.toBe("closed");
const unfinished = await launch(
	"choice",
	manual.id,
	first,
	"planned",
	"--data",
	JSON.stringify(plan),
);
expect(unfinished.code).not.toBe(ZERO);
expect(unfinished.stderr.includes("must be closed")).toBeTruthy();
const checkpointResult4 = await checkpoint(manual.id);
expect(checkpointResult4.description).toBe(beforeDiscovery.description);
const checkpointResult5 = await checkpoint(manual.id);
expect(!checkpointResult5.notes).toBeTruthy();
const readResult4 = await read(child);
expect(readResult4.status).toBe("open");
await closeTask(child);
await closeTask(first);
const closedPlanner = await read(first);
const invalid = await launch(
	"choice",
	manual.id,
	first,
	"planned",
	"--data",
	JSON.stringify({ ...plan, tasks: [] }),
);
expect(invalid.code).not.toBe(ZERO);
expect(invalid.stderr.includes("tasks")).toBeTruthy();
const checkpointResult6 = await checkpoint(manual.id);
expect(checkpointResult6.description).toBe(beforeDiscovery.description);
const checkpointResult7 = await checkpoint(manual.id);
expect(!checkpointResult7.notes).toBeTruthy();
const duplicateIds = await launch(
	"choice",
	manual.id,
	first,
	"planned",
	"--data",
	JSON.stringify({ ...plan, tasks: [plan.tasks[ZERO], plan.tasks[ZERO]] }),
);
expect(duplicateIds.code).not.toBe(ZERO);
const stateResult1 = await state(manual.id);
expect(stateResult1.history.length).toBe(ZERO);

// Independent processes contend on the same sequential task: exactly one plan wins.
const competing = await Promise.all([
	launch("choice", manual.id, first, "planned", "--data", JSON.stringify(plan)),
	launch("choice", manual.id, first, "planned", "--data", JSON.stringify(plan)),
]);
expect(competing.map((entry) => entry.code === ZERO).toSorted()).toEqual([false, true]);
manual = await run("show", manual.id);
expect(manual.created.length).toBe(FOUR);
const reviews = manual.active.filter((entry) => entry.commands.includes("approved"));
const group = manual.active.find((entry) => entry.commands.length === ZERO)!.bead;
expect(group).not.toBe(first);
const readResult5 = await read(group);
expect(readResult5.status).not.toBe("closed");
const readResult6 = await read(manual.id);
expect(readResult6.status).not.toBe("closed");
const readResult7 = await read(group);
expect(
	readResult7.dependencies.some(
		(edge) => edge.id === manual.id && edge.dependency_type === "parent-child",
	),
).toBeTruthy();
/* eslint-disable no-await-in-loop -- Native fixture transitions and tracker mutations consume the previous state. */
for (const review of reviews) {
	const readResult8 = await read(review.bead);
	expect(
		readResult8.dependencies.some(
			(edge) => edge.id === group && edge.dependency_type === "parent-child",
		),
	).toBeTruthy();
	const readResult9 = await read(review.bead);
	expect(!readResult9.dependencies.some((edge) => edge.id === first)).toBeTruthy();
	await closeTask(review.bead);
}
/* eslint-enable no-await-in-loop */
const readResult10 = await read(first);
expect(readResult10.updated_at).toBe(closedPlanner.updated_at);
const checkpointResult8 = await checkpoint(manual.id);
const staleBefore = checkpointResult8.description;
const stale = await launch(
	"choice",
	manual.id,
	reviews[ZERO]!.bead,
	"approved",
	"--data",
	JSON.stringify(reviewResult("approved", "old-revision")),
);
expect(stale.code).not.toBe(ZERO);
const checkpointResult9 = await checkpoint(manual.id);
expect(checkpointResult9.description).toBe(staleBefore);
const reviewed = await Promise.all(
	reviews.map((entry, index) => {
		let choice = "approved";
		if (index === ZERO) {
			choice = "changes";
		}
		return launch(
			"choice",
			manual.id,
			entry.bead,
			choice,
			"--data",
			JSON.stringify(reviewResult(choice)),
		);
	}),
);
expect(reviewed.every((entry) => entry.code === ZERO)).toBeTruthy();
manual = await run("show", manual.id);
expect(manual.active.length).toBe(ONE);
expect(manual.active[ZERO]!.title.startsWith("Repair")).toBeTruthy();
const stateResult2 = await state(manual.id);
expect(Object.keys(stateResult2.snapshot.context.results!).length).toBe(TWO);
manual = await submit(manual.id, manual.active[ZERO]!.bead, {
	choice: "repaired",
	data: {
		choice: "repaired",
		summary: "Filter before applying the limit.",
		verification: ["Filter/limit cases pass."],
	},
});
manual = await submit(manual.id, manual.active[ZERO]!.bead, {
	choice: "planned",
	data: {
		...plan,
		revision: "diff-v2",
	},
});
const finalReviews = manual.active.filter((entry) => entry.commands.includes("approved"));
/* eslint-disable no-await-in-loop -- Native fixture transitions and tracker mutations consume the previous state. */
for (const entry of finalReviews) {
	await closeTask(entry.bead);
}
/* eslint-enable no-await-in-loop */
const PromiseallResult1 = await Promise.all(
	finalReviews.map((entry) =>
		launch(
			"choice",
			manual.id,
			entry.bead,
			"approved",
			"--data",
			JSON.stringify(reviewResult("approved", "diff-v2")),
		),
	),
);
expect(PromiseallResult1.every((entry) => entry.code === ZERO)).toBeTruthy();
const runResult1 = await run("show", manual.id);
expect(runResult1.status).toBe("done");
const readResult11 = await read(manual.id);
expect(readResult11.status).toBe("closed");

// A held lock does not stop a different workflow; explicit safe release lets a waiter reread.
const held = await start();
const independent = await start();
const heldCheckpoint = await checkpoint(held.id);
await tracker(options, [
	"update",
	heldCheckpoint.id,
	"--notes",
	JSON.stringify({ owner: "probe-owner", pid: process.pid }),
	"--if-unchanged",
	heldCheckpoint.updated_at,
]);
await closeTask(held.active[ZERO]!.bead);
const waiting = launch(
	"choice",
	held.id,
	held.active[ZERO]!.bead,
	"planned",
	"--data",
	JSON.stringify(plan),
);
await submit(independent.id, independent.active[ZERO]!.bead, { choice: "planned", data: plan });
const stateResult3 = await state(held.id);
expect(stateResult3.history.length).toBe(ZERO);
const locked = await checkpoint(held.id);
await tracker(options, [
	"update",
	locked.id,
	"--notes",
	"",
	"--force",
	"--if-unchanged",
	locked.updated_at,
]);
const observedResult1 = await waiting;
expect(observedResult1.code).toBe(ZERO);

// Real Bee requests, scripted task results: concurrent collectors cannot duplicate the join.
let automatic = await start("bee");
async function complete(task: string, data: unknown) {
	await tracker(options, ["update", task, "--notes", JSON.stringify(data)]);
	await tracker(options, ["close", task, "--reason", "Completed: scripted transport evidence."]);
}
await complete(automatic.active[ZERO]!.bead, plan);
const collectors = await Promise.all([
	launch("collect", automatic.id),
	launch("collect", automatic.id),
]);
expect(collectors.every((entry) => entry.code === ZERO)).toBeTruthy();
automatic = await run("show", automatic.id);
expect(automatic.created.length).toBe(FOUR);
expect(automatic.created.filter((entry) => entry.request).length).toBe(THREE);
/* eslint-disable no-await-in-loop -- Native fixture transitions and tracker mutations consume the previous state. */
for (const entry of automatic.active.filter((task) => task.request)) {
	await complete(entry.bead, reviewResult());
}
/* eslint-enable no-await-in-loop */
const PromiseallResult2 = await Promise.all([
	launch("collect", automatic.id),
	launch("collect", automatic.id),
]);
expect(PromiseallResult2.every((entry) => entry.code === ZERO)).toBeTruthy();
const runResult2 = await run("show", automatic.id);
expect(runResult2.status).toBe("done");
const stateResult4 = await state(automatic.id);
expect(stateResult4.history.length).toBe(THREE);
/* eslint-disable no-await-in-loop -- Native fixture transitions and tracker mutations consume the previous state. */
for (const entry of automatic.created.filter((task) => task.request)) {
	await execute([
		"bee",
		"stop",
		entry.request!,
		"--repo",
		repo,
		"--beads-db",
		options.db,
		"--actor",
		"codex",
		"--json",
	]);
}
/* eslint-enable no-await-in-loop */

// A minimal sequential chart exercises the generic next command, independently of choices.
const nextSource = join(root, "next-workflow.js");
const nextInput = join(root, "next-input.json");
await Bun.write(
	nextSource,
	`
import { setup } from ${JSON.stringify(import.meta.resolve("xstate"))};
import { z } from ${JSON.stringify(import.meta.resolve("zod"))};
export const inputSchema = z.object({});
export function runBrief() { return { title: "Next gate", description: "Verify completion" }; }
export const machine = setup({}).createMachine({
  initial: "work", states: {
    work: { meta: { title: "Work", instructions: "Complete the work.", commands: { next: "NEXT" } }, on: { NEXT: "done" } },
    done: { type: "final" }
  }
});
export const commandSchemas = { next: z.object({}) };
export function validateCommand(entry, command, data) { return commandSchemas[command].parse(data); }
`,
);
await Bun.write(
	nextInput,
	JSON.stringify({
		base: "a".repeat(SHA_LENGTH),
		request: "Verify completion",
		title: "Next gate",
	}),
);
const sequential = await run("start", nextSource, "--input-file", nextInput);
const sequentialTask = sequential.active[ZERO]!.bead;
const checkpointResult10 = await checkpoint(sequential.id);
const nextBefore = checkpointResult10.description;
const nextOpen = await launch("next", sequential.id, sequentialTask);
expect(nextOpen.code).not.toBe(ZERO);
expect(nextOpen.stderr.includes("must be closed")).toBeTruthy();
const checkpointResult11 = await checkpoint(sequential.id);
expect(checkpointResult11.description).toBe(nextBefore);
const checkpointResult12 = await checkpoint(sequential.id);
expect(!checkpointResult12.notes).toBeTruthy();
await closeTask(sequentialTask);
const nextClosed = await read(sequentialTask);
const runResult3 = await run("next", sequential.id, sequentialTask);
expect(runResult3.status).toBe("done");
const readResult12 = await read(sequentialTask);
expect(readResult12.updated_at).toBe(nextClosed.updated_at);
const readResult13 = await read(sequential.id);
expect(readResult13.status).toBe("closed");
const launchResult1 = await launch("next", sequential.id, sequentialTask);
expect(launchResult1.code).not.toBe(ZERO);
const stateResult5 = await state(sequential.id);
expect(stateResult5.history.length).toBe(ONE);

// A worker cannot advance into fresh children beneath its own closed task.
const nestedSource = join(root, "nested-workflow.js");
await Bun.write(
	nestedSource,
	`
import { setup } from ${JSON.stringify(import.meta.resolve("xstate"))};
export { inputSchema, commandSchemas, validateCommand, runBrief } from ${JSON.stringify(nextSource)};
export const machine = setup({}).createMachine({ initial: "parent", states: {
  parent: { meta: { title: "Parent work", instructions: "Complete parent work.", commands: { next: "NEXT" } },
    initial: "ready", states: {
      ready: { on: { NEXT: "child" } },
      child: { meta: { title: "Nested work", instructions: "New child work." } }
    }
  }
} });
`,
);
const nested = await run("start", nestedSource, "--input-file", nextInput);
const nestedTask = nested.active[ZERO]!.bead;
await closeTask(nestedTask);
const checkpointResult13 = await checkpoint(nested.id);
const nestedBefore = checkpointResult13.description;
const trackerResult2 = await tracker(options, ["list", "--all", "--limit", "0"]);
const nestedBeadsBefore = trackerResult2.issues.map((entry) => entry.id).toSorted();
const nestedClosed = await read(nestedTask);
const nestedRejected = await launch("next", nested.id, nestedTask);
expect(nestedRejected.code).not.toBe(ZERO);
expect(nestedRejected.stderr.includes("Cannot create new work beneath closed parent")).toBeTruthy();
const checkpointResult14 = await checkpoint(nested.id);
expect(checkpointResult14.description).toBe(nestedBefore);
const checkpointResult15 = await checkpoint(nested.id);
expect(!checkpointResult15.notes).toBeTruthy();
const readResult14 = await read(nestedTask);
expect(readResult14.updated_at).toBe(nestedClosed.updated_at);
expect(await read(nestedTask)).toEqual(nestedClosed);
const trackerResult3 = await tracker(options, ["list", "--all", "--limit", "0"]);
expect(trackerResult3.issues.map((entry) => entry.id).toSorted()).toEqual(nestedBeadsBefore);
const runResult4 = await run("show", nested.id);
expect(runResult4.created.length).toBe(ONE);

// Retained generic examples use the same canonical engine and need no initial payload.
const parallelSource = new URL("../examples/parallel/workflow.ts", import.meta.url).pathname;
let parallel = await run("start", parallelSource);
async function nextTask(current: RunView, title: string, choice = "next") {
	const task = current.active.find((entry) => entry.title === title)!;
	await closeTask(task.bead);
	if (choice === "next") {
		return await run("next", current.id, task.bead);
	}
	return await run("choice", current.id, task.bead, choice);
}
const prepare = parallel.active[ZERO]!.bead;
parallel = await nextTask(parallel, "Prepare change");
const implementation = parallel.active.find((entry) => entry.title === "Implementation")!.bead;
const readResult15 = await read(implementation);
expect(
	readResult15.dependencies.some(
		(edge) => edge.id === parallel.id && edge.dependency_type === "parent-child",
	),
).toBeTruthy();
const readResult16 = await read(implementation);
expect(!readResult16.dependencies.some((edge) => edge.id === prepare)).toBeTruthy();
const docsTask = parallel.active.find((entry) => entry.title === "Write docs")!.bead;
const readResult17 = await read(docsTask);
const docsBrief = readResult17.description;
parallel = await nextTask(parallel, "Implement API");
const readResult18 = await read(docsTask);
expect(readResult18.description).toBe(docsBrief);
parallel = await nextTask(parallel, "Verify API");
expect(!parallel.active.some((entry) => entry.title === "Hand off change")).toBeTruthy();
parallel = await nextTask(parallel, "Write docs");
parallel = await nextTask(parallel, "Check docs", "revise");
expect(parallel.active.find((entry) => entry.title === "Write docs")!.bead).not.toBe(docsTask);
parallel = await nextTask(parallel, "Write docs");
parallel = await nextTask(parallel, "Check docs", "approved");
const readResult19 = await read(implementation);
expect(readResult19.status).toBe("closed");
parallel = await nextTask(parallel, "Hand off change");
expect(parallel.status).toBe("done");
const readResult20 = await read(parallel.id);
expect(readResult20.status).toBe("closed");

const groceriesSource = new URL("../examples/groceries/workflow.ts", import.meta.url).pathname;
let groceries = await run("start", groceriesSource);
const groceryTask = groceries.active[ZERO]!.bead;
const groceryDiscovery = await discoverRun(groceries.id);
expect(groceryDiscovery.kind).toBe("discover");
expect(groceryDiscovery.ok).toBe(true);
expect(
	groceryDiscovery.active[ZERO]!.choices.find((entry) => entry.choice === "busy")!.schema.properties
		.meals!.type,
).toBe("integer");
const openJson = await launch("next", groceries.id, groceryTask, "--json");
expect(openJson.stderr).toBe("");
expect(failureSchema.parse(JSON.parse(openJson.stdout)).ok).toBe(false);
groceries = await submit(groceries.id, groceryTask, { choice: "busy", data: { meals: 4 } });
expect(groceries.active[ZERO]!.title).toBe("Choose quick recipes");
/* eslint-disable no-await-in-loop -- Native fixture transitions and tracker mutations consume the previous state. */
for (const choice of ["next", "safe", "next", "replan"]) {
	groceries = await nextTask(groceries, groceries.active[ZERO]!.title, choice);
}
/* eslint-enable no-await-in-loop */
expect(groceries.active[ZERO]!.title).toBe("Read the week ahead");
groceries = await submit(groceries.id, groceries.active[ZERO]!.bead, {
	choice: "flexible",
	data: { meals: 2 },
});
/* eslint-disable no-await-in-loop -- Native fixture transitions and tracker mutations consume the previous state. */
for (const choice of [
	"next",
	"safe",
	"next",
	"next",
	"unavailable",
	"substitute",
	"available",
	"within-budget",
	"next",
	"next",
	"done",
]) {
	groceries = await nextTask(groceries, groceries.active[ZERO]!.title, choice);
}
/* eslint-enable no-await-in-loop */
expect(groceries.status).toBe("done");
const stateResult6 = await state(groceries.id);
expect(stateResult6.snapshot.context.plannedMeals).toBe(TWO);
const stateResult7 = await state(groceries.id);
expect(stateResult7.snapshot.context.substitutions).toBe(ONE);
const parseFailure = await launch("--not-an-option", "--json");
expect(parseFailure.stderr).toBe("");
expect(failureSchema.parse(JSON.parse(parseFailure.stdout)).ok).toBe(false);

// Database selection belongs to native br, independently of the execution repository.
const selectionRepo = join(root, "selection-repo");
const missingRepo = join(root, "missing-repo");
await mkdir(selectionRepo);
await mkdir(missingRepo);
const selectedDb = join(selectionRepo, ".beads/beads.db");
await execute(
	["br", "init", "--prefix", "selected", "--db", selectedDb, "--actor", "codex"],
	selectionRepo,
);
const discoveryEnv: Record<string, string | undefined> = {
	...process.env,
	BD_ACTOR: "selection-agent",
};
delete discoveryEnv.BEADS_DB;
const selectedSchema = runViewSchema
	.partial()
	.extend({ kind: z.string(), message: z.string().optional(), ok: z.boolean() });
async function selectedCall(
	command: string[],
	cwd: string,
	env: Record<string, string | undefined>,
) {
	const proc = Bun.spawn(["bun", runner, "--owner", "selection-human", ...command, "--json"], {
		cwd,
		env,
		stderr: "pipe",
		stdout: "pipe",
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	expect(stderr).toBe("");
	let raw: unknown = JSON.parse(stdout);
	if (command.includes("discover")) {
		raw = z.object({ id: z.string(), kind: z.string(), ok: z.boolean() }).parse(raw);
	}
	const document = selectedSchema.parse(raw);
	trace.push({ code, command, cwd, result: document });
	return { code, document };
}
const fromRepository = await selectedCall(["start", parallelSource], repo, discoveryEnv);
expect(fromRepository.code).toBe(ZERO);
expect(await read(fromRepository.document.id!)).toBeTruthy();
const fromEnvironment = await selectedCall(["start", parallelSource], repo, {
	...discoveryEnv,
	BEADS_DB: selectedDb,
});
expect(fromEnvironment.code).toBe(ZERO);
expect(
	await readBead({ db: selectedDb, repo }, fromEnvironment.document.id!, services),
).toBeTruthy();
const explicitOverride = await selectedCall(["--db", options.db, "start", parallelSource], repo, {
	...discoveryEnv,
	BEADS_DB: selectedDb,
});
expect(explicitOverride.code).toBe(ZERO);
expect(await read(explicitOverride.document.id!)).toBeTruthy();
const explicitRepo = await selectedCall(
	["--repo", repo, "start", parallelSource],
	missingRepo,
	discoveryEnv,
);
expect(explicitRepo.code).toBe(ZERO);
expect(await read(explicitRepo.document.id!)).toBeTruthy();
const noDatabase = await selectedCall(["start", parallelSource], missingRepo, discoveryEnv);
expect(noDatabase.code).not.toBe(ZERO);
expect(noDatabase.document.ok).toBe(false);
expect(noDatabase.document.message!.includes("br")).toBeTruthy();
const schemaWithoutDatabase = await selectedCall(
	["input-schema", "--source", parallelSource],
	missingRepo,
	discoveryEnv,
);
expect(schemaWithoutDatabase.code).toBe(ZERO);
expect(schemaWithoutDatabase.document.kind).toBe("input-schema");

// Human ownership, audit attribution and agent assignment stay independent.
const selectedCallResult1 = await selectedCall(
	["--actor", "initiating-agent", "--assignee", "working-agent", "start", parallelSource],
	repo,
	discoveryEnv,
);
const identityRun = runViewSchema.parse(selectedCallResult1.document);
const runRecord = await read(identityRun.id);
expect(runRecord.owner).toBe("selection-human");
expect(runRecord.assignee).toBe("working-agent");
expect(runRecord.created_by).toBe("initiating-agent");
const checkpointRecord = await checkpoint(identityRun.id);
expect(checkpointRecord.owner).toBe("selection-human");
expect(!checkpointRecord.assignee).toBeTruthy();
expect(checkpointRecord.created_by).toBe("initiating-agent");
const readResult21 = await read(identityRun.active[ZERO]!.bead);
expect(readResult21.assignee).toBe("working-agent");
const readBeadResult1 = await readBead(
	{ db: selectedDb, repo },
	fromEnvironment.document.id!,
	services,
);
expect(readBeadResult1.assignee).toBe("selection-agent");
await closeTask(identityRun.active[ZERO]!.bead);
const differentCaller = await selectedCall(
	["--actor", "finishing-agent", "next", identityRun.id, identityRun.active[ZERO]!.bead],
	repo,
	discoveryEnv,
);
expect(differentCaller.code).toBe(ZERO);
/* eslint-disable no-await-in-loop -- Native fixture transitions and tracker mutations consume the previous state. */
for (const task of differentCaller.document.active!) {
	const record = await read(task.bead);
	expect(record.owner).toBe("selection-human");
	expect(record.created_by).toBe("finishing-agent");
	if (task.commands.length > ZERO) {
		expect(record.assignee).toBe("working-agent");
	} else {
		expect(!record.assignee).toBeTruthy();
	}
}
/* eslint-enable no-await-in-loop */
const noActorEnv: Record<string, string | undefined> = { ...discoveryEnv, USER: "human-user" };
delete noActorEnv.BD_ACTOR;
const noActor = await selectedCall(["start", parallelSource], repo, noActorEnv);
expect(noActor.code).not.toBe(ZERO);
expect(noActor.document.message!.includes("--actor or BD_ACTOR")).toBeTruthy();
const readWithoutActor = await selectedCall(["show", identityRun.id], repo, noActorEnv);
expect(readWithoutActor.code).toBe(ZERO);
const discoveryWithoutActor = await selectedCall(["discover", identityRun.id], repo, noActorEnv);
expect(discoveryWithoutActor.code).toBe(ZERO);
// eslint-disable-next-line node/no-sync -- Verify the public CLI boundary with an isolated environment.
const ownerRequired = Bun.spawnSync(["bun", runner, "start", parallelSource, "--json"], {
	cwd: repo,
	env: discoveryEnv,
});
expect(ownerRequired.exitCode).not.toBe(ZERO);
const ownerFailure = failureSchema.parse(JSON.parse(ownerRequired.stdout.toString()));
expect(ownerFailure.message.includes("--owner")).toBeTruthy();
/* eslint-disable no-await-in-loop -- Native fixture transitions and tracker mutations consume the previous state. */
for (const task of automatic.created.filter((entry) => entry.request)) {
	const readResult22 = await read(task.bead);
	expect(!readResult22.assignee).toBeTruthy();
	const readResult23 = await read(task.bead);
	expect(readResult23.owner).toBe(options.owner);
}
/* eslint-enable no-await-in-loop */

// A real post-create Bee failure retains its owner; no lease silently revives it.
const failingInput = join(root, "failing-input.json");
await Bun.write(
	failingInput,
	JSON.stringify({
		base: "b".repeat(SHA_LENGTH),
		execution: { kind: "missing-kind", mode: "bee" },
		request: "Demonstrate partial effect boundary",
		title: "Failed owner probe",
	}),
);
const failed = await launch("start", source, "--input-file", failingInput);
expect(failed.code).not.toBe(ZERO);
expect(failed.stderr.includes("remains locked")).toBeTruthy();
const trackerResult4 = await tracker(options, [
	"list",
	"--label",
	"busybee-checkpoint",
	"--limit",
	"0",
]);
const checkpoints = trackerResult4.issues;
const PromiseallResult3 = await Promise.all(checkpoints.map((entry) => read(entry.id)));
const abandoned = PromiseallResult3.find((entry) => entry.notes)!;
expect(abandoned).toBeTruthy();
const abandonedRun = z.object({ id: z.string() }).parse(JSON.parse(abandoned.description));
const timeout = await launch("collect", abandonedRun.id);
expect(timeout.code).not.toBe(ZERO);
expect(timeout.stderr.includes("No automatic expiry")).toBeTruthy();
const readResult24 = await read(abandoned.id);
expect(readResult24.notes).toBe(abandoned.notes);
await Bun.write(join(root, "trace.json"), JSON.stringify(trace, undefined, TWO));
await Bun.write(
	join(root, "result.json"),
	JSON.stringify(
		{
			abandoned: abandoned.id,
			automatic: automatic.id,
			commands: trace.length,
			database: options.db,
			held: held.id,
			independent: independent.id,
			manual: manual.id,
			nativeCompletion: {
				child,
				planner: first,
				reviewGroup: group,
				reviewers: reviews.map((entry) => entry.bead),
			},
		},
		undefined,
		TWO,
	),
);
console.log(
	`PASS: ${trace.length} native process results; concurrency, repair, discovery, Bee collection and retained failed owner. ${root}`,
);
