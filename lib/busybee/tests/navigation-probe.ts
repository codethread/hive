/* eslint-disable import/no-nodejs-modules -- Native CLI regressions use disposable repositories and trackers. */
import { createServices, readBead, tracker } from "../src/native.ts";
import { mkdir, mkdtemp } from "node:fs/promises";
import type { RunView } from "../src/runtime.ts";
import { expect } from "bun:test";
import { join } from "node:path";
import { runViewSchema } from "../src/runtime.ts";
import { tmpdir } from "node:os";
import { z } from "zod";

const root = await mkdtemp(join(tmpdir(), "busybee-navigation-"));
const repo = join(root, "repo");
await mkdir(repo);
const services = createServices();
const options = {
	actor: "navigation-agent",
	db: join(repo, ".beads/beads.db"),
	owner: "navigation-human",
	repo,
};
const runner = new URL("../bin/busybee.ts", import.meta.url).pathname;
const first = 0;
const success = 0;
const issue = z.object({ id: z.string() });
const issueList = z.object({ issues: z.array(issue) });
const failure = z.object({ ok: z.literal(false), reason: z.string() });
await services.execute(["git", "init", "--quiet", repo], root);
await services.execute(
	["br", "init", "--db", options.db, "--prefix", "nav", "--actor", options.actor],
	repo,
);

for (const mode of ["sequential", "self-loop"]) {
	// eslint-disable-next-line no-await-in-loop -- Each case checks native closure then its dependent submission.
	await closedRoot(mode);
}
for (const choice of ["show", "collect", "initialize"]) {
	// eslint-disable-next-line no-await-in-loop -- Each workflow outcome must complete its own native task first.
	await namedChoice(choice);
}
await finalState();
await missingSchema();
console.log(
	`PASS: closed roots reject sequence/self-loop publication without effects; author choices, final-state projection and missing-schema diagnostics. ${root}`,
);

async function finalState(): Promise<void> {
	const run = await runDefinition(
		"final",
		`export const commandSchemas={next:z.object({})};export const machine=createMachine({type:"parallel",states:{first:{meta:{title:"First group",instructions:"Group"},initial:"work",states:{work:{meta:{title:"First",instructions:"Work",commands:{next:"FIRST"}},on:{FIRST:"done"}},done:{type:"final",meta:{title:"First done",instructions:"Complete"}}}},second:{initial:"work",states:{work:{meta:{title:"Second",instructions:"Sibling brief",commands:{next:"SECOND"}},on:{SECOND:"done"}},done:{type:"final",meta:{title:"Second done",instructions:"Complete"}}}}}});`,
	);
	const worker = run.active.find((entry) => entry.title === "First")!;
	await close(worker.bead);
	const result = await invoke(["next", run.id, worker.bead]);
	const advanced = runViewSchema.parse(result.document);
	await assertFinalProjection(run, advanced);
	await close(advanced.active[first]!.bead);
	const completed = await invoke(["next", run.id, advanced.active[first]!.bead]);
	expect(runViewSchema.parse(completed.document).status).toBe("done");
}
async function assertFinalProjection(before: RunView, after: RunView): Promise<void> {
	const group = before.active.find((entry) => entry.title === "First group")!;
	const sibling = before.active.find((entry) => entry.title === "Second")!;
	const record = await readBead(options, group.bead, services);
	expect(record.status).toBe("closed");
	expect(after.active).toEqual([sibling]);
	expect(after.created).toEqual(before.created);
	const state = await observations(before.id);
	expect(state.notes).toBe("");
}
async function missingSchema(): Promise<void> {
	const run = await runDefinition(
		"missing-schema",
		`export const commandSchemas={};export const machine=createMachine({initial:"work",states:{work:{meta:{title:"Missing schema",instructions:"Work",commands:{next:"NEXT"}},on:{NEXT:"done"}},done:{type:"final"}}});`,
	);
	const before = await observations(run.id);
	const discovery = await invoke(["discover", run.id]);
	expect(discovery.document).toMatchObject({
		bead: run.active[first]!.bead,
		choice: "next",
		ok: false,
		reason: "missing_command_schema",
	});
	expect(await observations(run.id)).toEqual(before);
	await close(run.active[first]!.bead);
	const submitted = await invoke(["next", run.id, run.active[first]!.bead]);
	expect(submitted.document).toMatchObject({
		bead: run.active[first]!.bead,
		choice: "next",
		ok: false,
		reason: "missing_command_schema",
	});
	expect(await observations(run.id)).toEqual(before);
}
async function runDefinition(name: string, body: string): Promise<RunView> {
	const source = join(root, name, "workflow.ts");
	await Bun.write(
		source,
		`import {createMachine} from ${JSON.stringify(import.meta.resolve("xstate"))};import {z} from ${JSON.stringify(import.meta.resolve("zod"))};export const inputSchema=z.object({});export function runBrief(){return {title:"Projection",description:"Native projection regression"};}${body}`,
	);
	const result = await invoke(["start", source]);
	return runViewSchema.parse(result.document);
}

async function createRun(choice: string, selfLoop = false): Promise<RunView> {
	const source = join(root, `${crypto.randomUUID()}.ts`);
	let transition = '"done"';
	if (selfLoop) {
		transition = '{target:"work",reenter:true}';
	}
	await Bun.write(
		source,
		`import {createMachine} from ${JSON.stringify(import.meta.resolve("xstate"))}; import {z} from ${JSON.stringify(import.meta.resolve("zod"))};
 export const inputSchema=z.object({});export const commandSchemas={${JSON.stringify(choice)}:z.object({})};export function runBrief(){return {title:"Navigation",description:"Native navigation regression"};}
 export const machine=createMachine({initial:"work",states:{work:{meta:{title:"First",instructions:"Complete first",commands:{${JSON.stringify(choice)}:"ADVANCE"}},on:{ADVANCE:${transition}}},done:{meta:{title:"Second",instructions:"Complete second",commands:{${JSON.stringify(choice)}:"FINISH"}},on:{FINISH:"complete"}},complete:{type:"final"}}});`,
	);
	const result = await invoke(["start", source]);
	expect(result.code).toBe(success);
	return runViewSchema.parse(result.document);
}

async function closedRoot(mode: string): Promise<void> {
	const run = await createRun("next", mode === "self-loop");
	await close(run.active[first]!.bead);
	await close(run.id);
	const before = await observations(run.id);
	const result = await invoke(["next", run.id, run.active[first]!.bead]);
	expect(failure.parse(result.document).reason).toBe("closed_parent");
	const after = await observations(run.id);
	expect(after).toEqual(before);
	expect(after.notes).toBe("");
}

async function namedChoice(choice: string): Promise<void> {
	const run = await createRun(choice);
	await close(run.active[first]!.bead);
	const result = await invoke(["choice", run.id, run.active[first]!.bead, choice]);
	expect(result.code).toBe(success);
	const advanced = runViewSchema.parse(result.document);
	expect(advanced.active[first]!.title).toBe("Second");
	expect(advanced.active[first]!.bead).not.toBe(run.active[first]!.bead);
}

async function observations(id: string) {
	const run = await readBead(options, id, services);
	const checkpoint = await readBead(
		options,
		run.dependencies.find((edge) => edge.dependency_type === "related")!.id,
		services,
	);
	const list = issueList.parse(await tracker(options, ["list", "--all", "--limit", "0"], services));
	return {
		description: checkpoint.description,
		issues: list.issues.map((entry) => entry.id).toSorted(),
		notes: checkpoint.notes,
	};
}

async function close(id: string): Promise<void> {
	await tracker(
		options,
		["close", id, "--reason", "Completed: regression fixture.", "--actor", options.actor],
		services,
	);
}

async function invoke(command: string[]) {
	const proc = Bun.spawn(
		[
			process.execPath,
			runner,
			"--db",
			options.db,
			"--repo",
			repo,
			"--actor",
			options.actor,
			"--owner",
			options.owner,
			...command,
			"--json",
		],
		{ stderr: "pipe", stdout: "pipe" },
	);
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	expect(stderr).toBe("");
	const document: unknown = JSON.parse(stdout);
	return { code, document };
}
