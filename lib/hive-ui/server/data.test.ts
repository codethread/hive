import { boardFilterSchema, boardScopeSchema, inventoryFilterSchema } from "../contracts.ts";
import { expect, test } from "bun:test";
import type { BeadsService } from "@hive/beads";
import type { Card } from "../contracts.ts";
import { colony } from "../src/stories/fixtures.ts";
import { createBoardData } from "./data.ts";
import { createMemoryBeads } from "@hive/beads";

const scope = { cwd: colony.root, db: colony.beadsDb, actor: "fixture" };
const filter = boardFilterSchema.parse({ view: "beads", closed: true });
const view = { scope: boardScopeSchema.parse({ view: "beads" }), refreshAfter: 0 };
const seeded = await workflowFixture();

test("board identifies workflow-generated records from retained system JSON", async () => {
	const board = await createBoardData().board(seeded.context, filter, 0);
	expect(workflowIds(board.cards)).toEqual(seeded.expected);
});

test("family identifies workflow-generated records from retained system JSON", async () => {
	const family = await createBoardData().hierarchy(seeded.context, [seeded.source.id], 0);
	expect(workflowIds(family.nodes)).toEqual(seeded.expected);
});

test("outline identifies workflow-generated records from retained system JSON", async () => {
	const outline = await createBoardData().outline(seeded.context, seeded.source.id, 0);
	expect(workflowIds(outline.nodes)).toEqual(seeded.expected);
});

test("detail includes generated visits but excludes agent-created nested work", async () => {
	const data = createBoardData();
	const details = await Promise.all(
		[seeded.source, ...seeded.roots, seeded.visit, seeded.manual].map((bead) =>
			data.detail(seeded.context, bead.id, view),
		),
	);
	for (const detail of details) {
		expect(detail.card.isWorkflowGenerated).toBe(seeded.expected.includes(detail.card.id));
	}
});

async function workflowFixture() {
	const beads = createMemoryBeads();
	const source = await beads.create(scope, { title: "Do work: misleading ordinary task" });
	const roots = await Promise.all(
		["open", "in_progress", "closed"].map((status) =>
			beads.create(scope, { title: "Run", status, parent: source.id }),
		),
	);
	const visit = await beads.create(scope, { title: "Generated visit", parent: roots[0]!.id });
	const manual = await beads.create(scope, { title: "Agent-created child", parent: roots[0]!.id });
	await Promise.all(
		roots.map(async (root) => {
			const created: { bead: string }[] = [];
			if (root.id === roots[0]!.id) {
				created.push({ bead: visit.id });
			}
			const checkpoint = await beads.create(scope, {
				title: "Workflow system bead",
				status: root.status,
				labels: ["system", "busybee-checkpoint"],
				description: JSON.stringify({
					id: root.id,
					created,
				}),
			});
			await beads.dep.add(scope, root.id, checkpoint.id, "related");
		}),
	);
	await beads.create(scope, {
		title: "Incomplete marker is not a workflow system bead",
		labels: ["busybee-checkpoint"],
		description: "Not workflow JSON",
	});
	return {
		source,
		roots,
		visit,
		manual,
		expected: [...roots.map((root) => root.id), visit.id].toSorted(),
		context: { beads, colony, requestId: "test", log: async () => {} },
	};
}

test("board identity uses one system query with no per-bead relationship lookup", async () => {
	const fixture = await workflowFixture();
	let systemReads = 0;
	let edgeReads = 0;
	const beads: BeadsService = {
		...fixture.context.beads,
		list: (input, selection) => {
			if (selection?.labels?.includes("busybee-checkpoint") === true) {
				systemReads++;
			}
			return fixture.context.beads.list(input, selection);
		},
		dep: {
			...fixture.context.beads.dep,
			list: (input, id, selection) => {
				edgeReads++;
				return fixture.context.beads.dep.list(input, id, selection);
			},
		},
	};
	const board = await createBoardData().board({ ...fixture.context, beads }, filter, 0);
	expect(workflowIds(board.cards)).toEqual(fixture.expected);
	expect(systemReads).toBe(1);
	expect(edgeReads).toBe(0);
});

function workflowIds(cards: Card[]): string[] {
	return cards
		.filter((card) => card.isWorkflowGenerated)
		.map((card) => card.id)
		.toSorted();
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
