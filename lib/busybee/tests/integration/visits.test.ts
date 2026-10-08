import { close, record, useNativeFixture, writeDefinition } from "./support.ts";
import { expect, test } from "bun:test";
import { navigate, start } from "../../src/runtime.ts";
import type { RunView } from "../../src/runtime.ts";

const fixture = useNativeFixture("busybee-visits-");
const FIRST_VISIT = 1;
const SECOND_VISIT = 2;

test.each([
	{ mode: "direct", target: "work" },
	{ mode: "transient", target: "transient" },
])(
	"a $mode revisit creates fresh work while preserving its parallel sibling",
	async ({ mode, target }) => {
		const story = await firstVisit(mode, target);
		await close(fixture, story.worker.bead);
		const request = {
			bead: story.worker.bead,
			choice: "next",
			id: story.run.id,
			operation: "submit",
		} as const;
		const advanced = await navigate(request, fixture.options, fixture.services);
		await assertFreshVisit(advanced, story);
	},
);

// --- Private helpers ---

async function firstVisit(mode: string, target: string) {
	const source = await writeDefinition(
		fixture,
		mode,
		`export const commandSchemas={next:z.object({})};
export const machine=setup({actions:{increment:assign({rounds:({context})=>context.rounds+1})}}).createMachine({
context:{rounds:0},type:"parallel",states:{
lane:{initial:"work",states:{work:{entry:"increment",meta:{title:"Worker",commands:{next:"NEXT"},task:({context})=>({instructions:"round "+context.rounds})},on:{NEXT:{target:${JSON.stringify(target)},reenter:true}}},transient:{always:"work"}}},
sibling:{meta:{title:"Sibling",task:()=>({instructions:"Stay unchanged"}),commands:{next:"FINISH"}},on:{FINISH:"done"}},done:{type:"final"}
}});`,
	);
	const run = await start(source, fixture.options, fixture.services);
	return {
		run,
		sibling: run.active.find((entry) => entry.title === "Sibling")!,
		worker: run.active.find((entry) => entry.title === "Worker")!,
	};
}

async function assertFreshVisit(advanced: RunView, story: Awaited<ReturnType<typeof firstVisit>>) {
	const { run, sibling, worker } = story;
	const current = advanced.active.find((entry) => entry.title === "Worker")!;
	expect(current.bead).not.toBe(worker.bead);
	expect(current.instructions).toBe("round 2");
	await expect(record(fixture, current.bead)).resolves.toMatchObject({ status: "in_progress" });
	expect(advanced.active.find((entry) => entry.title === "Sibling")).toMatchObject({
		bead: sibling.bead,
		instructions: sibling.instructions,
	});
	const { node } = run.created.find((entry) => entry.bead === worker.bead)!;
	expect(
		advanced.created.filter((entry) => entry.node === node).map((entry) => entry.visit),
	).toEqual([FIRST_VISIT, SECOND_VISIT]);
}
