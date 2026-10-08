import {
	assertUnchanged,
	checkpoint,
	close,
	invoke,
	issueIds,
	observations,
	optionsArgs,
	useNativeFixture,
	view,
	writeDefinition,
} from "./support.ts";
import { expect, test } from "bun:test";
import { navigate } from "../../src/runtime.ts";

const fixture = useNativeFixture("busybee-failures-");
const FIRST = 0;
const COMMAND_INDEX = 1;
const COMMAND_LENGTH = 3;
const DEADLINE = 10_000;

interface FailureDefinition {
	/** Trusted context expression in the authoring fixture. */
	context: string;
	/** Brief renderer expression for the destination worker. */
	second: string;
	/** Transition configuration exercising the selected failure boundary. */
	transition: string;
}

test.each([
	{
		mode: "action",
		second: 'task:()=>({instructions:"Second"})',
		transition: '{target:"second",actions:assign(()=>{throw new Error("Assignment failure");})}',
	},
	{
		mode: "render",
		second: 'task:()=>{throw new Error("Renderer failure");}',
		transition: '"second"',
	},
])(
	"a prewrite $mode failure returns one JSON document and releases ownership without publication",
	async ({ mode, transition, second }) => {
		const source = await definition(mode, { context: "{}", second, transition });
		const run = await view(fixture, ["start", source]);
		const task = run.active[FIRST]!;
		await close(fixture, task.bead);
		const before = await observations(fixture, run.id);
		const result = await invoke(
			[...optionsArgs(fixture), "next", run.id, task.bead],
			fixture.services,
		);
		expect(result.code).not.toBe(FIRST);
		expect(result.document).toMatchObject({ ok: false, reason: "command_failed" });
		await assertUnchanged(fixture, before);
		expect(before.notes).toBe("");
	},
);

test("a native identity-read failure before publication releases ownership without changing state", async () => {
	const source = await definition("read", {
		context: "{}",
		second: 'task:()=>({instructions:"Second"})',
		transition: '"done"',
	});
	const run = await view(fixture, ["start", source]);
	await close(fixture, run.active[FIRST]!.bead);
	const before = await observations(fixture, run.id);
	const fault = publicationReadFault(run.id);
	await expect(
		navigate(
			{ bead: run.active[FIRST]!.bead, choice: "next", id: run.id, operation: "submit" },
			fixture.options,
			fault.services,
		),
	).rejects.toBe(fault.error);
	await assertUnchanged(fixture, before);
});

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

test("uncertain postwrite failure retains ownership and a subsequent caller observes the bounded lock deadline", async () => {
	const { run, abandoned } = await abandonedRun();
	let elapsed = FIRST;
	const clock = {
		...fixture.services,
		now: () => elapsed,
		sleep: () => {
			elapsed = DEADLINE;
			return Promise.resolve();
		},
	};
	const blocked = await invoke([...optionsArgs(fixture), "collect", run.id], clock);
	expect(blocked.document).toMatchObject({
		checkpoint: abandoned.id,
		ok: false,
		reason: "checkpoint_locked",
	});
	expect(elapsed).toBe(DEADLINE);
	await expect(checkpoint(fixture, run.id)).resolves.toMatchObject({ notes: abandoned.notes });
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

function publicationReadFault(id: string) {
	let restored = false;
	const error = new Error("Publication identity read failed");
	return {
		error,
		services: {
			...fixture.services,
			execute: (argv: string[], cwd: string) => {
				if (restored && argv.slice(FIRST, COMMAND_LENGTH).join(" ") === `br show ${id}`) {
					return Promise.reject(error);
				}
				return fixture.services.execute(argv, cwd);
			},
			importModule: async (source: string) => {
				const loaded = await fixture.services.importModule(source);
				restored = true;
				return loaded;
			},
		},
	};
}

async function abandonedRun() {
	const source = await definition("postwrite", {
		context: "{}",
		second: 'task:()=>({instructions:"Second"})',
		transition: '"second"',
	});
	const run = await view(fixture, ["start", source]);
	await close(fixture, run.active[FIRST]!.bead);
	const writeError = new Error("Native write result was lost");
	const services = {
		...fixture.services,
		execute: async (argv: string[], cwd: string) => {
			const stdout = await fixture.services.execute(argv, cwd);
			if (argv[FIRST] === "br" && argv[COMMAND_INDEX] === "create") {
				throw writeError;
			}
			return stdout;
		},
	};
	const failed = await invoke(
		[...optionsArgs(fixture), "next", run.id, run.active[FIRST]!.bead],
		services,
	);
	expect(failed.document).toMatchObject({ ok: false, reason: "partial_effects" });
	const abandoned = await checkpoint(fixture, run.id);
	expect(abandoned.notes).not.toBe("");
	return { abandoned, run };
}
