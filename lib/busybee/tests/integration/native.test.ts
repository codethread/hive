/* eslint-disable import/no-nodejs-modules -- Native scenarios exercise disposable repositories, executable fixtures and child processes. */
// eslint-disable-next-line import/no-unassigned-import -- The guarded child-process entrypoint is a dependency of this executable test.
import "../../bin/busybee.ts";
import { createRepository, invoke, useNativeFixture, writeDefinition } from "./support.ts";
import { expect, test } from "bun:test";
import type { Services } from "../../src/native.ts";
import { execute } from "@hive/shared";
import { join } from "node:path";
import { readBead } from "../../src/native.ts";
import { runViewSchema } from "../../src/runtime.ts";

const fixture = useNativeFixture("busybee-native-");
const FIRST = 0;

interface TrackerSelection {
	/** Native BEADS_DB selects separate storage for this scenario. */
	environment: boolean;
	/** The explicit database argument must override environment selection. */
	explicit: boolean;
	/** Invocation happens outside the repository selecting the database. */
	externalCwd: boolean;
}

test.each([{ environment: false, explicit: false, externalCwd: false, mode: "repository" }])(
	"native tracker selection follows $mode independently of the execution directory",
	async (selection) => {
		const { argv, expectedDb, services } = await trackerSelection(selection);
		const source = await sequentialSource("selection");
		const result = await invoke([...argv, "start", source], services);
		expect(result.document).toMatchObject({ ok: true });
		const started = runViewSchema.parse(result.document);
		await expect(
			readBead({ db: expectedDb, repo: fixture.options.repo }, started.id, services),
		).resolves.toMatchObject({ owner: fixture.options.owner });
	},
);

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

async function trackerSelection(selection: TrackerSelection) {
	const selectedDb = await alternativeDatabase();
	const services = selectedServices(selection, selectedDb);
	const argv = ["--actor", fixture.options.actor, "--owner", fixture.options.owner];
	if (selection.explicit) {
		argv.push("--db", fixture.options.db);
	}
	if (selection.externalCwd) {
		argv.push("--repo", fixture.options.repo);
	}
	return { argv, expectedDb: selectedDatabase(selection, selectedDb), services };
}

function selectedServices(selection: TrackerSelection, selectedDb: string): Services {
	const env = { ...fixture.env };
	if (selection.environment) {
		env.BEADS_DB = selectedDb;
	}
	let cwd = fixture.options.repo;
	if (selection.externalCwd) {
		cwd = join(fixture.root, "empty");
	}
	return { ...fixture.services, cwd, execute: (argv, directory) => execute(argv, directory, env) };
}

function selectedDatabase(selection: TrackerSelection, selected: string): string {
	if (selection.environment && !selection.explicit) {
		return selected;
	}
	return fixture.options.db;
}

async function alternativeDatabase(): Promise<string> {
	const selected = join(fixture.root, "selected");
	const empty = join(fixture.root, "empty");
	await Promise.all([createRepository(fixture, selected), createRepository(fixture, empty)]);
	const selectedDb = join(selected, ".beads/beads.db");
	await fixture.services.execute(
		["br", "init", "--db", selectedDb, "--prefix", "selected", "--actor", fixture.options.actor],
		selected,
	);
	return selectedDb;
}
