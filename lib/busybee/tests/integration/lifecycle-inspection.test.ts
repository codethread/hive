import { BusyBeeError, createServices } from "../../src/native.ts";
import { complete, navigate, start } from "../../src/runtime.ts";
import { expect, test } from "bun:test";
import { createMachine } from "xstate";
import { createMemoryBeads } from "@hive/beads";
import { inspectLifecycle } from "../../src/lifecycle.ts";
import { invoke } from "./support.ts";
import { z } from "zod";

const FIRST = 0;
const scope = { actor: "worker", cwd: "/lifecycle", db: "/lifecycle/beads.db" };
const definition = {
	inputSchema: z.object({}),
	commandSchemas: { reject: z.object({ accepted: z.literal(false) }) },
	runBrief: () => ({ title: "Lifecycle", description: "Inspect native facts" }),
	machine: createMachine({
		initial: "work",
		states: {
			work: {
				meta: {
					title: "Decision",
					commands: { reject: "REJECT" },
					task: () => ({ instructions: "Decide" }),
				},
				on: { REJECT: "done" },
			},
			done: { type: "final" },
		},
	}),
};
const reasons = [
	{
		reason: "Completed by older engine",
		expected: "unavailable",
		title: "#test-79 native closure classification retains unavailable",
	},
	{
		reason: '{"kind":"busybee-lifecycle"}',
		expected: "invalid_lifecycle",
		title: "#test-76 native closure classification retains invalid_lifecycle",
	},
	{
		reason: '{"kind":"busybee-lifecycle"',
		expected: "invalid_lifecycle",
		title: "#test-80 native closure classification retains invalid_lifecycle",
	},
	{
		reason: JSON.stringify({
			kind: "busybee-lifecycle",
			formatVersion: 1,
			scope: "visit",
			runId: "wrong",
			outcome: "succeeded",
			reason: "Wrong scope",
		}),
		expected: "invalid_lifecycle",
		title: "#test-81 native closure classification retains invalid_lifecycle",
	},
];

test.each(reasons)("$title", async ({ reason, expected }) => {
	const selected = await fixture();
	await selected.beads.close(scope, selected.request.bead, {
		reason: "Historical worker completion",
	});
	await selected.beads.close(scope, selected.run.id, { reason });
	const result = inspectLifecycle(selected.run.id, {}, selected.services);
	if (expected === "unavailable") {
		expect(await result).toMatchObject({
			nativeStatus: "closed",
			lifecycle: { kind: "unavailable", reason: "unclassified_closure" },
		});
	} else {
		await expect(result).rejects.toBeInstanceOf(BusyBeeError);
		await expect(result).rejects.toMatchObject({ reason: expected });
	}
});

// Native closure is authoritative even when its receipt is lost under retained publication ownership.
// eslint-disable-next-line max-statements
test("#test-74 uncertain final closure retains lock and exposes only confirmed native success", async () => {
	const uncertain = await fixture();
	await complete(uncertain.request, {}, uncertain.authoring);
	const { services, beads, run } = uncertain;
	const publishing = {
		...uncertain.authoring,
		beads: {
			...beads,
			close: async (...args: Parameters<typeof beads.close>) => {
				await beads.close(...args);
				throw new Error("Native close receipt lost");
			},
		},
	};
	await expect(
		navigate({ id: run.id, operation: "collect" }, {}, publishing),
	).rejects.toMatchObject({ reason: "partial_effects" });
	const result = await invoke(["inspect", run.id], services);
	expect(result).toMatchObject({
		code: 0,
		stderr: "",
		document: {
			lifecycle: { kind: "terminal", fact: { outcome: "succeeded" } },
			publication: { locked: true },
		},
	});
	const root = await beads.show(scope, run.id);
	const checkpointId = root.dependencies.find((edge) => edge.dependency_type === "related")!.id;
	const checkpoint = await beads.show(scope, checkpointId);
	expect(checkpoint.notes).not.toBe("");
});

test("#test-77 refused final closure leaves lifecycle pending under retained publication ownership", async () => {
	const refused = await fixture();
	await complete(refused.request, {}, refused.authoring);
	const publishing = {
		...refused.authoring,
		beads: { ...refused.beads, close: () => Promise.reject(new Error("Native closure refused")) },
	};
	await expect(
		navigate({ id: refused.run.id, operation: "collect" }, {}, publishing),
	).rejects.toMatchObject({ reason: "partial_effects" });
	const inspected = await inspectLifecycle(refused.run.id, {}, refused.services);
	expect(inspected).toMatchObject({
		nativeStatus: "in_progress",
		lifecycle: { kind: "pending" },
		publication: { locked: true },
	});
	const record = await refused.beads.show(scope, refused.run.id);
	expect(record.close_reason).toBeUndefined();
});

test("#test-75 lifecycle schema discovery never selects a native endpoint", async () => {
	const services = createServices();
	const result = await invoke(["inspect", "--schema"], {
		...services,
		beads: { ...services.beads, where: () => Promise.reject(new Error("No tracker access")) },
	});
	expect(result).toMatchObject({
		code: 0,
		document: { kind: "workflow_lifecycle_schema", ok: true, schema: { type: "object" } },
	});
});

// --- Private functions ---

async function fixture() {
	const beads = createMemoryBeads({ db: scope.db });
	const authoring = {
		...createServices(),
		actor: scope.actor,
		beads,
		cwd: scope.cwd,
		importModule: () => Promise.resolve(definition),
		readBytes: () => Promise.resolve(new ArrayBuffer(FIRST)),
	};
	const parent = await beads.create(scope, { title: "Pilot", owner: "ct" });
	const run = await start("workflow.ts", { owner: "ct", parent: parent.id }, authoring);
	const services = {
		...authoring,
		importModule: () => Promise.reject(new Error("Definitions inaccessible")),
		readBytes: () => Promise.reject(new Error("Definitions inaccessible")),
	};
	return {
		beads,
		run,
		services,
		authoring,
		request: {
			id: run.id,
			bead: run.active[FIRST]!.bead,
			choice: "reject",
			data: { accepted: false },
		},
	};
}
