/* eslint-disable import/no-nodejs-modules -- Native integration proof uses one disposable repository and tracker. */
import { BusyBeeError, createServices, readBead, tracker } from "../src/native.ts";
import { mkdir, mkdtemp } from "node:fs/promises";
import { navigate, start } from "../src/runtime.ts";
import { expect } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = await mkdtemp(join(tmpdir(), "busybee-visits-"));
const repo = join(root, "repo");
await mkdir(repo);
const services = createServices();
const options = {
	actor: "visit-agent",
	db: join(repo, ".beads/beads.db"),
	owner: "visit-human",
	repo,
};
await services.execute(["git", "init", "--quiet", repo], root);
await services.execute(
	["br", "init", "--db", options.db, "--prefix", "visits", "--actor", options.actor],
	repo,
);
const firstVisit = 1;
const secondVisit = 2;

for (const mode of ["direct", "transient"]) {
	// eslint-disable-next-line no-await-in-loop -- Each scenario runs its own ordered native task lifecycle.
	await verifyVisit(mode);
}
console.log(
	`PASS: direct and transient worker revisits, stable sibling, rejected stale submission. ${root}`,
);

async function verifyVisit(mode: string): Promise<void> {
	const source = join(root, mode, "workflow.ts");
	await Bun.write(source, workflow(mode));
	const run = await start(source, options, services);
	const worker = run.active.find((entry) => entry.title === "Worker")!;
	const sibling = run.active.find((entry) => entry.title === "Sibling")!;
	await tracker(
		options,
		["close", worker.bead, "--reason", "Completed: visit one.", "--actor", options.actor],
		services,
	);
	const advanced = await navigate(
		{ bead: worker.bead, choice: "next", id: run.id, operation: "submit" },
		options,
		services,
	);
	await assertVisit({ advanced, run, sibling, worker });
	await expect(
		navigate(
			{ bead: worker.bead, choice: "next", id: run.id, operation: "submit" },
			options,
			services,
		),
	).rejects.toBeInstanceOf(BusyBeeError);
}

async function assertVisit(input: {
	advanced: Awaited<ReturnType<typeof start>>;
	run: Awaited<ReturnType<typeof start>>;
	sibling: { bead: string };
	worker: { bead: string };
}): Promise<void> {
	const current = input.advanced.active.find((entry) => entry.title === "Worker")!;
	expect(current.bead).not.toBe(input.worker.bead);
	expect(current.instructions).toBe("round 2");
	const task = await readBead(options, current.bead, services);
	expect(task.status).toBe("in_progress");
	expect(input.advanced.active.find((entry) => entry.title === "Sibling")!.bead).toBe(
		input.sibling.bead,
	);
	expect(
		input.advanced.created
			.filter(
				(entry) =>
					entry.node === input.run.created.find((visit) => visit.bead === input.worker.bead)!.node,
			)
			.map((entry) => entry.visit),
	).toEqual([firstVisit, secondVisit]);
}

function workflow(mode: string): string {
	let target = "work";
	if (mode === "transient") {
		target = "transient";
	}
	return `import {setup,assign} from ${JSON.stringify(import.meta.resolve("xstate"))};
 import {z} from ${JSON.stringify(import.meta.resolve("zod"))};
 export const inputSchema=z.object({}); export const commandSchemas={next:z.object({})};
 export function runBrief(){return {title:"Visits",description:"Complete two parallel jobs."};}
 export const machine=setup({actions:{increment:assign({rounds:({context})=>context.rounds+1})}}).createMachine({
 context:{rounds:0},type:"parallel",states:{
 lane:{initial:"work",states:{work:{entry:"increment",meta:{title:"Worker",commands:{next:"NEXT"},task:({context})=>({instructions:"round "+context.rounds})},on:{NEXT:{target:${JSON.stringify(target)},reenter:true}}},transient:{always:"work"}}},
 sibling:{meta:{title:"Sibling",instructions:"Stay unchanged",commands:{next:"FINISH"}},on:{FINISH:"done"}},done:{type:"final"}
 }});`;
}
