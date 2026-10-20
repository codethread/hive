import { CommandError, createMemoryBeads } from "@hive/beads";
import { createMachine, setup } from "xstate";
import { expect, test } from "bun:test";
import { navigate, recordResult, start, startNamed } from "../../src/runtime.ts";
import type { CreateBead } from "@hive/beads";
import type { Services } from "../../src/native.ts";
import { createServices } from "../../src/native.ts";
import { invoke } from "./support.ts";
import { runSummarySchema } from "../../src/cli.ts";
import { z } from "zod";

const FIRST = 0;
const FAILURE = 1;
const repo = "/parented-workflow";
const db = "/selected-tracker/beads.db";
const source = `${repo}/workflow.ts`;
const scope = { actor: "workflow-agent", cwd: repo, db };
const meta = {
	title: "Work",
	commands: { next: "NEXT" },
	task: () => ({ instructions: "Complete work" }),
};
const child = createMachine({
	id: "child-work",
	context: { group: "parented.group" },
	initial: "work",
	states: {
		work: { meta, on: { NEXT: "done" } },
		done: { type: "final" },
	},
});
const definition = {
	inputSchema: z.object({}),
	commandSchemas: { next: z.object({}) },
	runBrief: () => ({ title: "Run", description: "Complete original work" }),
	machine: createMachine({
		initial: "work",
		states: { work: { meta, on: { NEXT: "done" } }, done: { type: "final" } },
	}),
};
const nestedDefinition = {
	...definition,
	machine: setup({ actors: { child } }).createMachine({
		id: "parented",
		initial: "group",
		states: {
			group: {
				meta: { title: "Group", task: () => ({ instructions: "Complete nested work" }) },
				invoke: { id: "child", src: "child", onDone: "done" },
			},
			done: { type: "final" },
		},
	}),
};
const ordinaryTypes = ["task", "bug", "feature", "epic"];
const commands = ["run", "start"];
const invalidParents = [
	{ name: "missing", reason: "missing_parent", supplied: false, status: "open", labels: [] },
	{ name: "nonexistent", reason: "command_failed", supplied: true, status: "open", labels: [] },
	{ name: "closed", reason: "invalid_parent", supplied: true, status: "closed", labels: [] },
	{
		name: "spawn",
		reason: "invalid_parent",
		supplied: true,
		status: "open",
		labels: ["system", "bee"],
	},
	{
		name: "checkpoint",
		reason: "invalid_parent",
		supplied: true,
		status: "open",
		labels: ["system", "busybee-checkpoint"],
	},
];

// Warm the public creation boundary and the nested chart before measuring memory-backed cases.
const warmup = await fixture();
await invoke(creationArgs("start", warmup.parent.id), warmup.services);
await invoke(creationArgs("run", warmup.parent.id), warmup.services);
const nestedWarmup = await fixture();
const nestedIo = {
	...nestedWarmup.services,
	importModule: () => Promise.resolve(nestedDefinition),
};
const nestedWarmupRun = await start(
	source,
	{ owner: "ct", parent: nestedWarmup.parent.id },
	nestedIo,
);
const nestedWarmupWorker = nestedWarmupRun.active.find((entry) => entry.title === "Work")!;
await nestedWarmup.beads.close(scope, nestedWarmupWorker.bead);
await navigate(
	{
		id: nestedWarmupRun.id,
		operation: "submit",
		bead: nestedWarmupWorker.bead,
		choice: "next",
		data: {},
	},
	{},
	nestedIo,
);
const nested = await fixture();
const nestedRun = await start(
	source,
	{ owner: "ct", parent: nested.parent.id },
	{
		...nested.services,
		importModule: () => Promise.resolve(nestedDefinition),
	},
);
const retainedSibling = await fixture();
const abandoned = await startNamed(
	"example",
	{ owner: "ct", parent: retainedSibling.parent.id },
	retainedSibling.services,
);
const replacementIo = {
	...retainedSibling.services,
	readText: () => Promise.resolve('description="Example"\nversion="2.0.0"\nrun="./workflow.ts"'),
};
const replacement = await startNamed(
	"example",
	{ owner: "ct", parent: retainedSibling.parent.id },
	replacementIo,
);
const replacementVisit = replacement.active[FIRST]!.bead;
await recordResult(
	{ id: replacement.id, bead: replacementVisit, choice: "next", data: {} },
	{},
	replacementIo,
);
await retainedSibling.beads.close(scope, replacementVisit);
const replacementDone = await navigate(
	{ id: replacement.id, operation: "collect" },
	{},
	replacementIo,
);

test.each(commands.flatMap((command) => ordinaryTypes.map((type) => ({ command, type }))))(
	"$command creates exactly one native edge to ordinary $type work without claiming it #test-343",
	async ({ command, type }) => {
		const { beads, parent, services } = await fixture({ type });
		const result = await invoke(creationArgs(command, parent.id), services);
		expect(result.code, result.stdout).toBe(FIRST);
		const run = runSummarySchema.parse(result.document);
		const record = await beads.show(scope, run.id);
		expect(record.dependencies.filter((edge) => edge.dependency_type === "parent-child")).toEqual([
			expect.objectContaining({ id: parent.id }),
		]);
		expect(await beads.show(scope, parent.id)).toMatchObject(parent);
	},
);

test.each(
	commands.flatMap((command) =>
		invalidParents.map(({ name, reason, supplied, status, labels }) => ({
			command,
			name,
			reason,
			supplied,
			status,
			labels,
		})),
	),
)(
	"$command rejects a $name parent before publishing any workflow effects #test-536",
	// eslint-disable-next-line max-statements -- Verify the rejection and unchanged tracker together.
	async ({ command, name, reason, supplied, status, labels }) => {
		const { beads, parent, services } = await fixture({ status, labels });
		const before = await beads.list(scope, { all: true, limit: FIRST });
		let parentId = parent.id;
		if (name === "nonexistent") {
			parentId = "absent";
		}
		const args = creationArgs(command);
		if (supplied) {
			args.push("--parent", parentId);
		}
		const result = await invoke(args, {
			...services,
			beforeWrite: () => {
				throw new Error("Invalid parent must fail before any publication write");
			},
		});
		expect(result.code).toBe(FAILURE);
		expect(result.document).toMatchObject({ kind: command, ok: false, reason });
		expect(await beads.list(scope, { all: true, limit: FIRST })).toEqual(before);
	},
);

// Inspect the complete native hierarchy and finish the nested actor through public navigation.

test(
	"nested actors keep visits below the run, a related checkpoint and an unclosed " +
		"ordinary parent #test-419",
	// eslint-disable-next-line max-statements
	async () => {
		const { beads, parent, services } = nested;
		const io = { ...services, importModule: () => Promise.resolve(nestedDefinition) };
		const root = await beads.show(scope, nestedRun.id);
		const group = nestedRun.active.find((entry) => entry.title === "Group")!;
		const worker = nestedRun.active.find((entry) => entry.title === "Work")!;
		expect(worker.path).toEqual(["child"]);
		const groupRecord = await beads.show(scope, group.bead);
		expect(groupRecord.dependencies).toEqual([
			expect.objectContaining({ id: nestedRun.id, dependency_type: "parent-child" }),
		]);
		const workerRecord = await beads.show(scope, worker.bead);
		expect(workerRecord.dependencies).toEqual([
			expect.objectContaining({ id: group.bead, dependency_type: "parent-child" }),
		]);
		const checkpoint = root.dependencies.find((edge) => edge.dependency_type === "related")!;
		const checkpointRecord = await beads.show(scope, checkpoint.id);
		expect(checkpointRecord.dependencies).toEqual([]);
		const records = await beads.list(scope, { all: true, limit: FIRST });
		expect(records.issues.map(({ id }) => id).toSorted()).toEqual(
			[parent.id, nestedRun.id, checkpoint.id, group.bead, worker.bead].toSorted(),
		);
		await beads.close(scope, worker.bead);
		const done = await navigate(
			{ id: nestedRun.id, operation: "submit", bead: worker.bead, choice: "next", data: {} },
			{},
			io,
		);
		expect(done.status).toBe("done");
		expect(await beads.show(scope, nestedRun.id)).toMatchObject({ status: "closed" });
		expect(await beads.show(scope, group.bead)).toMatchObject({ status: "closed" });
		expect(await beads.show(scope, parent.id)).toMatchObject(parent);
	},
);

test("completed incompatible replacement preserves the old sibling and cannot complete their parent", async () => {
	const { beads, parent } = retainedSibling;
	expect(replacementDone.status).toBe("done");
	expect(await beads.show(scope, replacement.id)).toMatchObject({
		status: "closed",
		dependencies: expect.arrayContaining([
			expect.objectContaining({ id: parent.id, dependency_type: "parent-child" }),
		]),
	});
	expect(await beads.show(scope, abandoned.id)).toMatchObject({
		status: "in_progress",
		dependencies: expect.arrayContaining([
			expect.objectContaining({ id: parent.id, dependency_type: "parent-child" }),
		]),
	});
	expect(await beads.show(scope, abandoned.active[FIRST]!.bead)).toMatchObject({
		status: "in_progress",
		notes: "",
	});
	await expect(beads.close(scope, parent.id)).rejects.toBeInstanceOf(CommandError);
	expect(await beads.show(scope, parent.id)).toMatchObject({
		status: "in_progress",
		assignee: parent.assignee,
	});
});

// --- Private helpers ---

async function fixture(input: Partial<CreateBead> = {}) {
	const beads = createMemoryBeads({ db });
	const parent = await beads.create(scope, {
		title: "Original work",
		owner: "ct",
		assignee: "original-worker",
		status: "in_progress",
		...input,
	});
	const services: Services = {
		...createServices(),
		actor: scope.actor,
		beads,
		cwd: repo,
		execute: () => Promise.resolve(repo),
		importModule: () => Promise.resolve(definition),
		isFile: () => Promise.resolve(true),
		readBytes: () => Promise.resolve(new ArrayBuffer(FIRST)),
		readDirectory: () => Promise.resolve([{ kind: "file", name: "workflow.ts" }]),
		readText: () => Promise.resolve('description="Example"\nversion="1.0.0"\nrun="./workflow.ts"'),
	};
	return { beads, parent, services };
}

function creationArgs(command: string, parentId?: string): string[] {
	let target = source;
	if (command === "run") {
		target = "example";
	}
	const args = [command, target, "--owner", "ct"];
	if (parentId) {
		args.push("--parent", parentId);
	}
	return args;
}
