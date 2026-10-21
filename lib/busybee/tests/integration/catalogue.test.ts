// Catalogue integration uses disposable authoring checkouts and memory tracking.
/* eslint-disable import/no-nodejs-modules */
import { BusyBeeError, createServices } from "../../src/native.ts";
import { captureCli, invoke, useRepositoryFixture } from "./support.ts";
import { describe, expect, mock, test } from "bun:test";
import type { RepositoryFixture } from "./support.ts";
import { createMemoryBeads } from "@hive/beads";
import { fingerprint } from "../../src/catalogue.ts";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { startNamed } from "../../src/runtime.ts";
import { z } from "zod";

const SUCCESS = 0;
const manifest = 'description = "A two-step workflow"\nversion = "1.0.0"\nrun = "./entry.ts"\n';

describe("checkout catalogue discovery", () => {
	const fixture = useRepositoryFixture("busybee-catalogue-");

	test(
		"listing finds checkout metadata from nested and explicit " +
			"repositories without importing code or selecting a tracker #test-14",
		async () => {
			const { marker, repo } = await prepareCatalogue(fixture);
			const nested = join(repo, "src/nested");
			await mkdir(nested, { recursive: true });
			const services = {
				...fixture.services,
				cwd: nested,
				beads: {
					...fixture.services.beads,
					where: () => Promise.reject(new Error("Metadata listing must not select a tracker")),
				},
			};
			const listed = await invoke(["list"], services);
			expect(listed.document).toMatchObject({
				workflows: [
					{
						description: "A two-step workflow",
						name: "example",
						run: "./entry.ts",
						version: "1.0.0",
					},
				],
			});
			await expect(
				invoke(["--repo", nested, "list"], { ...services, cwd: fixture.root }),
			).resolves.toMatchObject({ document: listed.document });
			const readable = await captureCli(["list"], services);
			expect(readable.stdout).toContain("example (1.0.0): A two-step workflow");
			expect(await Bun.file(marker).exists()).toBe(false);
		},
	);

	test(
		"named input discovery evaluates the entry and exposes its " +
			"authoritative and readable constraints #test-15",
		async () => {
			const { marker, repo } = await prepareCatalogue(fixture);
			const services = {
				...fixture.services,
				cwd: repo,
				readBytes: mock(() =>
					Promise.reject(new Error("Schema discovery must not fingerprint files")),
				),
			};
			const schema = await invoke(["input-schema", "example"], services);
			expect(schema.document).toMatchObject({
				schema: { properties: { meals: { default: 1, exclusiveMinimum: 0, type: "integer" } } },
			});
			expect(await Bun.file(marker).text()).toBe("First task");
			const readable = await captureCli(["input-schema", "example"], services);
			expect(readable.stdout).toContain("--json for the complete authoritative schema");
			expect(readable.stderr).toBe("");
			expect(services.readBytes).not.toHaveBeenCalled();
		},
	);
});

test.each(["yarn.lock"])(
	"named provenance includes shared %s and excludes generated dependency trees",
	async (filename) => {
		const directory = "/catalogue-validation/.workflows/example";
		let content = new TextEncoder().encode("original").buffer;
		const services = {
			...createServices(),
			readDirectory: (path: string) => {
				if (path.endsWith("node_modules")) {
					throw new Error("Provenance must not traverse installed dependencies");
				}
				let name: string = filename;
				if (path === directory) {
					name = "workflow.ts";
				}
				return Promise.resolve([
					{ kind: "file" as const, name },
					{ kind: "directory" as const, name: "node_modules" },
				]);
			},
			readBytes: (path: string) => {
				if (path.endsWith(filename)) {
					return Promise.resolve(content);
				}
				return Promise.resolve(new ArrayBuffer(SUCCESS));
			},
		};
		const source = { directory, kind: "folder" as const, source: join(directory, "workflow.ts") };
		const original = await fingerprint(source, services);
		content = new TextEncoder().encode("changed").buffer;
		expect(await fingerprint(source, services)).not.toBe(original);
	},
);

test.each([
	{
		name: "non-file entry",
		reason: "invalid_entry",
		source: 'description="Non-file"\nversion="1.0.0"\nrun="./entry.ts"',
	},
	{ name: "invalid TOML", reason: "command_failed", source: 'description="Bad syntax"\nrun=' },
	{
		name: "escaping entry",
		reason: "invalid_manifest",
		source: 'description="Escape"\nversion="1.0.0"\nrun="../example/entry.ts"',
	},
])("an invalid manifest with $name fails before workflow creation", async ({ source, reason }) => {
	const services = manifestServices(source);
	const failure: unknown = await startNamed(
		"invalid",
		{ actor: "test-agent", owner: "test-human" },
		services,
	).catch((error: unknown) => error);
	if (reason === "command_failed") {
		expect(failure).toBeInstanceOf(SyntaxError);
	} else {
		expect(failure).toBeInstanceOf(BusyBeeError);
		expect(failure).toMatchObject({ reason });
	}
	await assertNoCreation(services);
});

test.each([
	{ name: "absent", reason: "workflow_missing", testId: "" },
	{ name: "../example", reason: "invalid_input", testId: "#test-12" },
])("an unresolved workflow name $name fails before creation $testId", async ({ name, reason }) => {
	const services = manifestServices();
	const failure: unknown = await startNamed(
		name,
		{ actor: "test-agent", owner: "test-human" },
		services,
	).catch((error: unknown) => error);
	if (reason === "workflow_missing") {
		expect(failure).toBeInstanceOf(BusyBeeError);
		expect(failure).toMatchObject({ context: { name, repo: services.cwd }, reason });
	} else {
		expect(failure).toBeInstanceOf(z.ZodError);
		expect(failure).toMatchObject({ issues: [{ code: "invalid_format", path: [] }] });
		expect(services.readDirectory).not.toHaveBeenCalled();
	}
	expect(services.readText).not.toHaveBeenCalled();
	await assertNoCreation(services);
});

test("the CLI maps a malformed manifest to a command failure without creation #test-16", async () => {
	const services = manifestServices('description="Bad syntax"\nrun=');
	const result = await invoke(
		["--actor", "test-agent", "--owner", "test-human", "run", "invalid"],
		services,
	);
	expect(result.code).not.toBe(SUCCESS);
	expect(result.document).toMatchObject({ ok: false, reason: "command_failed", kind: "run" });
	await assertNoCreation(services);
});

test("input discovery rejects a name and --source together before I/O #test-13", async () => {
	const unexpectedIo = mock(() =>
		Promise.reject(new Error("Conflicting selection must not do I/O")),
	);
	const services = {
		...manifestServices(),
		execute: unexpectedIo,
		importModule: unexpectedIo,
		isFile: unexpectedIo,
		readBytes: unexpectedIo,
		readDirectory: unexpectedIo,
		readText: unexpectedIo,
	};
	services.beads = { ...services.beads, where: unexpectedIo };
	const result = await invoke(
		["input-schema", "example", "--source", "/catalogue-validation/.workflows/example/entry.ts"],
		services,
	);
	expect(result.code).not.toBe(SUCCESS);
	expect(result.document).toMatchObject({ ok: false, reason: "invalid_selection" });
	expect(unexpectedIo).not.toHaveBeenCalled();
	await assertNoCreation(services);
});

// --- Private helpers ---

async function prepareCatalogue(fixture: RepositoryFixture) {
	const { repo } = fixture.options;
	const folder = join(repo, ".workflows/example");
	const marker = join(fixture.root, "entry-imported");
	await mkdir(join(repo, ".workflows/node_modules/a-package"), { recursive: true });
	await Bun.write(join(folder, "busybee.toml"), manifest);
	await Bun.write(join(folder, "brief.ts"), 'export const title="First task";');
	await Bun.write(
		join(folder, "entry.ts"),
		`import {createMachine} from ${JSON.stringify(import.meta.resolve("xstate"))}` +
			`;import {z} from ${JSON.stringify(import.meta.resolve("zod"))}` +
			`;import {title} from "./brief.ts";\nawait Bun.write(${JSON.stringify(marker)}` +
			",title);\nexport const " +
			"inputSchema=z.object({meals:z.number().int().positive().default(1)})" +
			";export const commandSchemas={next:z.object({})};export function " +
			'runBrief(){return {title:"Catalogue example",description:"Complete ' +
			'the task"};}\nexport const ' +
			'machine=createMachine({initial:"first",states:{first:{meta:{title,ta' +
			'sk:()=>({instructions:"Finish ' +
			'first"}),commands:{next:"NEXT"}},on:{NEXT:"done"}},done:{type:"final' +
			'"}}});',
	);
	return { folder, marker, repo };
}

function manifestServices(source?: string) {
	return {
		...createServices(),
		beads: createMemoryBeads(),
		beforeWrite: mock(() => {
			throw new Error("Invalid catalogue selection must not publish");
		}),
		cwd: "/catalogue-validation",
		execute: () => Promise.resolve("/catalogue-validation"),
		importModule: mock(() =>
			Promise.reject(new Error("Invalid catalogue selection must not import")),
		),
		readDirectory: mock(() => {
			if (source === undefined) {
				return Promise.reject(Object.assign(new Error("Missing folder"), { code: "ENOENT" }));
			}
			return Promise.resolve([{ kind: "file" as const, name: "entry.ts" }]);
		}),
		readText: mock(() => {
			if (source === undefined) {
				return Promise.reject(new Error("Missing manifest"));
			}
			return Promise.resolve(source);
		}),
		isFile: () => Promise.resolve(false),
	};
}

async function assertNoCreation(services: ReturnType<typeof manifestServices>): Promise<void> {
	expect(services.importModule).not.toHaveBeenCalled();
	expect(services.beforeWrite).not.toHaveBeenCalled();
	const records = await services.beads.list({ cwd: services.cwd }, { all: true, limit: 0 });
	expect(records.issues).toEqual([]);
}
