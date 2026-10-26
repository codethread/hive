import { BusyBeeError, createServices } from "../../src/native.ts";
import { expect, test } from "bun:test";
import { navigate, recordResult, startNamed } from "../../src/runtime.ts";
import type { Services } from "../../src/native.ts";
import { createMachine } from "xstate";
import { createMemoryBeads } from "@hive/beads";
import { z } from "zod";

const FIRST = 0;
const ONE_ACTIVE_VISIT = 1;
const canonicalRoot = "/canonical";
const basePath = "/feature";
const isolationPath = "/task";
const db = "/selected/beads.db";
const actor = "simulated-driver";
const evidence = "Saved outcome";
const bytes = new TextEncoder().encode("unchanged canonical definition").buffer;
const manifest = 'description="Recovery fixture"\nversion="0.3.0"\nrun="./workflow.ts"';
const inputSchema = z.object({});
const commandSchemas = { next: z.object({ evidence: z.string() }) };
const task = {
	title: "Work",
	commands: { next: "NEXT" },
	task: () => ({ instructions: "Complete work" }),
};
const definition = {
	inputSchema,
	commandSchemas,
	runBrief: () => ({ title: "Recovery", description: "Resume from the surviving catalogue" }),
	machine: createMachine({
		id: "recovery",
		initial: "first",
		states: {
			first: { meta: task, on: { NEXT: "second" } },
			second: { meta: task, on: { NEXT: "done" } },
			done: { type: "final" },
		},
	}),
};

test.each(["first", "second"] as const)(
	"canonical catalogue resumes %s after version mismatch and checkout loss #test-333",
	// eslint-disable-next-line max-statements -- Keep catalogue recovery and source-closure assertions together.
	async (position) => {
		const beads = createMemoryBeads({ db });
		const scope = { actor, cwd: canonicalRoot, db };
		const feature = await beads.create(scope, { title: "Feature", owner: "ct" });
		const source = await beads.create(scope, {
			title: "Source",
			owner: "ct",
			parent: feature.id,
			assignee: actor,
		});
		const prerequisite = await beads.create(scope, { title: "Prerequisite", owner: "ct" });
		const dependent = await beads.create(scope, { title: "Dependent", owner: "ct" });
		await beads.dep.add(scope, dependent.id, source.id, "blocks");
		await beads.dep.add(scope, source.id, prerequisite.id, "blocks");
		if (position === "second") {
			await beads.close(scope, prerequisite.id);
		}
		let featureChanged = false;
		const imports: string[] = [];
		const io: Services = {
			...createServices(),
			actor,
			beads,
			cwd: canonicalRoot,
			execute: (_argv, cwd) => Promise.resolve(cwd),
			isFile: (path) => Promise.resolve(!path.startsWith(`${isolationPath}/`)),
			readDirectory: () => Promise.resolve([{ kind: "file", name: "workflow.ts" }]),
			readBytes: () => Promise.resolve(bytes),
			readText: (path) => {
				if (path.startsWith(`${isolationPath}/`)) {
					return Promise.reject(
						Object.assign(new Error("Removed task checkout"), { code: "ENOENT" }),
					);
				}
				if (path === "input.json") {
					return Promise.resolve("{}");
				}
				if (featureChanged && path.startsWith(`${basePath}/`)) {
					return Promise.resolve(manifest.replace("0.3.0", "0.4.0"));
				}
				return Promise.resolve(manifest);
			},
			importModule: (path) => {
				imports.push(path);
				return Promise.resolve(definition);
			},
		};
		const options = { db, owner: "ct", parent: source.id, inputFile: "input.json" };
		let run = await startNamed("example", options, io);
		if (position === "second") {
			const first = run.active[FIRST]!.bead;
			await recordResult(
				{ id: run.id, bead: first, choice: "next", data: { evidence } },
				{ db },
				io,
			);
			await beads.close(scope, first);
			run = await navigate({ id: run.id, operation: "collect" }, { db }, io);
		}
		const stage = run.active[FIRST]!.bead;
		const beforeStage = await beads.show(scope, stage);
		featureChanged = true;
		const failure = await navigate(
			{ id: run.id, operation: "show" },
			{ db, repo: basePath },
			io,
		).catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(BusyBeeError);
		expect(failure).toMatchObject({
			reason: "definition_changed",
			context: { savedVersion: "0.3.0", proposedVersion: "0.4.0" },
		});
		const removedCheckout = await navigate(
			{ id: run.id, operation: "show" },
			{ db, repo: isolationPath },
			io,
		).catch((error: unknown) => error);
		expect(removedCheckout).toBeInstanceOf(Error);
		expect(removedCheckout).toMatchObject({ code: "ENOENT" });
		expect(await beads.show(scope, stage)).toEqual(beforeStage);
		const restored = await navigate(
			{ id: run.id, operation: "show" },
			{ db, repo: canonicalRoot },
			io,
		);
		expect(restored.active).toMatchObject([{ bead: stage }]);
		if (position === "first") {
			await beads.close(scope, prerequisite.id);
		}

		await recordResult(
			{ id: run.id, bead: stage, choice: "next", data: { evidence } },
			{ db, repo: canonicalRoot },
			io,
		);
		await beads.close(scope, stage);
		const next = await navigate(
			{ id: run.id, operation: "collect" },
			{ db, repo: canonicalRoot },
			io,
		);
		expect(imports.every((path) => path.startsWith(`${canonicalRoot}/`))).toBe(true);
		expect(await beads.show(scope, source.id)).toMatchObject({ status: "open", assignee: actor });
		expect(await beads.ready(scope)).not.toContainEqual(
			expect.objectContaining({ id: dependent.id }),
		);
		if (position === "second") {
			expect(next).toMatchObject({ status: "done", active: [] });
			// Source closure is a separate caller action, not an effect of workflow completion.
			await beads.close(scope, source.id, { reason: evidence });
			expect(await beads.ready(scope)).toContainEqual(
				expect.objectContaining({ id: dependent.id }),
			);
		} else {
			expect(next.status).toBe("active");
			expect(next.active).toHaveLength(ONE_ACTIVE_VISIT);
			expect(next.active[FIRST]!.commands).toContain("next");
		}
	},
);
