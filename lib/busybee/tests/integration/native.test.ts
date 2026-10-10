/* eslint-disable import/no-nodejs-modules -- Native scenarios exercise disposable repositories, executable fixtures and child processes. */
// eslint-disable-next-line import/no-unassigned-import -- The guarded child-process entrypoint is a dependency of this executable test.
import "../../bin/busybee.ts";
import { createRepository, invoke, useNativeFixture, writeDefinition } from "./support.ts";
import { createTask, readBead, resolveMutation } from "../../src/native.ts";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { realpath } from "node:fs/promises";

const fixture = useNativeFixture("busybee-native-");
const FIRST = 0;

test("native tracker discovery routes writes to the repository database with owner and actor", async () => {
	const endpoint = await resolveMutation({ actor: fixture.options.actor }, fixture.services);
	expect(endpoint).toEqual({
		actor: fixture.options.actor,
		db: await realpath(fixture.options.db),
		repo: fixture.options.repo,
	});
	const id = await createTask(
		endpoint,
		{
			description: "Check native repository selection",
			labels: [],
			owner: fixture.options.owner,
			status: "open",
			title: "Native selection",
		},
		fixture.services,
	);
	await expect(readBead(fixture.options, id, fixture.services)).resolves.toMatchObject({
		created_by: fixture.options.actor,
		description: "Check native repository selection",
		id,
		owner: fixture.options.owner,
		status: "open",
	});
});

test("schema discovery works without a database while starting from the same checkout fails clearly", async () => {
	const empty = join(fixture.root, "empty");
	await createRepository(fixture, empty);
	const source = await sequentialSource("without-db");
	const services = { ...fixture.services, cwd: empty };
	await expect(invoke(["input-schema", "--source", source], services)).resolves.toMatchObject({
		document: {
			kind: "input-schema",
			ok: true,
		},
	});
	await expect(
		invoke(
			["--actor", fixture.options.actor, "--owner", fixture.options.owner, "start", source],
			services,
		),
	).resolves.toMatchObject({ document: { ok: false, reason: "command_failed" } });
});

test("the public executable emits one JSON error document and keeps stderr silent", async () => {
	const runner = new URL("../../bin/busybee.ts", import.meta.url).pathname;
	const proc = Bun.spawn([process.execPath, runner, "--not-an-option", "--json"], {
		cwd: fixture.options.repo,
		env: fixture.env,
		stderr: "pipe",
		stdout: "pipe",
	});
	try {
		const [stdout, stderr, code] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		expect(code).not.toBe(FIRST);
		expect(stderr).toBe("");
		expect(JSON.parse(stdout)).toMatchObject({ ok: false, reason: "commander.unknownOption" });
	} finally {
		proc.kill();
	}
});

// --- Private helpers ---

function sequentialSource(name: string, transition = '"done"') {
	return writeDefinition(
		fixture,
		name,
		`export const commandSchemas={next:z.object({})};export const machine=createMachine({initial:"work",states:{work:{meta:{title:"Worker",task:()=>({instructions:"Complete work"}),commands:{next:"NEXT"}},on:{NEXT:${transition}}},second:{meta:{title:"Second",task:()=>({instructions:"Complete second"}),commands:{next:"DONE"}},on:{DONE:"done"}},done:{type:"final"}}});`,
	);
}
