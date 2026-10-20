import { BusyBeeError, createServices } from "../../src/native.ts";
import {
	commandSchemas,
	inputSchema,
	machine,
	resumeSchema,
	runBrief,
} from "../../../../.workflows/do-feature-task/workflow.ts";
import { createMachine, initialTransition } from "xstate";
import { expect, test } from "bun:test";
import { navigate, recordResult, startNamed } from "../../src/runtime.ts";
import type { Services } from "../../src/native.ts";
import { createMemoryBeads } from "@hive/beads";

const FIRST = 0;
const ONE_ACTIVE_VISIT = 1;
const canonicalRoot = "/canonical";
const basePath = "/feature";
const isolationPath = "/task";
const db = "/selected/beads.db";
const actor = "simulated-driver";
const evidence = "SIMULATED catalogue recovery, not real reviews, integration or cleanup.";
const bytes = new TextEncoder().encode("unchanged canonical definition").buffer;
const manifest = 'description="Feature delivery"\nversion="0.2.0"\nrun="./workflow.ts"';

// Mirror the injected authoring/catalogue harness in compatibility.test.ts.
// The rendered-brief test separately checks the definition selects this caller checkout.
test.each(["prepare", "deliver"] as const)(
	"canonical catalogue resumes %s after the feature definition breaks and the task checkout disappears #test-333",
	// eslint-disable-next-line max-statements -- Keep one named-run recovery and native closure boundary together.
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
		if (position === "deliver") {
			await beads.close(scope, prerequisite.id);
		}
		const input = inputSchema.parse({
			canonicalRoot,
			base: { path: basePath, branch: "feat/example" },
			isolation: { path: isolationPath, branch: "task/example" },
		});
		const selected = reportingMachine(position, input);
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
					return Promise.resolve(JSON.stringify(input));
				}
				if (featureChanged && path.startsWith(`${basePath}/`)) {
					return Promise.resolve(manifest.replace("0.2.0", "0.3.0"));
				}
				return Promise.resolve(manifest);
			},
			importModule: (path) => {
				imports.push(path);
				return Promise.resolve({
					commandSchemas,
					inputSchema,
					machine: selected,
					resumeSchema,
					runBrief,
				});
			},
		};
		const options = { db, owner: "ct", parent: source.id, inputFile: "input.json" };
		const run = await startNamed("do-feature-task", options, io);
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
			context: { savedVersion: "0.2.0", proposedVersion: "0.3.0" },
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
		if (position === "prepare") {
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
		if (position === "deliver") {
			expect(next).toMatchObject({ status: "done", active: [] });
			// Only the distinct authorized caller tail releases the source's dependent.
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

function reportingMachine(
	position: "prepare" | "deliver",
	input: Parameters<typeof runBrief>[typeof FIRST],
) {
	if (position === "prepare") {
		return machine;
	}
	const [initial] = initialTransition(machine, input);
	return createMachine(
		{ ...machine.config, initial: "deliver", context: { ...initial.context, evidence } },
		{ actions: machine.implementations.actions },
	);
}
