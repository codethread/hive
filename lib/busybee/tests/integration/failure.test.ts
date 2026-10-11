import { expect, test } from "bun:test";
import { createMachine } from "xstate";
import { createMemoryBeads } from "@hive/beads";
import { createServices } from "../../src/native.ts";
import { invoke } from "./support.ts";
import { z } from "zod";

const EMPTY = 0;

test("an initial actor failure returns JSON without creating tasks", async () => {
	const beads = createMemoryBeads({ db: "/busybee-failure/beads.db" });
	const definition = {
		commandSchemas: { next: z.object({}) },
		inputSchema: z.object({}),
		machine: createMachine({
			context: () => {
				throw new Error("Initial context failure");
			},
			initial: "work",
			states: {
				work: {
					meta: {
						title: "Worker",
						task: () => ({ instructions: "Complete work" }),
						commands: { next: "NEXT" },
					},
				},
			},
		}),
		runBrief: () => ({ title: "Example", description: "Example workflow" }),
	};
	const services = {
		...createServices(),
		actor: undefined,
		beads,
		cwd: "/busybee-failure",
		execute: () => Promise.reject(new Error("Workflow behavior must not launch processes")),
		importModule: () => Promise.resolve(definition),
		readBytes: () => Promise.resolve(new ArrayBuffer(EMPTY)),
	};
	const scope = { cwd: services.cwd };
	const selection = { all: true, limit: 0 };
	const before = await beads.list(scope, selection);
	const result = await invoke(
		["--actor", "test-agent", "--owner", "test-human", "start", "/busybee-failure/workflow.ts"],
		services,
	);
	expect(result.document).toMatchObject({ ok: false, reason: "command_failed" });
	expect(await beads.list(scope, selection)).toEqual(before);
});
