/* eslint-disable import/no-nodejs-modules -- Catalogue integration uses disposable authoring checkouts and native storage. */
import {
	captureCli,
	checkpoint,
	close,
	createRepository,
	invoke,
	optionsArgs,
	record,
	useNativeFixture,
	view,
} from "./support.ts";
import { cp, mkdir, rm } from "node:fs/promises";
import { expect, test } from "bun:test";
import { join } from "node:path";

const fixture = useNativeFixture("busybee-catalogue-");
const SUCCESS = 0;
const FIRST = 0;
const manifest = 'description = "A two-step workflow"\nversion = "1"\nrun = "./entry.ts"\n';

test("listing finds checkout metadata from nested and explicit repositories without importing code or selecting a tracker", async () => {
	const { marker, repo } = await prepareCatalogue();
	const nested = join(repo, "src/nested");
	await mkdir(nested, { recursive: true });
	const services = {
		...fixture.services,
		cwd: nested,
		execute: (argv: string[], cwd: string) => {
			if (argv[FIRST] === "br") {
				return Promise.reject(new Error("Metadata listing must not select a tracker"));
			}
			return fixture.services.execute(argv, cwd);
		},
	};
	const listed = await invoke(["list"], services);
	expect(listed.document).toMatchObject({
		workflows: [
			{ description: "A two-step workflow", name: "example", run: "./entry.ts", version: "1" },
		],
	});
	await expect(
		invoke(["--repo", nested, "list"], { ...services, cwd: fixture.root }),
	).resolves.toMatchObject({ document: listed.document });
	const readable = await captureCli(["list"], services);
	expect(readable.stdout).toContain("example (1): A two-step workflow");
	expect(await Bun.file(marker).exists()).toBe(false);
});

test("a repository with no catalogue lists no workflows", async () => {
	const empty = join(fixture.root, "empty");
	await createRepository(fixture, empty);
	await expect(invoke(["list"], { ...fixture.services, cwd: empty })).resolves.toMatchObject({
		document: {
			workflows: [],
		},
	});
});

test("named input discovery evaluates the entry and exposes its authoritative and readable constraints", async () => {
	const { marker, repo } = await prepareCatalogue();
	const services = { ...fixture.services, cwd: repo };
	const schema = await invoke(["input-schema", "example"], services);
	expect(schema.document).toMatchObject({
		schema: { properties: { meals: { default: 1, exclusiveMinimum: 0, type: "integer" } } },
	});
	expect(await Bun.file(marker).exists()).toBe(true);
	const readable = await captureCli(["input-schema", "example"], services);
	expect(readable.stdout).toContain("--json for the complete authoritative schema");
	expect(readable.stderr).toBe("");
	const conflicting = await invoke(
		["input-schema", "example", "--source", join(repo, ".workflows/example/entry.ts")],
		services,
	);
	expect(conflicting.document).toMatchObject({ ok: false, reason: "invalid_selection" });
});

test.each([
	{ name: "missing entry", source: 'description="Missing"\nrun="./missing.ts"' },
	{ name: "invalid TOML", source: 'description="Bad syntax"\nrun=' },
	{ name: "escaping entry", source: 'description="Escape"\nrun="../example/entry.ts"' },
])("an invalid manifest with $name fails before workflow creation", async ({ source }) => {
	const { repo } = fixture.options;
	await Bun.write(join(repo, ".workflows/invalid/busybee.toml"), source);
	const result = await invoke(["run", "invalid"], fixture.services);
	expect(result.code).not.toBe(SUCCESS);
	expect(result.document).toMatchObject({ ok: false });
});

test.each(["absent", "../example"])(
	"an unresolved workflow name %s fails before creation",
	async (name) => {
		await prepareCatalogue();
		const result = await invoke(["run", name], fixture.services);
		expect(result.code).not.toBe(SUCCESS);
		expect(result.document).toMatchObject({ ok: false });
	},
);

test("helper changes reject restoration before import or checkpoint mutation", async () => {
	const { folder, marker } = await prepareCatalogue();
	const run = await view(fixture, ["run", "example"]);
	const before = await checkpoint(fixture, run.id);
	await Bun.write(join(folder, "brief.ts"), 'export const title="Changed task";');
	await rm(marker);
	const services = {
		...fixture.services,
		importModule: () => Promise.reject(new Error("Changed definitions must not be imported")),
	};
	const result = await invoke([...optionsArgs(fixture), "show", run.id], services);
	expect(result.document).toMatchObject({ ok: false, reason: "definition_changed" });
	expect(await Bun.file(marker).exists()).toBe(false);
	await expect(checkpoint(fixture, run.id)).resolves.toMatchObject({
		description: before.description,
	});
});

test("a named run continues from an unchanged surviving checkout with separate tracker storage", async () => {
	const { feature, surviving } = await portableCheckouts();
	const run = await view(fixture, ["--repo", feature, "run", "example"]);
	const first = run.active[FIRST]!;
	await assertPortableBrief(first.bead, feature);
	await close(fixture, first.bead);
	await rm(feature, { recursive: true });
	const resumed = await view(fixture, ["--repo", surviving, "next", run.id, first.bead]);
	expect(resumed.active[FIRST]!.title).toBe("Second task");
});

// --- Private helpers ---

async function portableCheckouts() {
	const feature = join(fixture.root, "feature");
	const surviving = join(fixture.root, "surviving");
	await Promise.all([createRepository(fixture, feature), createRepository(fixture, surviving)]);
	const { folder } = await prepareCatalogue(feature);
	await cp(folder, join(surviving, ".workflows/example"), { recursive: true });
	return { feature, surviving };
}

async function assertPortableBrief(id: string, feature: string): Promise<void> {
	const task = await record(fixture, id);
	expect(task.description).toContain("busybee --db");
	expect(task.description).not.toContain(feature);
}

async function prepareCatalogue(repo = fixture.options.repo) {
	const folder = join(repo, ".workflows/example");
	const marker = join(fixture.root, "entry-imported");
	await Bun.write(join(folder, "busybee.toml"), manifest);
	await Bun.write(join(folder, "brief.ts"), 'export const title="First task";');
	await Bun.write(
		join(folder, "entry.ts"),
		`import {createMachine} from ${JSON.stringify(import.meta.resolve("xstate"))};import {z} from ${JSON.stringify(import.meta.resolve("zod"))};import {title} from "./brief.ts";
await Bun.write(${JSON.stringify(marker)},"imported");
export const inputSchema=z.object({meals:z.number().int().positive().default(1)});export const commandSchemas={next:z.object({})};export function runBrief(){return {title:"Catalogue example",description:"Complete two tasks"};}
export const machine=createMachine({initial:"first",states:{first:{meta:{title,task:()=>({instructions:"Finish first"}),commands:{next:"NEXT"}},on:{NEXT:"second"}},second:{meta:{title:"Second task",task:()=>({instructions:"Finish second"}),commands:{next:"NEXT"}},on:{NEXT:"done"}},done:{type:"final"}}});`,
	);
	return { folder, marker, repo };
}
