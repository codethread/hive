import type { WorkflowInspection, WorkflowPreview } from "./contracts.ts";
import { expect, test } from "bun:test";
import {
	workflowActorGraph,
	workflowScope,
	workflowScopePath,
	workflowScopeSummary,
} from "./src/workflow-graph.ts";
import { createMachine } from "xstate";
import { workflowPreviewSchema } from "./contracts.ts";

function savedActor(
	actor: WorkflowPreview["actors"][number],
): WorkflowInspection["actors"][number] {
	const machine = createMachine(actor.machine);
	void machine.definition;
	const snapshot = machine.resolveState({ value: actor.snapshot.value, context: {} });
	return {
		...actor,
		instructions: { [machine.root.id]: { kind: "none" } },
		snapshot: workflowPreviewSchema.shape.actors.element.shape.snapshot.parse(snapshot),
	};
}

const parallelActor = savedActor({
	id: "root",
	path: [],
	machine: {
		id: "flow",
		type: "parallel",
		on: { RESET: { target: ["#flow.left.review", "#flow.right.review"] } },
		states: {
			left: { initial: "review", states: { review: {}, done: { type: "final" } } },
			right: { initial: "review", states: { review: {}, done: { type: "final" } } },
		},
	},
	snapshot: { value: { left: "review", right: "review" }, status: "active" },
});

const reviewActor = savedActor({
	id: "child",
	path: ["reviewer"],
	machine: {
		id: "reviewer",
		initial: "route",
		states: {
			route: { always: [{ guard: "ready", target: "review" }, { target: "done" }] },
			review: { on: { PING: {}, DONE: [{ target: "done" }, { target: "done" }] } },
			done: { type: "final" },
		},
	},
	snapshot: { value: "review", status: "active" },
});

test("root instructions remain selectable without root transitions #test-510", () => {
	const { graph, current } = workflowActorGraph({
		...reviewActor,
		instructions: {
			reviewer: {
				kind: "frozen",
				title: "Published root",
				instructions: "Frozen root brief",
				bead: "root-visit",
			},
		},
	});

	expect(graph.steps["reviewer"]!.title).toBe("Reviewer");
	expect(graph.transitions["reviewer"]).toEqual([]);
	expect(current).toEqual(["reviewer", "reviewer.review"]);
});

test("parallel branches retain full state identities, active leaves and each transition target", () => {
	const { graph, current } = workflowActorGraph(parallelActor);

	expect(current).toContain("flow.left.review");
	expect(current).toContain("flow.right.review");
	expect(graph.steps["flow.left.review"]!.title).toBe("Left / Review");
	expect(graph.steps["flow.right.review"]!.title).toBe("Right / Review");
	expect(graph.transitions["flow"]!.map((edge) => edge.target)).toEqual([
		"flow.left.review",
		"flow.right.review",
	]);
	expect(new Set(graph.transitions["flow"]!.map((edge) => edge.id)).size).toBe(
		graph.transitions["flow"]!.length,
	);
});

test("saved graph inspection keeps automatic, repeated and targetless transitions without evaluating guards", () => {
	const { graph, current } = workflowActorGraph(reviewActor);

	expect(current).toEqual(["reviewer.review"]);
	expect(graph.steps["reviewer.route"]!.kind).toBe("automatic");
	expect(graph.transitions["reviewer.route"]!.map((edge) => edge.label)).toEqual([
		"always [ready]",
		"always",
	]);
	expect(graph.transitions["reviewer.review"]!.find((edge) => edge.event === "PING")!.target).toBe(
		"reviewer.review",
	);
	const completed = graph.transitions["reviewer.review"]!.filter((edge) => edge.event === "DONE");
	expect(new Set(completed.map((edge) => edge.id)).size).toBe(completed.length);
});

test("scope visibility keeps real parents and authored endpoints when collapsing or focusing", () => {
	const { graph } = workflowActorGraph(parallelActor);
	const collapsed = workflowScope(graph, null, new Set(["flow.left"]));
	const focused = workflowScope(graph, "flow.right", new Set(["flow.left"]));

	expect(collapsed.steps["flow.left"]!.children).toEqual([]);
	expect(collapsed.steps["flow.left.review"]).toBeUndefined();
	expect(collapsed.transitions["flow"]!.map((edge) => edge.target)).toEqual(["flow.right.review"]);
	expect(focused.steps["flow.right"]!.parent).toBeNull();
	expect(focused.steps["flow.right.review"]!.parent).toBe("flow.right");
	expect(focused.steps["flow.left"]).toBeUndefined();
	expect(workflowScopePath(graph, "flow.right.review")).toEqual([
		"flow",
		"flow.right",
		"flow.right.review",
	]);
});

test.each([
	{ left: "review", right: "review", branch: "Review", root: "Left / Review · Right / Review" },
	{ left: "done", right: "review", branch: "Scope done", root: "Left / Done · Right / Review" },
	{ left: "done", right: "done", branch: "Scope done", root: "Scope done" },
])(
	"completion is local to the full scope for $left and $right",
	({ left, right, branch, root }) => {
		const { graph, current } = workflowActorGraph({
			...parallelActor,
			snapshot: { value: { left, right }, status: "active" },
		});
		expect(workflowScopeSummary(graph, "flow.left", current)).toBe(branch);
		expect(workflowScopeSummary(graph, "flow", current)).toBe(root);
		expect(workflowScopeSummary(graph, "flow.left.review", [])).toBe("Not current");
	},
);

test("custom IDs, eventless parallel roots and history retain structural scope semantics #test-532", () => {
	const actor = savedActor({
		id: "root",
		path: [],
		machine: {
			id: "flow",
			type: "parallel",
			always: { guard: "ready", target: ".left" },
			states: {
				history: { type: "history" },
				left: {
					id: "custom",
					initial: "nested",
					states: {
						nested: {
							id: "nested-scope",
							initial: "done",
							states: { done: { id: "nested-final", type: "final" } },
						},
						done: { type: "final" },
					},
				},
				right: { type: "final" },
			},
		},
		snapshot: { value: { left: { nested: "done" }, right: {} }, status: "active" },
	});
	const { graph, current } = workflowActorGraph(actor);
	expect(graph.steps["flow"]!.kind).toBe("parallel");
	expect(graph.steps["custom"]!.parent).toBe("flow");
	expect(workflowScopePath(graph, "nested-final")).toEqual([
		"flow",
		"custom",
		"nested-scope",
		"nested-final",
	]);
	expect(workflowScopeSummary(graph, "nested-scope", current)).toBe("Scope done");
	expect(workflowScopeSummary(graph, "custom", current)).not.toBe("Scope done");
	const completed = workflowActorGraph({
		...actor,
		snapshot: { value: { left: "done", right: {} }, status: "done" },
	});
	expect(workflowScopeSummary(completed.graph, "flow", completed.current)).toBe("Scope done");
});

test("child workflow links use invocation IDs and exact parent actor paths", () => {
	const parent = savedActor({
		id: "parent",
		path: [],
		machine: {
			id: "parent",
			initial: "work",
			invoke: { id: "coordinator", src: "coordinatorLogic" },
			states: {
				work: {
					id: "custom-work",
					invoke: [
						{ id: "reviewer", src: "reviewLogic" },
						{ id: "not-retained", src: "reviewLogic" },
					],
				},
			},
		},
		snapshot: { value: "work", status: "active" },
	});
	const actors = [
		{ ...reviewActor, id: "direct", path: ["reviewer"] },
		{ ...reviewActor, id: "cousin", path: ["other", "reviewer"] },
		{ ...reviewActor, id: "coordinator", path: ["coordinator"] },
	];
	const { graph } = workflowActorGraph(parent, actors);
	expect(graph.steps["parent"]!.workflows).toEqual(["coordinator"]);
	expect(graph.steps["custom-work"]!.workflows).toEqual(["direct"]);
	const completed = structuredClone(actors);
	for (const child of completed) {
		child.snapshot.status = "done";
	}
	expect(workflowActorGraph(parent, completed).graph).toEqual(graph);
	expect(workflowActorGraph(parent).graph.steps["custom-work"]!.workflows).toBeUndefined();
});
