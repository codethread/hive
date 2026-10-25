// Native scenarios exercise disposable repositories, executable fixtures and child processes.
/* eslint-disable import/no-nodejs-modules */
// The guarded child-process entrypoint is a dependency of this executable test.
// eslint-disable-next-line import/no-unassigned-import
import "../../bin/busybee.ts";
import { CommandError, createNativeBeads } from "@hive/beads";
import { createTask, readBead, resolveMutation } from "../../src/native.ts";
import { describe, expect, test } from "bun:test";
import { invoke, useNativeFixture, useRepositoryFixture } from "./support.ts";
import { createMachine } from "xstate";
import { join } from "node:path";
import { realpath } from "node:fs/promises";
import { z } from "zod";

const FIRST = 0;
const ONE = 1;

describe("native tracker routing", () => {
	const fixture = useNativeFixture("busybee-native-");
	test("native tracker discovery routes writes to the repository database with owner and actor #test-29", async () => {
		const endpoint = await resolveMutation({ actor: fixture.options.actor }, fixture.services);
		expect(endpoint).toEqual({
			actor: fixture.options.actor,
			db: await realpath(fixture.options.db),
			repo: fixture.options.repo,
		});
		const id = await createTask(
			endpoint,
			{
				acceptanceCriteria: "- [ ] Native acceptance is stored separately",
				description: "Check native repository selection",
				labels: [],
				owner: fixture.options.owner,
				status: "open",
				title: "Native selection",
			},
			fixture.services,
		);
		await expect(readBead(fixture.options, id, fixture.services)).resolves.toMatchObject({
			acceptance_criteria: "- [ ] Native acceptance is stored separately",
			created_by: fixture.options.actor,
			description: "Check native repository selection",
			id,
			owner: fixture.options.owner,
			status: "open",
		});
	});
});

describe("definition discovery without a tracker", () => {
	const fixture = useRepositoryFixture("busybee-discovery-");

	test(
		"schema discovery works without a database while starting from the " +
			"same checkout fails clearly #test-30",
		async () => {
			const source = join(fixture.options.repo, "workflow.ts");
			const commands: { argv: string[]; cwd: string }[] = [];
			const errors: unknown[] = [];
			let writes = FIRST;
			const services = {
				...fixture.services,
				beads: createNativeBeads({
					execute: async (argv, cwd) => {
						commands.push({ argv, cwd });
						try {
							return await fixture.services.execute(argv, cwd);
						} catch (error) {
							errors.push(error);
							throw error;
						}
					},
				}),
				beforeWrite: () => {
					writes += ONE;
				},
				importModule: () =>
					Promise.resolve({
						commandSchemas: { next: z.object({}) },
						inputSchema: z.object({ goal: z.string() }),
						machine: createMachine({
							initial: "work",
							states: {
								done: { type: "final" },
								work: {
									meta: {
										commands: { next: "NEXT" },
										task: () => ({ instructions: "Complete work" }),
										title: "Worker",
									},
									on: { NEXT: "done" },
								},
							},
						}),
						runBrief: () => ({
							description: "Complete the fixture tasks",
							title: "Integration workflow",
						}),
					}),
				readBytes: () =>
					Promise.reject(new Error("Schema discovery must not read provenance bytes")),
			};
			await expect(invoke(["input-schema", "--source", source], services)).resolves.toMatchObject({
				code: FIRST,
				document: {
					kind: "input-schema",
					ok: true,
					schema: {
						properties: { goal: { type: "string" } },
						required: ["goal"],
						type: "object",
					},
				},
				stderr: "",
			});
			expect({ commands, writes }).toEqual({ commands: [], writes: FIRST });
			const start = await invoke(
				[
					"--actor",
					fixture.options.actor,
					"--owner",
					fixture.options.owner,
					"--parent",
					"existing-work",
					"start",
					source,
				],
				services,
			);
			expect(errors[FIRST]).toMatchObject({ nativeError: { code: "NOT_INITIALIZED" } });
			expect({
				commands,
				errors,
				start,
				writes,
				databaseExists: await Bun.file(fixture.options.db).exists(),
			}).toMatchObject({
				commands: [{ argv: ["br", "where", "--json"], cwd: fixture.options.repo }],
				databaseExists: false,
				errors: [expect.any(CommandError)],
				start: {
					code: ONE,
					document: {
						kind: "start",
						message: (errors[FIRST] as CommandError).message,
						ok: false,
						reason: "command_failed",
						target: source,
					},
					stderr: "",
				},
				writes: FIRST,
			});
		},
	);
});

test("the public executable emits one JSON error document and keeps stderr silent #test-31", async () => {
	const runner = new URL("../../bin/busybee.ts", import.meta.url).pathname;
	const proc = Bun.spawn([process.execPath, runner, "--not-an-option", "--json"], {
		cwd: new URL("../../../..", import.meta.url).pathname,
		env: process.env,
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
