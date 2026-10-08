import {
	assertUnchanged,
	checkpoint,
	close,
	invoke,
	observations,
	optionsArgs,
	record,
	useNativeFixture,
	view,
	writeDefinition,
} from "./support.ts";
import { expect, test } from "bun:test";
import type { RunView } from "../../src/runtime.ts";

const fixture = useNativeFixture("busybee-navigation-");
const FIRST = 0;

test.each([
	{ mode: "sequence", transition: '"second"' },
	{ mode: "self-loop", transition: '{target:"work",reenter:true}' },
])(
	"a closed root rejects $mode publication without changing the checkpoint or task inventory",
	async ({ transition }) => {
		const run = await createRun("next", transition);
		await close(fixture, run.active[FIRST]!.bead);
		await close(fixture, run.id);
		const before = await observations(fixture, run.id);
		const result = await invoke(
			[...optionsArgs(fixture), "next", run.id, run.active[FIRST]!.bead],
			fixture.services,
		);
		expect(result.document).toMatchObject({ ok: false, reason: "closed_parent" });
		await assertUnchanged(fixture, before);
		expect(before.notes).toBe("");
	},
);

test.each(["show", "collect", "initialize"])(
	"authors can submit an outcome named %s",
	async (choice) => {
		const run = await createRun(choice, '"second"');
		const task = run.active[FIRST]!;
		await close(fixture, task.bead);
		const advanced = await view(fixture, ["choice", run.id, task.bead, choice]);
		expect(advanced.active[FIRST]!.title).toBe("Second");
		expect(advanced.active[FIRST]!.bead).not.toBe(task.bead);
	},
);

test("final states close their container without publishing tasks or changing an unfinished sibling", async () => {
	const source = await writeDefinition(
		fixture,
		"final",
		`export const commandSchemas={next:z.object({})};
export const machine=createMachine({type:"parallel",states:{
first:{meta:{title:"First group",task:()=>({instructions:"Group"})},initial:"work",states:{work:{meta:{title:"First",task:()=>({instructions:"Work"}),commands:{next:"FIRST"}},on:{FIRST:"done"}},done:{type:"final",meta:{title:"First done",task:()=>({instructions:"Complete"})}}}},
second:{initial:"work",states:{work:{meta:{title:"Second",task:()=>({instructions:"Sibling brief"}),commands:{next:"SECOND"}},on:{SECOND:"done"}},done:{type:"final",meta:{title:"Second done",task:()=>({instructions:"Complete"})}}}}
}});`,
	);
	const run = await view(fixture, ["start", source]);
	const worker = run.active.find((entry) => entry.title === "First")!;
	await close(fixture, worker.bead);
	const advanced = await view(fixture, ["next", run.id, worker.bead]);
	await assertCompletedGroup(run, advanced);
});

test("discovery and submission report a missing command schema before publishing effects", async () => {
	const source = await writeDefinition(
		fixture,
		"missing-schema",
		`export const commandSchemas={};
export const machine=createMachine({initial:"work",states:{work:{meta:{title:"Missing schema",task:()=>({instructions:"Work"}),commands:{next:"NEXT"}},on:{NEXT:"done"}},done:{type:"final"}}});`,
	);
	const run = await view(fixture, ["start", source]);
	const task = run.active[FIRST]!;
	const before = await observations(fixture, run.id);
	const expected = { bead: task.bead, choice: "next", ok: false, reason: "missing_command_schema" };
	await expect(
		invoke([...optionsArgs(fixture), "discover", run.id], fixture.services),
	).resolves.toMatchObject({ document: expected });
	await assertUnchanged(fixture, before);
	await close(fixture, task.bead);
	await expect(
		invoke([...optionsArgs(fixture), "next", run.id, task.bead], fixture.services),
	).resolves.toMatchObject({ document: expected });
	await assertUnchanged(fixture, before);
});

test("a closed worker cannot become a parent of fresh nested work", async () => {
	const source = await writeDefinition(
		fixture,
		"nested",
		`export const commandSchemas={next:z.object({})};
export const machine=createMachine({initial:"parent",states:{parent:{meta:{title:"Parent work",task:()=>({instructions:"Complete parent work"}),commands:{next:"NEXT"}},initial:"ready",states:{ready:{on:{NEXT:"child"}},child:{meta:{title:"Nested work",task:()=>({instructions:"New child work"})}}}}}});`,
	);
	const run = await view(fixture, ["start", source]);
	const task = run.active[FIRST]!;
	await close(fixture, task.bead);
	const before = await observations(fixture, run.id);
	const closed = await record(fixture, task.bead);
	const result = await invoke(
		[...optionsArgs(fixture), "next", run.id, task.bead],
		fixture.services,
	);
	expect(result.document).toMatchObject({ ok: false, reason: "closed_parent" });
	await assertUnchanged(fixture, before);
	expect(await record(fixture, task.bead)).toEqual(closed);
});

// --- Private helpers ---

async function createRun(choice: string, transition: string) {
	const source = await writeDefinition(
		fixture,
		"navigation",
		`export const commandSchemas={${JSON.stringify(choice)}:z.object({})};
export const machine=createMachine({initial:"work",states:{work:{meta:{title:"First",task:()=>({instructions:"Complete first"}),commands:{${JSON.stringify(choice)}:"ADVANCE"}},on:{ADVANCE:${transition}}},second:{meta:{title:"Second",task:()=>({instructions:"Complete second"}),commands:{${JSON.stringify(choice)}:"FINISH"}},on:{FINISH:"done"}},done:{type:"final"}}});`,
	);
	return view(fixture, ["start", source]);
}

async function assertCompletedGroup(run: RunView, advanced: RunView) {
	const group = run.active.find((entry) => entry.title === "First group")!;
	const sibling = run.active.find((entry) => entry.title === "Second")!;
	await expect(record(fixture, group.bead)).resolves.toMatchObject({ status: "closed" });
	expect(advanced.active).toEqual([sibling]);
	expect(advanced.created).toEqual(run.created);
	await expect(checkpoint(fixture, run.id)).resolves.toMatchObject({ notes: "" });
}
