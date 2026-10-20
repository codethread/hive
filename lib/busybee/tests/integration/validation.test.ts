// Integration tests create isolated author modules with independent dependency copies.
/* eslint-disable import/no-nodejs-modules */
import { assign, createMachine } from "xstate";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, test } from "bun:test";
import type { Services } from "../../src/native.ts";
import { createMemoryBeads } from "@hive/beads";
import { createServices } from "../../src/native.ts";
import { invoke } from "./support.ts";
import { tmpdir } from "node:os";
import { validate } from "../../src/definition.ts";
import { z } from "zod";

const FIRST = 0;
const ASSIGNED_COUNT = 1;
const SUCCESS = 0;
const FAILURE = 1;
const exports =
	"export const commandSchemas={next:z.object({})};\nexport function " +
	'runBrief(){return {title:"Example",description:"Example"};}\n';
const schemas = { empty: z.object({}), request: z.object({ request: z.string() }) };
const commonDefinition = {
	commandSchemas: { next: schemas.empty },
	runBrief: () => ({ title: "Example", description: "Example" }),
};

test("validate bad-target without a tracker or live actor #test-374", async () => {
	const fixture = validationServices({
		importModule: () =>
			Promise.resolve({
				...commonDefinition,
				inputSchema: schemas.empty,
				machine: createMachine({ initial: "work", states: { work: { on: { NEXT: "missing" } } } }),
			}),
	});
	const failure = await validate(
		"/busybee-validation/bad-target/workflow.ts",
		undefined,
		fixture.services,
	).catch((error: unknown) => error);
	expect(failure).toBeInstanceOf(Error);
	expect(failure)
		.toMatchInlineSnapshot(`[Error: Invalid transition definition for state node '(machine).work':
Child state 'missing' does not exist on '(machine)']`);
	await assertNoEffects(fixture);
});

test("validate bad-initial without a tracker or live actor #test-58", async () => {
	const fixture = validationServices({
		importModule: () =>
			Promise.resolve({
				...commonDefinition,
				inputSchema: schemas.empty,
				machine: createMachine({ initial: "missing", states: { work: {} } }),
			}),
	});
	const failure = await validate(
		"/busybee-validation/bad-initial/workflow.ts",
		undefined,
		fixture.services,
	).catch((error: unknown) => error);
	expect(failure).toBeInstanceOf(Error);
	expect(failure).toMatchInlineSnapshot(
		`[Error: Initial state node "missing" not found on parent state node #(machine)]`,
	);
	await assertNoEffects(fixture);
});

test("validate initial-error without a tracker or live actor #test-59", async () => {
	const error = new Error("initial failure");
	const fixture = validationServices({
		importModule: () =>
			Promise.resolve({
				...commonDefinition,
				inputSchema: schemas.empty,
				machine: createMachine({
					context: () => {
						throw error;
					},
				}),
			}),
	});
	await expect(
		validate("/busybee-validation/initial-error/workflow.ts", undefined, fixture.services),
	).rejects.toBe(error);
	await assertNoEffects(fixture);
});

test("pure initial validation evaluates assignment but does not start entry effects #test-57", async () => {
	const machine = createMachine({
		context: { count: FIRST },
		initial: "work",
		states: {
			work: {
				entry: [
					assign({ count: () => ASSIGNED_COUNT }),
					() => {
						throw new Error("Validation must not execute entry effects");
					},
				],
				always: { guard: ({ context }) => context.count === ASSIGNED_COUNT, target: "done" },
			},
			done: { type: "final" },
		},
	});
	const fixture = validationServices({
		importModule: () =>
			Promise.resolve({ ...commonDefinition, inputSchema: schemas.empty, machine }),
	});
	const source = "/busybee-validation/pure/workflow.ts";
	expect(await validate(source, undefined, fixture.services)).toEqual({
		checks: ["definition_resolution", "input_schema", "initial_snapshot"],
		source,
		status: "done",
	});
	await assertNoEffects(fixture);
});

test("validate required-input without a tracker or live actor #test-60", async () => {
	const fixture = validationServices({
		importModule: () =>
			Promise.resolve({
				...commonDefinition,
				inputSchema: schemas.request,
				machine: createMachine({}),
			}),
	});
	const source = "/busybee-validation/required-input/workflow.ts";
	const result = await invoke(["validate", source], fixture.services);
	expect(result.code).toBe(FAILURE);
	expect(result.document).toMatchObject({
		kind: "validate",
		ok: false,
		reason: "invalid_input",
		target: source,
	});
	expect(result.stderr).toBe("");
	await assertNoEffects(fixture);
});

test("validate supplied-input without a tracker or live actor #test-61", async () => {
	const reads: string[] = [];
	const fixture = validationServices({
		importModule: () =>
			Promise.resolve({
				...commonDefinition,
				inputSchema: schemas.request,
				machine: createMachine({
					context: ({ input }) => schemas.request.parse(input),
					initial: "work",
					states: {
						work: {
							always: { guard: ({ context }) => context.request === "Work", target: "done" },
						},
						done: { type: "final" },
					},
				}),
			}),
		readText: (path) => {
			reads.push(path);
			return Promise.resolve('{"request":"Work"}');
		},
	});
	const source = "/busybee-validation/supplied-input/workflow.ts";
	const inputFile = "/busybee-validation/supplied-input/input.json";
	const result = await invoke(["validate", source, "--input-file", inputFile], fixture.services);
	expect(reads).toEqual([inputFile]);
	expect(result.code).toBe(SUCCESS);
	expect(result.document).toEqual({
		checks: ["definition_resolution", "input_schema", "initial_snapshot"],
		kind: "validate",
		ok: true,
		source,
		status: "done",
	});
	expect(result.stderr).toBe("");
	await assertNoEffects(fixture);
});

test("global CLI loads repository machines and schemas from independent dependency copies #test-56", async () => {
	const root = await mkdtemp(join(tmpdir(), "busybee-validation-"));
	try {
		const source = await writeIndependentDefinition(join(root, "independent"));
		const fixture = validationServices();
		const result = await invoke(["validate", source], fixture.services);
		expect(result.code).toBe(SUCCESS);
		expect(result.document).toEqual({
			checks: ["definition_resolution", "input_schema", "initial_snapshot"],
			kind: "validate",
			ok: true,
			source,
			status: "active",
		});
		expect(result.stderr).toBe("");
		await assertNoEffects(fixture);
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});

async function writeIndependentDefinition(directory: string): Promise<string> {
	await Promise.all(
		["xstate", "zod"].map((name) =>
			cp(
				dirname(import.meta.resolve(`${name}/package.json`).replace("file://", "")),
				join(directory, "node_modules", name),
				{ recursive: true },
			),
		),
	);
	const source = join(directory, "workflow.ts");
	await Bun.write(
		source,
		`import {createMachine} from "xstate"; import {z} from "zod"; ${exports}` +
			" export const inputSchema=z.object({});export const " +
			'machine=createMachine({initial:"work",states:{work:{}}});',
	);
	return source;
}

function validationServices(overrides: Partial<Services> = {}) {
	const calls: string[][] = [];
	const beads = createMemoryBeads();
	const services: Services = {
		...createServices(),
		actor: undefined,
		beads: {
			...beads,
			where: () => {
				calls.push(["where"]);
				return Promise.reject(new Error("Validation must not invoke tracker operations"));
			},
		},
		beforeWrite: () => {
			calls.push(["beforeWrite"]);
			throw new Error("Validation must not publish effects");
		},
		execute: (argv) => {
			calls.push(argv);
			return Promise.reject(new Error("Validation must not invoke native commands"));
		},
		readBytes: (path) => {
			calls.push(["readBytes", path]);
			return Promise.reject(new Error("Validation must not read provenance"));
		},
		readText: (path) => {
			calls.push(["readText", path]);
			return Promise.reject(new Error("Validation must not read omitted input"));
		},
		...overrides,
	};
	return { beads, calls, services };
}

async function assertNoEffects(fixture: ReturnType<typeof validationServices>): Promise<void> {
	expect(fixture.calls).toEqual([]);
	const result = await fixture.beads.list({ cwd: fixture.services.cwd }, { all: true, limit: 0 });
	expect(result.issues).toEqual([]);
}
