import {
	assertUnchanged,
	close,
	observations,
	useNativeFixture,
	view,
	writeDefinition,
} from "./support.ts";
import { expect, test } from "bun:test";
import type { RunView } from "../../src/runtime.ts";

const fixture = useNativeFixture("busybee-output-");
const FIRST = 0;

test.each([
	{ name: "aggregate", output: '{"summary":"Complete","findings":["one"]}' },
	{ name: "false", output: "false" },
	{ name: "null", output: "null" },
	{ name: "absent", output: undefined },
])("completed $name output survives restoration", async ({ name, output }) => {
	const source = await createDefinition(name, output);
	const run = await view(fixture, ["start", source]);
	expect(run).not.toHaveProperty("output");
	expect(await view(fixture, ["show", run.id])).not.toHaveProperty("output");
	const task = run.active[FIRST]!;
	await close(fixture, task.bead);
	const completed = await view(fixture, ["next", run.id, task.bead]);
	assertOutput(completed, output);
	await assertRestored(run.id, completed);
});

async function assertRestored(id: string, completed: RunView) {
	const before = await observations(fixture, id);
	expect(await view(fixture, ["show", id])).toEqual(completed);
	await assertUnchanged(fixture, before);
	expect(await view(fixture, ["collect", id])).toEqual(completed);
}

async function createDefinition(name: string, output: string | undefined) {
	let outputDeclaration = "";
	if (output !== undefined) {
		outputDeclaration = `output:()=>(${output}),`;
	}
	const source = await writeDefinition(
		fixture,
		name,
		`export const commandSchemas={next:z.object({})};
export const machine=createMachine({
${outputDeclaration}
initial:"work",states:{
work:{meta:{title:"Work",task:()=>({instructions:"Complete work"}),commands:{next:"NEXT"}},on:{NEXT:"done"}},
done:{type:"final"}
}});`,
	);
	return source;
}

function assertOutput(completed: RunView, output: string | undefined) {
	expect(completed.status).toBe("done");
	expect(completed.active).toEqual([]);
	const keys = ["active", "created", "id", "status"];
	if (output === undefined) {
		expect(completed).not.toHaveProperty("output");
	} else {
		expect(completed.output).toEqual(JSON.parse(output) as unknown);
		keys.push("output");
	}
	expect(Object.keys(completed).toSorted()).toEqual(keys.toSorted());
}
