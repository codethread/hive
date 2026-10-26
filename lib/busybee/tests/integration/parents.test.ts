import { complete, navigate, start, startNamed } from "../../src/runtime.ts";
import { createMachine, setup } from "xstate";
import { expect, test } from "bun:test";
import type { CreateBead } from "@hive/beads";
import type { Services } from "../../src/native.ts";
import { createMemoryBeads } from "@hive/beads";
import { createServices } from "../../src/native.ts";
import { invoke } from "./support.ts";
import { readCheckpoint } from "../../src/checkpoint.ts";
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
				meta: {
					title: "Group",
					task: () => ({
						acceptanceCriteria: "- [ ] Nested work verified",
						instructions: "Complete nested work",
					}),
				},
				invoke: { id: "child", src: "child", onDone: "done" },
			},
			done: { type: "final" },
		},
	}),
};
const ordinaryTypes = ["bug", "feature", "epic"];
const commands = ["run", "start"];
const ordinaryCases = commands
	.flatMap((command) => ordinaryTypes.map((type) => ({ command, type })))
	.filter(({ command, type }) => command !== "run" || type !== "bug");
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

test.each(ordinaryCases)(
	"engine API for $command creates one native edge to ordinary $type work without claiming it #test-343",
	async ({ command, type }) => {
		const { beads, parent, services } = await fixture({ type });
		const run = await createParentedRun(command, parent.id, services);
		expect(run.status).toBe("active");
		const record = await beads.show(scope, run.id);
		expect(record.labels).toEqual(["busybee-workflow"]);
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

test(
	"nested actors keep visits below the run, a related checkpoint and an unclosed " +
		"ordinary parent #test-419",
	// eslint-disable-next-line max-statements
	async () => {
		const { beads, parent, services } = await fixture();
		const io = { ...services, importModule: () => Promise.resolve(nestedDefinition) };
		const nestedRun = await start(source, { owner: "ct", parent: parent.id }, io);
		const root = await beads.show(scope, nestedRun.id);
		const group = nestedRun.active.find((entry) => entry.title === "Group")!;
		const worker = nestedRun.active.find((entry) => entry.title === "Work")!;
		expect(worker.path).toEqual(["child"]);
		const groupRecord = await beads.show(scope, group.bead);
		expect(groupRecord.acceptance_criteria).toBe("- [ ] Nested work verified");
		expect(groupRecord.description).not.toContain("Nested work verified");
		expect(groupRecord.dependencies).toEqual([
			expect.objectContaining({ id: nestedRun.id, dependency_type: "parent-child" }),
		]);
		const workerRecord = await beads.show(scope, worker.bead);
		expect(workerRecord.dependencies).toEqual([
			expect.objectContaining({ id: group.bead, dependency_type: "parent-child" }),
		]);
		const checkpoint = root.dependencies.find((edge) => edge.dependency_type === "related")!;
		const checkpointRecord = await beads.show(scope, checkpoint.id);
		expect(root.labels).toEqual(["busybee-workflow"]);
		expect(groupRecord.labels).toEqual(["busybee-workflow"]);
		expect(workerRecord.labels).toEqual(["busybee-workflow"]);
		expect(checkpointRecord.labels).toEqual(["busybee-checkpoint", "system"]);
		expect(checkpointRecord.dependencies).toEqual([]);
		const records = await beads.list(scope, { all: true, limit: FIRST });
		expect(records.issues.map(({ id }) => id).toSorted()).toEqual(
			[parent.id, nestedRun.id, checkpoint.id, group.bead, worker.bead].toSorted(),
		);
		await complete({ id: nestedRun.id, bead: worker.bead, choice: "next", data: {} }, {}, io);
		await expect(
			navigate({ id: nestedRun.id, operation: "collect" }, {}, io),
		).rejects.toMatchObject({
			reason: "acceptance_unchecked",
		});
		const advanced = readCheckpoint(await beads.show(scope, checkpoint.id));
		expect(advanced).toMatchObject({
			active: [],
			history: [expect.objectContaining({ bead: worker.bead })],
			snapshot: { status: "done" },
		});
		await beads.update(scope, [group.bead], {
			acceptanceCriteria: "- [x] Nested work verified",
		});
		const done = await navigate({ id: nestedRun.id, operation: "collect" }, {}, io);
		expect(done.status).toBe("done");
		const retried = readCheckpoint(await beads.show(scope, checkpoint.id));
		expect(retried.history).toEqual(advanced.history);
		expect(retried.created).toEqual(advanced.created);
		expect(await beads.show(scope, nestedRun.id)).toMatchObject({ status: "closed" });
		expect(await beads.show(scope, group.bead)).toMatchObject({ status: "closed" });
		expect(await beads.show(scope, parent.id)).toMatchObject(parent);
	},
);

// --- Private helpers ---

function createParentedRun(command: string, parent: string, services: Services) {
	const options = { owner: "ct", parent };
	if (command === "run") {
		return startNamed("example", options, services);
	}
	return start(source, options, services);
}

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
