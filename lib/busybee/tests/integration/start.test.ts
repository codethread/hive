/* eslint-disable unicorn/no-null -- Saved checkpoints encode absent requests as null. */
import type { BeadsScope, UpdateBead } from "@hive/beads";
import { BusyBeeError, createServices, readBead } from "../../src/native.ts";
import { discover, navigate, runViewSchema } from "../../src/runtime.ts";
import { expect, test } from "bun:test";
import type { Services } from "../../src/native.ts";
import { captureCli } from "./support.ts";
import { createMachine } from "xstate";
import { createMemoryBeads } from "@hive/beads";
import { fingerprint } from "../../src/catalogue.ts";
import { z } from "zod";

const FIRST = 0;
const SUCCESS = 0;

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

// eslint-disable-next-line max-statements -- One successful start checks its observable CLI, projection and endpoint contract.
test("start publishes an initial worker and one JSON success document through the CLI/runtime", async () => {
	const root = "/busybee-start";
	const startDb = `${root}/.beads/beads.startDb`;
	const beads = createMemoryBeads({ db: startDb });
	const calls: { operation: string; scope: BeadsScope }[] = [];
	const writes: string[] = [];
	const definition = {
		commandSchemas: { next: z.object({}) },
		inputSchema: z.object({}),
		machine: createMachine({
			initial: "work",
			states: {
				work: {
					meta: {
						title: "Worker",
						task: () => ({ instructions: "Complete work" }),
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
	const started = runViewSchema.parse(document);
	expect(started.status).toBe("active");
	expect(started.active).toMatchObject([
		{ commands: ["next"], context: {}, instructions: "Complete work", path: [], title: "Worker" },
	]);
	const endpoint = { db: startDb, repo: root };
	await expect(readBead(endpoint, started.id, startServices)).resolves.toMatchObject({
		assignee: "starting-agent",
		created_by: "starting-agent",
		owner: "responsible-human",
		status: "in_progress",
	});
	await expect(
		readBead(endpoint, started.active[FIRST]!.bead, startServices),
	).resolves.toMatchObject({
		assignee: "starting-agent",
		created_by: "starting-agent",
		dependencies: [{ dependency_type: "parent-child", id: started.id }],
		owner: "responsible-human",
		status: "in_progress",
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
});
test("show rejects a changed named checkpoint before import with authorized same-scope recovery", async () => {
	const fixture = await retainedRun({
		readText: () => Promise.resolve(manifest.replace("1.0.0", "2.0.0")),
	});
	const error = await inspect("show", fixture);
	expect(error).toBeInstanceOf(BusyBeeError);
	expect(error).toMatchObject({
		context: { db, name: "example", repo, run: fixture.id },
		reason: "definition_changed",
	});
	expect(error.message).toContain("same already-authorized scope without asking the user again");
	expect(error.message).toContain("busybee input-schema example");
	expect(error.message).toContain("busybee run example");
	expect(error.message).toContain("Inspect completed and uncertain effects");
	expect(error.message).toContain("Retain the old run as history");
	await fixture.assertPreserved();
});

test("discover requires user selection when the saved named folder is absent", async () => {
	const fixture = await retainedRun({ readDirectory: () => Promise.reject(missing) });
	const error = await inspect("discover", fixture);
	expect(error).toBeInstanceOf(BusyBeeError);
	expect(error).toMatchObject({
		context: { db, name: "example", repo, run: fixture.id },
		reason: "workflow_missing",
	});
	expect(error.message).toMatchInlineSnapshot(
		`"Cannot restore run mem-1: named workflow example is missing. Stop and ask the user which workflow to use; do not infer a replacement for example."`,
	);
	await fixture.assertPreserved();
});

test("collect releases ownership after restoration refusal without publishing tasks", async () => {
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
	{ error: missing, name: "missing manifest", operation: "readText" },
	{ error: denied, name: "manifest permission failure", operation: "readText" },
	{ error: missing, name: "missing entry", operation: "isFile" },
	{ error: missing, name: "missing file during fingerprint", operation: "readBytes" },
	{ error: denied, name: "folder permission failure", operation: "readDirectory" },
])("restoration preserves the actual $name", async ({ error, operation }) => {
	const fixture = await retainedRun({ [operation]: () => Promise.reject(error) });
	expect(await inspect("show", fixture)).toBe(error);
	await fixture.assertPreserved();
});

test("an existing malformed manifest remains a parse failure", async () => {
	const fixture = await retainedRun({ readText: () => Promise.resolve('description="Bad"\nrun=') });
	const error = await inspect("show", fixture);
	expect(error).toBeInstanceOf(Error);
	expect(error).not.toBeInstanceOf(BusyBeeError);
	await fixture.assertPreserved();
});

test("an unchanged definition's import failure is not a missing workflow", async () => {
	const fixture = await retainedRun({ importModule: () => Promise.reject(missing) });
	expect(await inspect("show", fixture)).toBe(missing);
	await fixture.assertPreserved();
});

test("changed explicit-file runs keep their source-based diagnostic", async () => {
	const fixture = await retainedRun({}, { kind: "source", source });
	const error = await inspect("show", fixture);
	expect(error).toBeInstanceOf(BusyBeeError);
	expect(error).toMatchObject({ reason: "definition_changed" });
	expect(error.message).toMatchInlineSnapshot(
		`"Workflow definition changed; inspect the current source at /repo/.workflows/example/entry.ts and start a fresh run."`,
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

// eslint-disable-next-line max-statements -- Keep one retained checkpoint fixture and its observation boundary together.
async function retainedRun(
	overrides: Partial<Services>,
	definition:
		| { kind: "named"; name: string; version: string }
		| { kind: "source"; source: string } = namedLocator,
) {
	const beads = createMemoryBeads({ db });
	const scope = { actor: "test-agent", cwd: repo, db };
	const parent = await beads.create(scope, { title: "Run", owner: "ct" });
	const description = JSON.stringify({
		formatVersion: 1,
		active: [],
		created: [
			{ bead: "completed", node: "first", parent: parent.id, path: [], request: null, visit: 1 },
		],
		definition,
		hash,
		history: [{ bead: "completed", command: "next", data: {}, request: null }],
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
