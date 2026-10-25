import {
	commandSchemas,
	inputSchema,
	machine,
	runBrief,
} from "../../examples/nested-bees/workflow.ts";
import { complete, navigate, start } from "../../src/runtime.ts";
import {
	spawnRequestLabels,
	workflowInspectionSchema,
	workflowSimulationSchema,
} from "@hive/shared";
import type { Services } from "../../src/native.ts";
import { captureCli } from "./support.ts";
import { createMemoryBeads } from "@hive/beads";
import { createServices } from "../../src/native.ts";
import { inspect } from "../../src/preview.ts";

const definition = { machine, commandSchemas, inputSchema, runBrief };
const FIRST = 0;
const KIND_ARGUMENT = 3;
const STAGE_ARGUMENT = 4;
const RUN_ARGUMENT = 6;
const db = "/nested-bees-fixture/beads.db";
const repo = "/nested-bees-fixture";
const scope = { actor: "example-driver", cwd: repo, db };
const options = { actor: scope.actor, repo, db };

/** Capture public inspection and simulation from an in-memory run with mocked Bee dispatch. */
// eslint-disable-next-line max-statements -- Capture consecutive frontiers from one isolated authored run.
export async function captureNestedBees() {
	const beads = createMemoryBeads({ db });
	const calls: string[][] = [];
	const services: Services = {
		...createServices(),
		actor: scope.actor,
		beads,
		cwd: repo,
		importModule: () => Promise.resolve(definition),
		execute: async (argv) => {
			calls.push(argv);
			const stageId = argv[STAGE_ARGUMENT]!;
			const kind = argv[KIND_ARGUMENT]!;
			const request = await beads.create(scope, {
				title: `Dispatch ${kind}`,
				owner: "ct",
				assignee: `example-${stageId}`,
				labels: spawnRequestLabels(kind),
				description: JSON.stringify({
					kind,
					cwd: repo,
					harness: "fixture",
					model: "fixture",
					effort: "low",
					prompt: "Perform the assigned example visit",
					system_prompt: "Injected example worker",
					assignment: { kind: "stage", runId: argv[RUN_ARGUMENT], stageId },
				}),
			});
			await beads.dep.add(scope, request.id, stageId, "related");
			return JSON.stringify({ ok: true, request: { id: request.id } });
		},
	};
	const parent = await beads.create(scope, { title: "Deliver a small change", owner: "ct" });
	let run = await start(
		import.meta.resolve("../../examples/nested-bees/workflow.ts").replace("file://", ""),
		{ ...options, owner: "ct", parent: parent.id },
		services,
	);
	const records = async () => {
		const { issues } = await beads.list(scope, { all: true, limit: FIRST });
		return beads.showMany(
			scope,
			issues.map(({ id }) => id),
		);
	};
	const beforeInspection = await records();
	const started = workflowInspectionSchema.parse(await inspect(run.id, options, services));
	const afterInspection = await records();
	const originalVisits = run.created;
	const finishVisit = async (path: string[], node: string) => {
		const visit = run.created.findLast(
			(entry) => JSON.stringify(entry.path) === JSON.stringify(path) && entry.node === node,
		)!;
		await complete({ id: run.id, bead: visit.bead, choice: "next", data: {} }, options, services);
		run = await navigate({ id: run.id, operation: "collect" }, options, services);
	};
	await finishVisit(["api"], "nested-worker.implement");
	const mixed = workflowInspectionSchema.parse(await inspect(run.id, options, services));

	const beforeSimulation = await records();
	const request = {
		checkpoint: mixed.checkpoint,
		savedAt: mixed.savedAt,
		definitionHash: mixed.definition.currentHash,
		actorId: mixed.actors[FIRST]!.id,
		start: { kind: "saved" },
		events: [],
	};
	const simulate = (body: unknown) =>
		captureCli(
			[
				"--repo",
				repo,
				"--db",
				db,
				"system",
				"simulate",
				run.id,
				"--request",
				JSON.stringify(body),
				"--json",
			],
			{ ...services, beforeWrite: forbidden, execute: forbidden },
		);
	const unsupported = await simulate(request);
	const childSaved = await simulate({ ...request, actorId: 'actor:["api"]' });
	const child = await simulate({
		...request,
		actorId: 'actor:["api"]',
		events: [{ node: "nested-worker.verify", command: "next", data: {} }],
	});
	const interfaceReplay = await simulate({
		...request,
		actorId: 'actor:["interface"]',
		events: [{ node: "nested-worker.implement", command: "next", data: {} }],
	});
	const childSimulation = workflowSimulationSchema.parse(JSON.parse(child.stdout));
	const afterSimulation = await records();
	await finishVisit(["api"], "nested-worker.verify");
	await finishVisit(["interface"], "nested-worker.implement");
	await finishVisit(["interface"], "nested-worker.verify");
	const handoff = workflowInspectionSchema.parse(await inspect(run.id, options, services));
	await finishVisit([], "nested-bees.handoff");
	return {
		captured: {
			started,
			mixed,
			handoff,
			unsupported: JSON.parse(unsupported.stdout),
			childSaved: workflowSimulationSchema.parse(JSON.parse(childSaved.stdout)),
			childSimulation,
			interfaceSimulation: workflowSimulationSchema.parse(JSON.parse(interfaceReplay.stdout)),
		},
		unsupportedCode: unsupported.code,
		calls,
		originalVisits,
		beforeInspection,
		afterInspection,
		beforeSimulation,
		afterSimulation,
		finalRun: run,
		parent: await beads.show(scope, parent.id),
		records: await records(),
	};
}

function forbidden(): never {
	throw new Error("Inspection and simulation must not publish effects");
}
