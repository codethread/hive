import { createServices, readBead } from "../../src/native.ts";
import { expect, test } from "bun:test";
import type { BeadsScope } from "@hive/beads";
import type { Services } from "../../src/native.ts";
import { captureCli } from "./support.ts";
import { createMachine } from "xstate";
import { createMemoryBeads } from "@hive/beads";
import { runViewSchema } from "../../src/runtime.ts";
import { z } from "zod";

const FIRST = 0;
const ONE = 1;
const SUCCESS = 0;

// eslint-disable-next-line max-statements -- One successful start checks its observable CLI, projection and endpoint contract.
test("start publishes an initial worker and one JSON success document through the CLI/runtime", async () => {
	const root = "/busybee-start";
	const db = `${root}/.beads/beads.db`;
	const beads = createMemoryBeads({ db });
	const calls: { operation: string; scope: BeadsScope }[] = [];
	const writes: string[] = [];
	const definition = {
		commandSchemas: { next: z.object({}) },
		inputSchema: z.object({}),
		machine: createMachine({
			initial: "work",
			states: {
				work: {
					meta: {
						title: "Worker",
						task: () => ({ instructions: "Complete work" }),
						commands: { next: "NEXT" },
					},
					on: { NEXT: "done" },
				},
				done: { type: "final" },
			},
		}),
		runBrief: () => ({ title: "Example", description: "Example workflow" }),
	};
	const services: Services = {
		...createServices(),
		actor: undefined,
		beads: {
			...beads,
			create: (scope, input) => {
				calls.push({ operation: "create", scope });
				writes.push("create");
				return beads.create(scope, input);
			},
			dep: {
				...beads.dep,
				add: (...args) => {
					const [scope] = args;
					calls.push({ operation: "dep.add", scope });
					writes.push("dep.add");
					return beads.dep.add(...args);
				},
			},
			show: (scope, id) => {
				calls.push({ operation: "show", scope });
				return beads.show(scope, id);
			},
			update: (scope, ids, input) => {
				calls.push({ operation: "update", scope });
				writes.push("update");
				return beads.update(scope, ids, input);
			},
			where: (scope) => {
				calls.push({ operation: "where", scope });
				return beads.where(scope);
			},
		},
		beforeWrite: () => {
			writes.push("beforeWrite");
		},
		cwd: root,
		execute: () => Promise.reject(new Error("Workflow behavior must not launch processes")),
		importModule: () => Promise.resolve(definition),
		readBytes: () => Promise.resolve(new ArrayBuffer(FIRST)),
	};
	const result = await captureCli(
		[
			"--actor",
			"starting-agent",
			"--owner",
			"responsible-human",
			"start",
			`${root}/workflow.ts`,
			"--json",
		],
		services,
	);
	expect(result.code, result.stdout).toBe(SUCCESS);
	expect(result.stderr).toBe("");
	const document: unknown = JSON.parse(result.stdout);
	expect(document).toMatchObject({ kind: "start", ok: true });
	const started = runViewSchema.parse(document);
	expect(started.status).toBe("active");
	expect(started.active).toHaveLength(ONE);
	expect(started.active).toMatchObject([
		{ commands: ["next"], context: {}, instructions: "Complete work", path: [], title: "Worker" },
	]);
	const endpoint = { db, repo: root };
	await expect(readBead(endpoint, started.id, services)).resolves.toMatchObject({
		assignee: "starting-agent",
		created_by: "starting-agent",
		owner: "responsible-human",
		status: "in_progress",
	});
	await expect(readBead(endpoint, started.active[FIRST]!.bead, services)).resolves.toMatchObject({
		assignee: "starting-agent",
		created_by: "starting-agent",
		dependencies: [{ dependency_type: "parent-child", id: started.id }],
		owner: "responsible-human",
		status: "in_progress",
	});
	for (const { operation, scope } of calls) {
		expect(scope.cwd).toBe(root);
		if (operation !== "where") {
			expect(scope.db).toBe(db);
		}
		if (["create", "dep.add", "update"].includes(operation)) {
			expect(scope.actor).toBe("starting-agent");
		}
	}
	expect(writes).toEqual(
		calls
			.filter(({ operation }) => ["create", "dep.add", "update"].includes(operation))
			.flatMap(({ operation }) => ["beforeWrite", operation]),
	);
});
