/* eslint-disable unicorn/no-null -- Saved checkpoints encode absent requests as null. */
import type { BeadsScope, UpdateBead } from "@hive/beads";
import { BusyBeeError, createServices, readBead } from "../../src/native.ts";
import { captureCli, invoke } from "./support.ts";
import { discover, navigate } from "../../src/runtime.ts";
import { expect, test } from "bun:test";
import type { Services } from "../../src/native.ts";
import { createMachine } from "xstate";
import { createMemoryBeads } from "@hive/beads";
import { fingerprint } from "../../src/catalogue.ts";
import { readCheckpoint } from "../../src/checkpoint.ts";
import { runSummarySchema } from "../../src/cli.ts";
import { z } from "zod";

const FIRST = 0;
const SUCCESS = 0;
const LONG_BRIEF_REPETITIONS = 1000;
const SIZE_REDUCTION_FACTOR = 10;

const NEXT = 1;
const repo = "/repo";
const db = "/tracker/beads.db";
const folder = "/repo/.workflows/example";
const source = `${folder}/entry.ts`;
const namedLocator = { kind: "named" as const, name: "example", version: "1.0.0" };
const manifest = 'description="Example"\nversion="1.0.0"\nrun="./entry.ts"';
const bytes = new TextEncoder().encode("original").buffer;
const missing = Object.assign(new Error("Missing file"), { code: "ENOENT" });
const denied = Object.assign(new Error("Permission denied"), { code: "EACCES" });
const services: Services = {
	...createServices(),
	cwd: repo,
	isFile: () => Promise.resolve(true),
	readBytes: () => Promise.resolve(bytes),
	readDirectory: () => Promise.resolve([{ kind: "file", name: "entry.ts" }]),
	readText: () => Promise.resolve(manifest),
};
const hash = await fingerprint({ directory: folder, kind: "folder", source }, services);

// One successful start checks its observable CLI, projection and endpoint contract.
// eslint-disable-next-line max-statements
test("start publishes an initial worker and one JSON success document through the CLI/runtime #test-55", async () => {
	const root = "/busybee-start";
	const startDb = `${root}/.beads/beads.startDb`;
	const beads = createMemoryBeads({ db: startDb });
	const parent = await beads.create(
		{ actor: "original-agent", cwd: root, db: startDb },
		{ title: "Original work", owner: "responsible-human" },
	);
	const calls: { operation: string; scope: BeadsScope }[] = [];
	const writes: string[] = [];
	const frozenInstructions = "Complete work\n".repeat(LONG_BRIEF_REPETITIONS);
	let instructions = frozenInstructions;
	const definition = {
		commandSchemas: { next: z.object({}) },
		inputSchema: z.object({}),
		machine: createMachine({
			context: { request: frozenInstructions, internal: "raw-actor-context" },
			initial: "work",
			states: {
				work: {
					meta: {
						title: "Worker",
						task: () => ({ instructions }),
						commands: { next: "NEXT" },
					},
					on: { NEXT: "done" },
				},
				done: { type: "final" },
			},
		}),
		runBrief: () => ({ title: "Example", description: "Example workflow" }),
	};
	const startServices: Services = {
		...createServices(),
		actor: undefined,
		beads: {
			...beads,
			create: (scope, input) => {
				calls.push({ operation: "create", scope });
				writes.push("create");
				return beads.create(scope, input);
			},
			dep: {
				...beads.dep,
				add: (...args) => {
					const [scope] = args;
					calls.push({ operation: "dep.add", scope });
					writes.push("dep.add");
					return beads.dep.add(...args);
				},
			},
			show: (scope, id) => {
				calls.push({ operation: "show", scope });
				return beads.show(scope, id);
			},
			update: (scope, ids, input) => {
				calls.push({ operation: "update", scope });
				writes.push("update");
				return beads.update(scope, ids, input);
			},
			where: (scope) => {
				calls.push({ operation: "where", scope });
				return beads.where(scope);
			},
		},
		beforeWrite: () => {
			writes.push("beforeWrite");
		},
		cwd: root,
		execute: () => Promise.reject(new Error("Workflow behavior must not launch processes")),
		importModule: () => Promise.resolve(definition),
		readBytes: () => Promise.resolve(new ArrayBuffer(FIRST)),
	};
	const result = await captureCli(
		[
			"--actor",
			"starting-agent",
			"--owner",
			"responsible-human",
			"--parent",
			parent.id,
			"start",
			`${root}/workflow.ts`,
			"--json",
		],
		startServices,
	);
	expect(result.code, result.stdout).toBe(SUCCESS);
	expect(result.stderr).toBe("");
	const document: unknown = JSON.parse(result.stdout);
	expect(document).toMatchObject({ kind: "start", ok: true });
	const started = runSummarySchema.parse(document);
	expect(started.status).toBe("active");
	expect(started.active).toMatchObject([{ commands: ["next"], path: [], title: "Worker" }]);
	expect(result.stdout).not.toContain("Complete work");
	expect(result.stdout).not.toContain("raw-actor-context");
	const endpoint = { db: startDb, repo: root };
	const run = await readBead(endpoint, started.id, startServices);
	expect(run).toMatchObject({
		assignee: "starting-agent",
		created_by: "starting-agent",
		owner: "responsible-human",
		status: "in_progress",
	});
	expect(run.dependencies.filter((edge) => edge.dependency_type === "parent-child")).toEqual([
		expect.objectContaining({ id: parent.id }),
	]);
	await expect(
		readBead(endpoint, started.active[FIRST]!.bead, startServices),
	).resolves.toMatchObject({
		assignee: "starting-agent",
		created_by: "starting-agent",
		dependencies: [{ dependency_type: "parent-child", id: started.id }],
		owner: "responsible-human",
		status: "in_progress",
	});
	const records = await beads.list({ cwd: root, db: startDb }, { all: true, limit: 0 });
	const checkpoint = records.issues.find((record) => record.labels.includes("busybee-checkpoint"))!;
	const saved = await beads.show({ cwd: root, db: startDb }, checkpoint.id);
	expect(saved.notes).toBe("");
	expect(readCheckpoint(saved)).toMatchObject({
		active: [{ bead: started.active[FIRST]!.bead }],
		id: started.id,
		snapshot: { status: "active", value: "work" },
	});
	for (const { operation, scope } of calls) {
		expect(scope.cwd).toBe(root);
		if (operation !== "where") {
			expect(scope.db).toBe(startDb);
		}
		if (["create", "dep.add", "update"].includes(operation)) {
			expect(scope.actor).toBe("starting-agent");
		}
	}
	expect(writes).toEqual(
		calls
			.filter(({ operation }) => ["create", "dep.add", "update"].includes(operation))
			.flatMap(({ operation }) => ["beforeWrite", operation]),
	);
	instructions = "Changed renderer after publication";
	const shown = await invoke(["show", started.id], startServices);
	expect(shown.code).toBe(SUCCESS);
	expect(shown.document).toMatchObject({ kind: "show", ok: true, ...started });
	expect(shown.stdout).not.toContain("Complete work");
	expect(shown.stdout).not.toContain("raw-actor-context");
	const expanded = await invoke(["show", started.id, "--instructions"], startServices);
	expect(expanded.code).toBe(SUCCESS);
	expect(expanded.document).toMatchObject({
		kind: "show",
		ok: true,
		active: [{ ...started.active[FIRST], instructions: frozenInstructions }],
	});
	expect(expanded.stdout).not.toContain("raw-actor-context");
	expect(Buffer.byteLength(shown.stdout)).toBeLessThan(
		Buffer.byteLength(expanded.stdout) / SIZE_REDUCTION_FACTOR,
	);
	const collected = await invoke(
		["--actor", "starting-agent", "collect", started.id],
		startServices,
	);
	expect(collected.code).toBe(SUCCESS);
	expect(collected.document).toMatchObject({ kind: "collect", ok: true, ...started });
	expect(collected.stdout).not.toContain("Complete work");
	expect(collected.stdout).not.toContain("raw-actor-context");
});
// Inspect the complete recovery diagnostic and preservation proof together.
// eslint-disable-next-line max-statements
test("show rejects a changed named checkpoint before import with authorized same-scope recovery #test-54", async () => {
	const fixture = await retainedRun({
		readText: () => Promise.resolve(manifest.replace("1.0.0", "2.0.0")),
	});
	const error = await inspect("show", fixture);
	expect(error).toBeInstanceOf(BusyBeeError);
	expect(error).toMatchObject({
		context: {
			db,
			name: "example",
			repo,
			runId: fixture.id,
			stageIds: ["completed"],
			stageRequestIds: ["completed-request"],
			acceptedResults: [{ bead: "completed", command: "next", request: "completed-request" }],
			nextAction: `br show ${fixture.id} --json`,
		},
		reason: "definition_changed",
	});
	expect(error.message).toContain("same already-authorized scope without asking the user again");
	expect(error.message).toContain("busybee input-schema example");
	expect(error.message).toContain("busybee run example");
	expect(error.message).toContain("Inspect completed and uncertain effects");
	expect(error.message).toContain("Retain the old run as history");
	expect(error.message).toContain("--parent ORIGINAL_PARENT");
	expect(error.message).toContain("replacement completion does not complete them");
	const response = await invoke(["show", fixture.id], fixture.io);
	expect(response.document).toMatchObject({
		ok: false,
		kind: "show",
		reason: "definition_changed",
		runId: fixture.id,
		stageIds: ["completed"],
		stageRequestIds: ["completed-request"],
		nextAction: `br show ${fixture.id} --json`,
	});
	expect(response.stderr).toBe("");
	await fixture.assertPreserved();
});

test("discover requires user selection when the saved named folder is absent #test-48", async () => {
	const fixture = await retainedRun({ readDirectory: () => Promise.reject(missing) });
	const error = await inspect("discover", fixture);
	expect(error).toBeInstanceOf(BusyBeeError);
	expect(error).toMatchObject({
		context: { db, name: "example", repo, runId: fixture.id },
		reason: "workflow_missing",
	});
	expect(error.message).toMatchInlineSnapshot(
		'"Cannot restore run mem-1: named workflow example is missing. Stop ' +
			"and ask the user which workflow to use; do not infer a replacement " +
			'for example."',
	);
	await fixture.assertPreserved();
});

test("collect releases ownership after restoration refusal without publishing tasks #test-47", async () => {
	const fixture = await retainedRun({
		readText: () => Promise.resolve(manifest.replace("1.0.0", "2.0.0")),
	});
	const error = await inspect("collect", fixture);
	expect(error).toBeInstanceOf(BusyBeeError);
	expect(error).toMatchObject({ reason: "definition_changed" });
	await fixture.assertPreserved();
	expect(fixture.updates.map((input) => input.notes)).toEqual([expect.any(String), ""]);
	expect(JSON.parse(fixture.updates[FIRST]!.notes!)).toMatchObject({
		owner: expect.any(String),
		pid: fixture.io.pid,
	});
});

test.each([
	{ error: missing, name: "missing manifest #test-53", operation: "readText" },
	{ error: denied, name: "manifest permission failure #test-50", operation: "readText" },
	{ error: missing, name: "missing entry #test-51", operation: "isFile" },
	{ error: missing, name: "missing file during fingerprint #test-52", operation: "readBytes" },
	{ error: denied, name: "folder permission failure #test-49", operation: "readDirectory" },
])("restoration preserves the actual $name", async ({ error, operation }) => {
	const fixture = await retainedRun({ [operation]: () => Promise.reject(error) });
	expect(await inspect("show", fixture)).toBe(error);
	await fixture.assertPreserved();
});

test("an existing malformed manifest remains a parse failure #test-44", async () => {
	const fixture = await retainedRun({ readText: () => Promise.resolve('description="Bad"\nrun=') });
	const error = await inspect("show", fixture);
	expect(error).toBeInstanceOf(Error);
	expect(error).not.toBeInstanceOf(BusyBeeError);
	await fixture.assertPreserved();
});

test("an unchanged definition's import failure is not a missing workflow #test-45", async () => {
	const fixture = await retainedRun({ importModule: () => Promise.reject(missing) });
	expect(await inspect("show", fixture)).toBe(missing);
	await fixture.assertPreserved();
});

test("changed explicit-file runs keep their source-based diagnostic #test-46", async () => {
	const fixture = await retainedRun(
		{ readBytes: () => Promise.resolve(new TextEncoder().encode("edited").buffer) },
		{ kind: "source", source },
	);
	const error = await inspect("show", fixture);
	expect(error).toBeInstanceOf(BusyBeeError);
	expect(error).toMatchObject({ reason: "definition_changed" });
	expect(error.message).toMatchInlineSnapshot(
		'"Workflow definition changed; inspect the current source at ' +
			"/repo/.workflows/example/entry.ts and start a fresh run. Inspect br show mem-1 --json " +
			"and retained visits first; preserve their evidence and native parent when handing off " +
			'remaining work. Leave unfinished old work open; replacement completion does not complete it."',
	);
	await fixture.assertPreserved();
});

async function inspect(operation: string, fixture: { id: string; io: Services }): Promise<Error> {
	const { id, io } = fixture;
	const inspections: Record<string, () => Promise<unknown>> = {
		show: () => navigate({ id, operation: "show" }, {}, io),
		collect: () => navigate({ id, operation: "collect" }, {}, io),
		discover: () => discover(id, {}, io),
	};
	try {
		await inspections[operation]!();
	} catch (error) {
		if (error instanceof Error) {
			return error;
		}
		throw error;
	}
	throw new Error("Expected restoration to fail");
}

// Keep one retained checkpoint fixture and its observation boundary together.
// eslint-disable-next-line max-statements
async function retainedRun(
	overrides: Partial<Services>,
	definition:
		| { kind: "named"; name: string; version: string }
		| { kind: "source"; source: string } = namedLocator,
) {
	const beads = createMemoryBeads({ db });
	const scope = { actor: "test-agent", cwd: repo, db };
	const parent = await beads.create(scope, { title: "Run", owner: "ct" });
	let retainedHash = hash;
	if (definition.kind === "source") {
		retainedHash = await fingerprint({ kind: "file", source: definition.source }, services);
	}
	const description = JSON.stringify({
		formatVersion: 1,
		active: [],
		created: [
			{
				bead: "completed",
				node: "first",
				parent: parent.id,
				path: [],
				request: "completed-request",
				visit: 1,
			},
		],
		definition,
		hash: retainedHash,
		history: [{ bead: "completed", command: "next", data: {}, request: "completed-request" }],
		id: parent.id,
		snapshot: {},
		visits: { first: 1 },
	});
	const checkpoint = await beads.create(scope, {
		title: "Checkpoint",
		description,
		labels: ["system", "busybee-checkpoint"],
		owner: "ct",
	});
	await beads.dep.add(scope, parent.id, checkpoint.id, "related");
	const before = await beads.list(scope, { all: true, limit: 0 });
	const updates: UpdateBead[] = [];
	let imports = FIRST;
	const io: Services = {
		...services,
		actor: "test-agent",
		beads: {
			...beads,
			update: (selected, ids, input) => {
				updates.push(input);
				return beads.update(selected, ids, input);
			},
		},
		execute: () => Promise.resolve(repo),
		importModule: () => {
			imports += NEXT;
			throw new Error("Mismatched definitions must not be imported");
		},
		...overrides,
	};
	return {
		id: parent.id,
		io,
		updates,
		assertPreserved: async () => {
			expect(imports).toBe(FIRST);
			expect(await beads.show(scope, checkpoint.id)).toMatchObject({ description, notes: "" });
			const after = await beads.list(scope, { all: true, limit: 0 });
			expect(after.issues.map(({ id }) => id)).toEqual(before.issues.map(({ id }) => id));
		},
	};
}
