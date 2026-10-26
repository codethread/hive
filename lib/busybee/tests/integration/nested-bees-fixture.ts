import { complete, navigate, start } from "../../src/runtime.ts";
import {
	spawnRequestLabels,
	workflowInspectionSchema,
	workflowSimulationSchema,
} from "@hive/shared";
import type { Services } from "../../src/native.ts";
import type { WorkflowSimulationRequest } from "@hive/shared";
import { captureCli } from "./support.ts";
import { createMemoryBeads } from "@hive/beads";
import { createServices } from "../../src/native.ts";
import { inspect } from "../../src/preview.ts";
import { simulate as simulateWorkflow } from "../../src/simulation.ts";

const FIRST = 0;
const KIND_ARGUMENT = 3;
const STAGE_ARGUMENT = 4;
const RUN_ARGUMENT = 6;
const db = "/nested-bees-fixture/beads.db";
const repo = "/nested-bees-fixture";

/** Capture shipped-example responses, validating successful outputs for serialization. */
export async function captureNestedBees() {
	const fixture = await startNestedBees();
	const simulation = await fixture.simulate();
	const completion = await fixture.finish();
	return {
		captured: {
			started: workflowInspectionSchema.parse(fixture.started),
			mixed: workflowInspectionSchema.parse(simulation.captured.mixed),
			handoff: workflowInspectionSchema.parse(completion.handoff),
			unsupported: simulation.captured.unsupported,
			childSaved: workflowSimulationSchema.parse(simulation.captured.childSaved),
			childSimulation: workflowSimulationSchema.parse(simulation.captured.childSimulation),
			interfaceSimulation: workflowSimulationSchema.parse(simulation.captured.interfaceSimulation),
		},
	};
}

/** Use memory Beads and mocked dispatch while reading the shipped example from disk. */
// eslint-disable-next-line max-statements -- Keep run setup and its simulation/completion continuations together.
async function startNestedBees() {
	const scope = { actor: "example-driver", cwd: repo, db };
	const options = { actor: scope.actor, repo, db };
	const { definition, source } = {
		definition: await import("../../examples/nested-bees/workflow.ts"),
		source: import.meta.resolve("../../examples/nested-bees/workflow.ts").replace("file://", ""),
	};
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
	let run = await start(source, { ...options, owner: "ct", parent: parent.id }, services);
	const records = async () => {
		const { issues } = await beads.list(scope, { all: true, limit: FIRST });
		return beads.showMany(
			scope,
			issues.map(({ id }) => id),
		);
	};
	const beforeInspection = await records();
	const started = await inspect(run.id, options, services);
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
	return { started, calls, originalVisits, beforeInspection, afterInspection, simulate, finish };

	// eslint-disable-next-line max-statements -- Capture saved and replayed child frontiers without publication.
	async function simulate() {
		const mixed = await inspect(run.id, options, services);
		const beforeSimulation = await records();
		const request: WorkflowSimulationRequest = {
			checkpoint: mixed.checkpoint,
			savedAt: mixed.savedAt,
			definitionHash: mixed.definition.currentHash,
			actorId: mixed.actors[FIRST]!.id,
			start: { kind: "saved" },
			events: [],
		};
		// Keep child replays typed; only root rejection needs the CLI failure envelope.
		const replay = (body: WorkflowSimulationRequest) =>
			simulateWorkflow({ id: run.id, request: body }, options, {
				...services,
				beforeWrite: forbidden,
				execute: forbidden,
			});
		const unsupported = await captureCli(
			[
				"--repo",
				repo,
				"--db",
				db,
				"system",
				"simulate",
				run.id,
				"--request",
				JSON.stringify(request),
				"--json",
			],
			{ ...services, beforeWrite: forbidden, execute: forbidden },
		);
		const childSaved = await replay({ ...request, actorId: 'actor:["api"]' });
		const child = await replay({
			...request,
			actorId: 'actor:["api"]',
			events: [{ node: "nested-worker.verify", command: "next", data: {} }],
		});
		const interfaceReplay = await replay({
			...request,
			actorId: 'actor:["interface"]',
			events: [{ node: "nested-worker.implement", command: "next", data: {} }],
		});
		return {
			captured: {
				mixed,
				unsupported: JSON.parse(unsupported.stdout),
				childSaved,
				childSimulation: child,
				interfaceSimulation: interfaceReplay,
			},
			unsupportedCode: unsupported.code,
			beforeSimulation,
			afterSimulation: await records(),
		};
	}

	async function finish() {
		await finishVisit(["api"], "nested-worker.verify");
		await finishVisit(["interface"], "nested-worker.implement");
		await finishVisit(["interface"], "nested-worker.verify");
		const handoff = await inspect(run.id, options, services);
		await finishVisit([], "nested-bees.handoff");
		return {
			handoff,
			finalRun: run,
			parent: await beads.show(scope, parent.id),
			records: await records(),
		};
	}
}

function forbidden(): never {
	throw new Error("Inspection and simulation must not publish effects");
}
