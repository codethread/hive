/* eslint-disable import/no-nodejs-modules -- Native integration probe creates disposable repositories and reads their files. */
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServices, readBead, tracker } from "../src/native.ts";
import type { NativeBead } from "../src/native.ts";
import type { RunView } from "../src/runtime.ts";
import { expect } from "bun:test";
import { join } from "node:path";
import { runViewSchema } from "../src/runtime.ts";
import { tmpdir } from "node:os";
import { z } from "zod";

const success = 0;
const services = createServices();
const root = await mkdtemp(join(tmpdir(), "busybee-catalogue-"));
const repo = join(root, "feature");
const surviving = join(root, "surviving");
const trackerRepo = join(root, "tracker");
const nested = join(repo, "src/nested");
const folder = join(repo, ".workflows/example");
const marker = join(root, "entry-imported");
const runner = new URL("../bin/busybee.ts", import.meta.url).pathname;
const trace: unknown[] = [];
const env = { ...process.env };
delete env.BEADS_DB;
delete env.BD_ACTOR;
await Promise.all([
	mkdir(folder, { recursive: true }),
	mkdir(nested, { recursive: true }),
	mkdir(surviving),
	mkdir(trackerRepo),
]);
await Promise.all(
	[repo, surviving, trackerRepo].map(async (directory) => {
		await services.execute(["git", "init", "--quiet", directory], root);
	}),
);
const manifest =
	'description = "A two-step TypeScript workflow"\nversion = "1"\nrun = "./entry.ts"\n';
await Bun.write(join(folder, "busybee.toml"), manifest);
await Bun.write(join(folder, "brief.ts"), 'export const title: string = "First task";\n');
await Bun.write(
	join(folder, "entry.ts"),
	`
import { setup } from ${JSON.stringify(import.meta.resolve("xstate"))};
import { z } from ${JSON.stringify(import.meta.resolve("zod"))};
import { title } from "./brief.ts";
await Bun.write(${JSON.stringify(marker)}, "imported");
export const inputSchema = z.object({ meals: z.number().int().positive().default(1) });
export const commandSchemas = { next: z.object({}) };
export function runBrief() { return { title: "Catalogue example", description: "Complete two tasks." }; }
export const machine = setup({}).createMachine({
 initial: "first", states: {
  first: { meta: { title, instructions: "Finish first.", commands: { next: "NEXT" } }, on: { NEXT: "second" } },
  second: { meta: { title: "Second task", instructions: "Finish second.", commands: { next: "NEXT" } }, on: { NEXT: "done" } },
  done: { type: "final" }
 }
});
`,
);
const listed = await invoke(["list"]);
expect(listed.code).toBe(success);
expect(listed.document).toMatchObject({
	workflows: [
		{
			description: "A two-step TypeScript workflow",
			name: "example",
			run: "./entry.ts",
			version: "1",
		},
	],
});
expect(await Bun.file(marker).exists()).toBe(false);
const nestedList = await invoke(["list"], nested);
expect(nestedList.document).toEqual(listed.document);
const explicitList = await invoke(["--repo", nested, "list"], surviving);
expect(explicitList.document).toEqual(listed.document);
const readable = await processResult(["bun", runner, "list"], repo, env);
expect(readable.stdout).toContain("example (1): A two-step TypeScript workflow");
const schema = await invoke(["input-schema", "example"], nested);
expect(schema.code).toBe(success);
expect(schema.document).toMatchObject({ schema: { type: "object" } });
const readableInput = await processResult(["bun", runner, "input-schema", "example"], repo, env);
expect(readableInput.code).toBe(success);
expect(readableInput.stdout).toContain('"exclusiveMinimum":0');
expect(readableInput.stdout).toContain('"default":1');
expect(readableInput.stdout).toContain("--json for the complete authoritative schema");
expect(await Bun.file(marker).exists()).toBe(true);
const conflictingSource = await invoke([
	"input-schema",
	"example",
	"--source",
	join(folder, "entry.ts"),
]);
expect(conflictingSource.code).not.toBe(success);
const emptyList = await invoke(["list"], surviving);
expect(emptyList.document).toMatchObject({ workflows: [] });
const absent = await invoke(["run", "absent"]);
expect(absent.code).not.toBe(success);
const escapingName = await invoke(["run", "../example"]);
expect(escapingName.code).not.toBe(success);
const invalidManifest = join(repo, ".workflows/invalid/busybee.toml");
await Bun.write(invalidManifest, 'description = "Missing entry"\nrun = "./missing.ts"\n');
const missingEntry = await invoke(["list"]);
expect(missingEntry.code).not.toBe(success);
await Bun.write(invalidManifest, 'description = "Bad syntax"\nrun = ');
const malformed = await invoke(["run", "invalid"]);
expect(malformed.code).not.toBe(success);
await Bun.write(invalidManifest, 'description = "Escapes folder"\nrun = "../example/entry.ts"\n');
const escapingEntry = await invoke(["run", "invalid"]);
expect(escapingEntry.code).not.toBe(success);
await rm(join(repo, ".workflows/invalid"), { recursive: true });
const db = join(trackerRepo, ".beads/beads.db");
await services.execute(
	["br", "init", "--prefix", "catalogue", "--db", db, "--actor", "catalogue-agent"],
	trackerRepo,
);
const endpoint = { db, repo: trackerRepo };
const activeEnv = { ...env, BD_ACTOR: "catalogue-agent", BEADS_DB: db };
const started = await invoke(["run", "example", "--owner", "catalogue-human"], nested, activeEnv);
expect(started.document).toMatchObject({ kind: "run", ok: true });
let run = runViewSchema.parse(started.document);
const first = activeTask(run);
expect(first.title).toBe("First task");
const firstTask = await readBead(endpoint, first.bead, services);
expect(firstTask.description).toContain("busybee --db");
expect(firstTask.description).not.toContain(repo);
expect(firstTask.description).not.toContain(runner);
const selectedList = await invoke(["list"], nested, activeEnv);
expect(selectedList.document).toEqual(listed.document);
const before = await checkpoint(run.id);
await Bun.write(join(folder, "brief.ts"), 'export const title: string = "Changed task";\n');
await rm(marker);
const changed = await invoke(["show", run.id], nested, activeEnv);
expect(changed.code).not.toBe(success);
const changedError = z.object({ message: z.string() }).parse(changed.document);
expect(changedError.message).toContain("definition changed");
expect(await Bun.file(marker).exists()).toBe(false);
const after = await checkpoint(run.id);
expect(after.description).toBe(before.description);
await Bun.write(join(folder, "brief.ts"), 'export const title: string = "First task";\n');
// Relocation uses the same named definition in a surviving checkout, with shared storage.
await cp(join(repo, ".workflows"), join(surviving, ".workflows"), { recursive: true });
await tracker(
	endpoint,
	["close", first.bead, "--reason", "Completed: first step.", "--actor", "catalogue-agent"],
	services,
);
await rm(repo, { recursive: true });
const resumed = await invoke(["next", run.id, first.bead], surviving, activeEnv);
expect(resumed.document).toMatchObject({ ok: true });
run = runViewSchema.parse(resumed.document);
const second = activeTask(run);
expect(second.title).toBe("Second task");
await tracker(
	endpoint,
	["close", second.bead, "--reason", "Completed: second step.", "--actor", "catalogue-agent"],
	services,
);
const completed = await invoke(
	["--repo", surviving, "next", run.id, second.bead],
	trackerRepo,
	activeEnv,
);
run = runViewSchema.parse(completed.document);
expect(run.status).toBe("done");
const completedBead = await readBead(endpoint, run.id, services);
expect(completedBead.status).toBe("closed");
await Bun.write(join(root, "trace.json"), JSON.stringify(trace, undefined, "\t"));
console.log(
	`PASS: ${trace.length} catalogue process results; metadata-only discovery, TS/helper identity and unchanged-definition relocation. ${root}`,
);

async function processResult(
	args: string[],
	cwd: string,
	selectedEnv: NodeJS.ProcessEnv,
): Promise<{ code: number; stderr: string; stdout: string }> {
	const result = Bun.spawn(args, { cwd, env: selectedEnv, stderr: "pipe", stdout: "pipe" });
	const [stdout, stderr, code] = await Promise.all([
		new Response(result.stdout).text(),
		new Response(result.stderr).text(),
		result.exited,
	]);
	return { code, stderr, stdout };
}

async function invoke(
	args: string[],
	cwd = repo,
	selectedEnv = env,
): Promise<{ code: number; document: unknown }> {
	const result = await processResult(["bun", runner, ...args, "--json"], cwd, selectedEnv);
	expect(result.stderr).toBe("");
	const document: unknown = JSON.parse(result.stdout);
	trace.push({ args, code: result.code, cwd, document });
	return { code: result.code, document };
}

function activeTask(view: RunView): RunView["active"][number] {
	const [task] = view.active;
	if (!task) {
		throw new Error("Expected an active catalogue task");
	}
	return task;
}

async function checkpoint(id: string): Promise<NativeBead> {
	const record = await readBead(endpoint, id, services);
	const related = record.dependencies.find((edge) => edge.dependency_type === "related");
	if (!related) {
		throw new Error("Expected a related checkpoint bead");
	}
	return readBead(endpoint, related.id, services);
}
