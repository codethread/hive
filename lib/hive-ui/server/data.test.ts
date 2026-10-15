import { boardFilterSchema, inventoryFilterSchema } from "../contracts.ts";
import { expect, test } from "bun:test";
import { samplePreview, workflowSamples } from "../src/stories/workflow-samples.ts";
import { colony } from "../src/stories/fixtures.ts";
import { createBoardData } from "./data.ts";
import { createMemoryBeads } from "@hive/beads";

const scope = { cwd: colony.root, db: colony.beadsDb, actor: "fixture" };
const filter = boardFilterSchema.parse({ view: "beads", closed: true });
const seeded = await workflowFixture();

async function workflowFixture() {
	const beads = createMemoryBeads();
	const root = await beads.create(scope, { title: "Run" });
	const manual = await beads.create(scope, { title: "Agent-created child", parent: root.id });
	const checkpoint = await beads.create(scope, {
		title: "Workflow system bead",
		labels: ["system", "busybee-checkpoint"],
		description: JSON.stringify({ id: root.id, created: [] }),
	});
	await beads.dep.add(scope, root.id, checkpoint.id, "related");
	return { manual, context: { beads, colony, requestId: "test", log: async () => {} } };
}

// eslint-disable-next-line max-statements -- One request fixture verifies both public projections.
test("board and inventory project cross-host attribution without requiring execution assignment", async () => {
	const beads = createMemoryBeads();
	const task = await beads.create(scope, {
		title: "Work",
		status: "in_progress",
		assignee: "friendly-bee",
	});
	const request = await beads.create(scope, {
		title: "Request",
		status: "open",
		assignee: "friendly-bee",
		labels: ["system", "bee", "agent:worker"],
		description: JSON.stringify({
			harness: "codex",
			kind: "worker",
			model: "gpt-6-astra",
			host: "another-host",
		}),
	});
	await beads.dep.add(scope, request.id, task.id, "related");
	const context = { beads, colony, requestId: "test", log: async () => {} };
	const data = createBoardData();
	const board = await data.board(context, filter, 0);
	expect(
		board.cards.find((card) => card.id === task.id)?.beeAssignments.map((bee) => bee.id),
	).toEqual([request.id]);
	const inventory = await data.inventory(context, inventoryFilterSchema.parse({ view: "open" }), 0);
	expect(inventory.kind).toBe("loaded");
	if (inventory.kind === "loaded") {
		expect(inventory.bees.map((bee) => bee.id)).toEqual([request.id]);
	}
});

test("ordinary children cannot open an ancestor workflow", async () => {
	let calls = 0;
	const readPreview = () => {
		calls++;
		return Promise.resolve(samplePreview(workflowSamples[0]!));
	};
	const result = await createBoardData()
		.workflow(seeded.context, seeded.manual.id, readPreview)
		.catch((error: unknown) => error);
	expect(result).toBeInstanceOf(Error);
	expect(calls).toBe(0);
});
