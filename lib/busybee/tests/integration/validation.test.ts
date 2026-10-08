/* eslint-disable import/no-nodejs-modules -- Integration tests create isolated author modules with independent dependency copies. */
import { afterAll, expect, test } from "bun:test";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createServices } from "../../src/native.ts";
import { runCli } from "../../src/cli.ts";
import { tmpdir } from "node:os";

const root = await mkdtemp(join(tmpdir(), "busybee-validation-"));
afterAll(async () => {
	await rm(root, { force: true, recursive: true });
});
const imports = `import {createMachine,assign} from ${JSON.stringify(import.meta.resolve("xstate"))};\nimport {z} from ${JSON.stringify(import.meta.resolve("zod"))};\n`;
const exports = `export const commandSchemas={next:z.object({})};\nexport function runBrief(){return {title:"Example",description:"Example"};}\n`;
const cases = [
	{
		machine: 'createMachine({initial:"work",states:{work:{on:{NEXT:"done"}},done:{type:"final"}}})',
		name: "valid",
		ok: true,
		schema: "z.object({})",
	},
	{
		machine: 'createMachine({initial:"work",states:{work:{on:{NEXT:"missing"}}}})',
		name: "bad-target",
		ok: false,
		schema: "z.object({})",
	},
	{
		machine: 'createMachine({initial:"missing",states:{work:{}}})',
		name: "bad-initial",
		ok: false,
		schema: "z.object({})",
	},
	{
		machine: "createMachine({})",
		name: "required-input",
		ok: false,
		schema: "z.object({request:z.string()})",
	},
	{
		machine: 'createMachine({context:()=>{throw new Error("initial failure");}})',
		name: "initial-error",
		ok: false,
		schema: "z.object({})",
	},
	{
		input: '{"request":"Work"}',
		machine: "createMachine({})",
		name: "supplied-input",
		ok: true,
		schema: "z.object({request:z.string()})",
	},
];

test.each(cases)(
	"validate $name without a tracker or live actor",
	async ({ name, machine, schema, input, ok }) => {
		const path = join(root, name, "workflow.ts");
		await Bun.write(
			path,
			`${imports}${exports}export const inputSchema=${schema};\nexport const machine=${machine};\n`,
		);
		const args = ["validate", path, "--json"];
		await addInput(args, input, name);
		const result = await invoke(args);
		expect(result.document).toMatchObject({ kind: "validate", ok });
		expect(result.stderr).toEqual([]);
		expect(result.calls).toEqual([]);
	},
);

test("pure initial validation evaluates assignment but does not start entry effects", async () => {
	const path = join(root, "pure", "workflow.ts");
	const effect = join(root, "effect");
	await Bun.write(
		path,
		`${imports}${exports}export const inputSchema=z.object({});\nexport const machine=createMachine({context:{count:0},initial:"work",states:{work:{entry:[assign({count:()=>1}),()=>{throw new Error(${JSON.stringify(effect)});} ],always:{guard:({context})=>context.count===1,target:"done"}},done:{type:"final"}}});`,
	);
	const result = await invoke(["validate", path, "--json"]);
	expect(result.document).toMatchObject({
		checks: ["definition_resolution", "input_schema", "initial_snapshot"],
		ok: true,
		status: "done",
	});
	expect(result.calls).toEqual([]);
});

test("global CLI loads repository machines and schemas from independent dependency copies", async () => {
	const directory = join(root, "independent");
	await Promise.all(
		["xstate", "zod"].map((name) =>
			cp(
				dirname(import.meta.resolve(`${name}/package.json`).replace("file://", "")),
				join(directory, "node_modules", name),
				{ recursive: true },
			),
		),
	);
	const path = join(directory, "workflow.ts");
	await Bun.write(
		path,
		`import {createMachine} from "xstate"; import {z} from "zod"; ${exports} export const inputSchema=z.object({});export const machine=createMachine({initial:"work",states:{work:{}}});`,
	);
	const result = await invoke(["validate", path, "--json"]);
	expect(result.document).toMatchObject({ ok: true, status: "active" });
	expect(result.calls).toEqual([]);
	await rm(directory, { recursive: true });
});

async function invoke(args: string[]) {
	const stdout: string[] = [];
	const stderr: string[] = [];
	const calls: string[][] = [];
	const services = {
		...createServices(),
		actor: undefined,
		execute: (argv: string[]) => {
			calls.push(argv);
			return Promise.reject(new Error("Validation must not invoke native commands"));
		},
	};
	await runCli(args, services, {
		stderr: (text) => {
			stderr.push(text);
		},
		stdout: (text) => {
			stdout.push(text);
		},
	});
	const document: unknown = JSON.parse(stdout.join(""));
	return { calls, document, stderr };
}

async function addInput(args: string[], input: string | undefined, name: string): Promise<void> {
	if (input) {
		const path = join(root, `${name}.json`);
		await Bun.write(path, input);
		args.push("--input-file", path);
	}
}
