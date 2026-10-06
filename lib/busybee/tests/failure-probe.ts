/* eslint-disable import/no-nodejs-modules -- Process regression creates disposable native storage and author modules. */
import { createServices, readBead, tracker } from "../src/native.ts";
import { mkdir, mkdtemp } from "node:fs/promises";
import { navigate, runViewSchema } from "../src/runtime.ts";
import { expect } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";

const root = await mkdtemp(join(tmpdir(), "busybee-failures-"));
const repo = join(root, "repo");
await mkdir(repo);
const services = createServices();
const endpoint = { actor: "failure-agent", db: join(repo, ".beads/beads.db"), repo };
const runner = new URL("../bin/busybee.ts", import.meta.url).pathname;
const first = 0;
const failureSchema = z.object({ kind: z.string(), ok: z.literal(false), reason: z.string() });
const issueSchema = z.object({ id: z.string() });
const listSchema = z.object({ issues: z.array(issueSchema) });
await services.execute(["git", "init", "--quiet", repo], root);
await services.execute(
	["br", "init", "--db", endpoint.db, "--prefix", "failure", "--actor", endpoint.actor],
	repo,
);

for (const mode of ["action", "render"]) {
	// eslint-disable-next-line no-await-in-loop -- Each scenario completes and submits its own native worker.
	await failedSubmission(mode);
}
await failedPublicationRead();
const initial = await definition("initial");
const beforeInitial = await issueIds();
const initialResult = await invoke(["start", initial]);
expect(failureSchema.parse(initialResult).ok).toBe(false);
expect(await issueIds()).toEqual(beforeInitial);
console.log(
	`PASS: initial/action errors stay on JSON channel; prewrite action/render/read failure releases ownership without publication. ${root}`,
);

async function failedSubmission(mode: string): Promise<void> {
	const source = await definition(mode);
	const run = runViewSchema.parse(await invoke(["start", source]));
	await tracker(
		endpoint,
		[
			"close",
			run.active[first]!.bead,
			"--actor",
			endpoint.actor,
			"--reason",
			"Completed: error boundary fixture.",
		],
		services,
	);
	const before = await checkpoint(run.id);
	const issues = await issueIds();
	const result = await invoke(["next", run.id, run.active[first]!.bead]);
	expect(failureSchema.parse(result).reason).not.toBe("partial_effects");
	await unchanged(run.id, before.description, issues);
}

async function failedPublicationRead(): Promise<void> {
	const source = await definition("read");
	const run = runViewSchema.parse(await invoke(["start", source]));
	await tracker(
		endpoint,
		[
			"close",
			run.active[first]!.bead,
			"--actor",
			endpoint.actor,
			"--reason",
			"Completed: read boundary fixture.",
		],
		services,
	);
	const before = await checkpoint(run.id);
	const issues = await issueIds();
	const fault = publicationReadFault(run.id);
	await expect(
		navigate(
			{ bead: run.active[first]!.bead, choice: "next", id: run.id, operation: "submit" },
			endpoint,
			fault.services,
		),
	).rejects.toBe(fault.error);
	await unchanged(run.id, before.description, issues);
}
function publicationReadFault(id: string) {
	let restored = false;
	const error = new Error("Publication identity read failed");
	const commandLength = 3;
	return {
		error,
		services: {
			...services,
			execute: (argv: string[], cwd: string) => {
				// This transition is final: after module restoration there are no new-parent preflight reads.
				if (restored && argv.slice(first, commandLength).join(" ") === `br show ${id}`) {
					return Promise.reject(error);
				}
				return services.execute(argv, cwd);
			},
			importModule: async (source: string) => {
				const result = await services.importModule(source);
				restored = true;
				return result;
			},
		},
	};
}

async function unchanged(id: string, description: string, issues: string[]): Promise<void> {
	const after = await checkpoint(id);
	expect(after.description).toBe(description);
	expect(after.notes).toBe("");
	expect(await issueIds()).toEqual(issues);
}
async function checkpoint(id: string) {
	const run = await readBead(endpoint, id, services);
	return readBead(
		endpoint,
		run.dependencies.find((edge) => edge.dependency_type === "related")!.id,
		services,
	);
}
async function issueIds(): Promise<string[]> {
	const list = listSchema.parse(
		await tracker(endpoint, ["list", "--all", "--limit", "0"], services),
	);
	return list.issues.map((issue) => issue.id).toSorted();
}
async function definition(mode: string): Promise<string> {
	const path = join(root, mode, "workflow.ts");
	const { context, transition, second } = configuration(mode);
	await Bun.write(
		path,
		`import {createMachine,assign} from ${JSON.stringify(import.meta.resolve("xstate"))};import {z} from ${JSON.stringify(import.meta.resolve("zod"))};
 export const inputSchema=z.object({});export const commandSchemas={next:z.object({})};export function runBrief(){return {title:"Failure",description:"Probe failure transport"};}
 export const machine=createMachine({context:${context},initial:"first",states:{first:{meta:{title:"First",instructions:"Complete first",commands:{next:"NEXT"}},on:{NEXT:${transition}}},second:{meta:{title:"Second",${second},commands:{next:"DONE"}},on:{DONE:"done"}},done:{type:"final"}}});`,
	);
	return path;
}
function configuration(mode: string) {
	const cases: Record<string, { context?: string; second?: string; transition?: string }> = {
		action: {
			transition: '{target:"second",actions:assign(()=>{throw new Error("Assignment failure");})}',
		},
		initial: { context: '()=>{throw new Error("Initial context failure");}' },
		read: { transition: '"done"' },
		render: { second: 'task:()=>{throw new Error("Renderer failure");}' },
	};
	return { context: "{}", second: 'instructions:"Second"', transition: '"second"', ...cases[mode] };
}
async function invoke(command: string[]): Promise<unknown> {
	const proc = Bun.spawn(
		[
			process.execPath,
			runner,
			"--db",
			endpoint.db,
			"--repo",
			repo,
			"--actor",
			endpoint.actor,
			"--owner",
			"failure-human",
			...command,
			"--json",
		],
		{ stderr: "pipe", stdout: "pipe" },
	);
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	expect(stderr).toBe("");
	// Parsing the entire stdout proves that it contains one JSON document, not asynchronous diagnostics.
	return JSON.parse(stdout) as unknown;
}
