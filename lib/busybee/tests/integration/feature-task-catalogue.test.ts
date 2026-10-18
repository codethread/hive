import { BusyBeeError, createServices } from "../../src/native.ts";
import {
	commandSchemas,
	inputSchema,
	machine,
	resumeSchema,
	runBrief,
	validateCommand,
} from "../../../../.workflows/do-feature-task/workflow.ts";
import { createMachine, initialTransition } from "xstate";
import { expect, test } from "bun:test";
import { navigate, recordResult, startNamed } from "../../src/runtime.ts";
import type { Services } from "../../src/native.ts";
import { createMemoryBeads } from "@hive/beads";

const FIRST = 0;
const ONE_ACTIVE_VISIT = 1;
const OID_LENGTH = 40;
const canonicalRoot = "/canonical";
const basePath = "/feature";
const isolationPath = "/task";
const db = "/selected/beads.db";
const actor = "simulated-driver";
const evidence = "SIMULATED catalogue recovery, not real reviews, integration or cleanup.";
const bytes = new TextEncoder().encode("unchanged canonical definition").buffer;
const manifest = 'description="Feature delivery"\nversion="0.1.0"\nrun="./workflow.ts"';

// Mirror the injected authoring/catalogue harness in compatibility.test.ts.
// The rendered-brief test separately checks the definition selects this caller checkout.
test.each(["prepare", "report"] as const)(
	"canonical catalogue resumes %s after the feature definition breaks and the task checkout disappears",
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
		if (position === "report") {
			await beads.close(scope, prerequisite.id);
		}
		const input = inputSchema.parse({
			feature: { id: feature.id, brief: "Original feature" },
			source: { id: source.id, parentId: feature.id, brief: "Original task" },
			beadsDb: db,
			canonicalRoot,
			base: { path: basePath, branch: "feat/example" },
			isolation: { path: isolationPath, branch: "task/example" },
			authority: {
				request: evidence,
				localCommit: true,
				featureIntegration: true,
				sourceClosure: true,
			},
			previousDeliveries: [],
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
					return Promise.resolve(manifest.replace("0.1.0", "0.2.0"));
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
					validateCommand,
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
			context: { savedVersion: "0.1.0", proposedVersion: "0.2.0" },
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
		let choice: "waiting" | "reported" = "waiting";
		let data: Record<string, unknown> = { evidence };
		if (position === "report") {
			choice = "reported";
			data = { evidence, responseId: "simulated-run-response" };
		}
		await recordResult({ id: run.id, bead: stage, choice, data }, { db, repo: canonicalRoot }, io);
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
		if (position === "report") {
			expect(next).toMatchObject({ status: "done", active: [] });
			// Only the distinct authorized caller tail releases the source's dependent.
			await beads.close(scope, source.id, { reason: evidence });
			expect(await beads.ready(scope)).toContainEqual(
				expect.objectContaining({ id: dependent.id }),
			);
		} else {
			expect(next.status).toBe("active");
			expect(next.active).toHaveLength(ONE_ACTIVE_VISIT);
			expect(next.active[FIRST]!.commands).toContain("recheck");
		}
	},
);

function reportingMachine(
	position: "prepare" | "report",
	input: Parameters<typeof runBrief>[typeof FIRST],
) {
	if (position === "prepare") {
		return machine;
	}
	const [initial] = initialTransition(machine, input);
	const sourceOid = "b".repeat(OID_LENGTH);
	const candidate = {
		baseOid: "a".repeat(OID_LENGTH),
		sourceOid,
		candidateOid: sourceOid,
		treeOid: "c".repeat(OID_LENGTH),
	};
	const proof = {
		kind: "native-observation",
		identity: {
			root: canonicalRoot,
			worktree_path: isolationPath,
			source_branch: input.isolation.branch,
			target_branch: input.base.branch,
			target_worktree_path: basePath,
			source_oid: sourceOid,
		},
		candidate,
		targetOid: sourceOid,
		sourceContained: true,
		evidence,
		origin: { kind: "interrupted", evidence },
	};
	const context = resumeSchema.parse({
		...initial.context,
		taskBee: actor,
		candidate,
		origins: [proof.origin],
		delivery: {
			kind: "cleaned",
			integration: proof,
			cleanup: { ...proof, worktreeAbsent: true, branchAbsent: true, targetUnchanged: true },
		},
	});
	// Simulated persisted reporting frontier: quality paths are covered in feature-task.test.ts.
	return createMachine(
		{ ...machine.config, initial: "report", context },
		{
			actions: machine.implementations.actions,
			guards: machine.implementations.guards,
		},
	);
}
