import { expect, test } from "bun:test";
import { invoke, issueIds, optionsArgs, useNativeFixture, writeDefinition } from "./support.ts";

const fixture = useNativeFixture("busybee-failures-");

interface FailureDefinition {
	/** Trusted context expression in the authoring fixture. */
	context: string;
	/** Brief renderer expression for the destination worker. */
	second: string;
	/** Transition configuration exercising the selected failure boundary. */
	transition: string;
}

test("an initial actor failure returns JSON without creating native tasks", async () => {
	const source = await definition("initial", {
		context: '()=>{throw new Error("Initial context failure");}',
		second: 'task:()=>({instructions:"Second"})',
		transition: '"second"',
	});
	const before = await issueIds(fixture);
	const result = await invoke([...optionsArgs(fixture), "start", source], fixture.services);
	expect(result.document).toMatchObject({ ok: false, reason: "command_failed" });
	expect(await issueIds(fixture)).toEqual(before);
});

// --- Private helpers ---

function definition(name: string, { context, transition, second }: FailureDefinition) {
	return writeDefinition(
		fixture,
		name,
		`export const commandSchemas={next:z.object({})};
export const machine=createMachine({context:${context},initial:"first",states:{first:{meta:{title:"First",task:()=>({instructions:"Complete first"}),commands:{next:"NEXT"}},on:{NEXT:${transition}}},second:{meta:{title:"Second",${second},commands:{next:"DONE"}},on:{DONE:"done"}},done:{type:"final"}}});`,
	);
}
