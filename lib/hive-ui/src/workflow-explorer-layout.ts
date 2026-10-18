/* eslint-disable oxc/no-map-spread -- Compose immutable ELK node geometry and routed edge records. */
/* eslint-disable id-length -- ELK and React Flow share the x/y coordinate shape. */
import type { ElkExtendedEdge, ElkNode, ElkPort } from "elkjs/lib/elk-api.js";
import ELK from "elkjs/lib/elk.bundled.js";
import type { WorkflowGraph } from "./workflow-graph.ts";

// Canvas geometry is in pixels; spacing follows Tailwind's 4px scale.
export const canvasSettings = {
	cardSpacing: 16,
	layerSpacing: 24,
	edgeSpacing: 12,
	edgeClearance: 8,
	cardSize: { width: 228, height: 80 },
	workflowLinkHeight: 44,
	scopeSize: { width: 320, height: 140, header: 72 },
	labelCharacterWidth: 8,
	labelPadding: 24,
	labelHeight: 32,
	labelBgPadding: { horizontal: 8, vertical: 5 },
	labelBgBorderRadius: 5,
	hoverArrowSize: 8,
	gridGap: 24,
	gridDotSize: 1,
	initialDirection: "DOWN" as const,
	initialZoom: 1,
	minZoom: 0.01,
	maxZoom: 1.5,
	fitView: { padding: 0.12 },
	focusDuration: 250,
	variants: { columns: 3, gap: 80, edgeWidth: 320, edgeHeight: 96, edgeInset: 24 },
};
const HALF = 2;
const elk = new ELK({
	defaultLayoutOptions: {
		"elk.algorithm": "layered",
		"elk.edgeRouting": "ORTHOGONAL",
		"elk.portConstraints": "FREE",
		"elk.edgeLabels.placement": "CENTER",
		"elk.edgeLabels.inline": "true",
		"elk.spacing.nodeNode": String(canvasSettings.cardSpacing),
		"elk.layered.spacing.nodeNodeBetweenLayers": String(canvasSettings.layerSpacing),
		"elk.spacing.edgeEdge": String(canvasSettings.edgeSpacing),
		"elk.layered.spacing.edgeEdgeBetweenLayers": String(canvasSettings.edgeSpacing),
		"elk.spacing.edgeNode": String(canvasSettings.edgeClearance),
		"elk.layered.spacing.edgeNodeBetweenLayers": String(canvasSettings.edgeClearance),
		"elk.layered.mergeEdges": "false",
		"elk.layered.cycleBreaking.strategy": "DEPTH_FIRST",
	},
});
const graphs = new WeakMap<WorkflowGraph, Map<LayoutDirection, Promise<WorkflowLayout>>>();

export type LayoutDirection = "DOWN" | "RIGHT";
export type PortSide = "NORTH" | "EAST" | "SOUTH" | "WEST";

export interface WorkflowPort {
	/** Unique connection point for one transition endpoint. */
	id: string;
	/** Whether this endpoint emits or receives a transition. */
	type: "source" | "target";
	/** Actual card side used by the routed endpoint. */
	side: PortSide;
	/** Horizontal offset from the node's top-left corner. */
	x: number;
	/** Vertical offset from the node's top-left corner. */
	y: number;
}

export interface WorkflowLayout {
	/** Parent-relative node positions and node-relative port offsets computed together by ELK. */
	nodes: {
		id: string;
		parent: string | null;
		width: number;
		height: number;
		position: { x: number; y: number };
		ports: WorkflowPort[];
	}[];
	/** Orthogonal paths and label centers in graph coordinates. */
	edges: {
		id: string;
		source: string;
		target: string;
		sourceHandle: string;
		targetHandle: string;
		label: string;
		path: string;
		labelX: number;
		labelY: number;
	}[];
}

export function workflowLayout(model: WorkflowGraph, direction: LayoutDirection) {
	let layouts = graphs.get(model);
	if (!layouts) {
		layouts = new Map();
		graphs.set(model, layouts);
	}
	if (!layouts.has(direction)) {
		layouts.set(direction, layoutWorkflow(model, direction));
	}
	return layouts.get(direction)!;
}

// eslint-disable-next-line max-statements -- Translate nested ELK coordinates and routed edges together.
async function layoutWorkflow(
	model: WorkflowGraph,
	direction: LayoutDirection,
): Promise<WorkflowLayout> {
	const stepIds = Object.keys(model.steps);
	const { transitions } = model;
	const transitionEdges = stepIds.flatMap((source) =>
		transitions[source]!.map((event) => ({
			id: event.id,
			source,
			target: event.target,
			sourceHandle: `${event.id}:out`,
			targetHandle: `${event.id}:in`,
			label: event.label,
		})),
	);
	const children = (parent: string | null): ElkNode[] =>
		stepIds
			.filter((id) => model.steps[id]!.parent === parent)
			.map((id) => ({
				id,
				...nodeGeometry(children(id), model.steps[id]!, direction),
				ports: transitionEdges.flatMap((edge) => [
					...(edge.source === id ? [port(edge.sourceHandle)] : []),
					...(edge.target === id ? [port(edge.targetHandle)] : []),
				]),
			}));
	const graph: ElkNode = {
		id: "workflow-canvas",
		layoutOptions: { "elk.direction": direction, "elk.hierarchyHandling": "INCLUDE_CHILDREN" },
		children: children(null),
		edges: transitionEdges.map((edge) => ({
			id: edge.id,
			sources: [edge.sourceHandle],
			targets: [edge.targetHandle],
			labels: [
				{
					text: edge.label,
					width:
						edge.label.length * canvasSettings.labelCharacterWidth + canvasSettings.labelPadding,
					height: canvasSettings.labelHeight,
				},
			],
		})),
	};
	const layout = await elk.layout(graph);
	const nodes: WorkflowLayout["nodes"] = [];
	const offsets = new Map<string, { x: number; y: number }>([[graph.id, { x: 0, y: 0 }]]);
	const routed = new Map<string, ElkExtendedEdge>();
	const visit = (container: ElkNode) => {
		const offset = offsets.get(container.id)!;
		for (const edge of container.edges ?? []) {
			routed.set(edge.id, edge);
		}
		for (const node of container.children ?? []) {
			offsets.set(node.id, { x: offset.x + node.x!, y: offset.y + node.y! });
			nodes.push({
				id: node.id,
				parent: container === layout ? null : container.id,
				position: { x: node.x!, y: node.y! },
				width: node.width!,
				height: node.height!,
				ports: node.ports!.map((endpoint) => ({
					id: endpoint.id,
					type: endpoint.id.endsWith(":out") ? "source" : "target",
					side: portSide(endpoint, node),
					x: endpoint.x!,
					y: endpoint.y!,
				})),
			});
			visit(node);
		}
	};
	visit(layout);
	return {
		nodes,
		edges: transitionEdges.map((edge) => {
			const route = routed.get(edge.id)!;
			const offset = offsets.get(route.container!)!;
			const label = route.labels![0]!;
			return {
				...edge,
				path: route
					.sections!.map((section) =>
						[section.startPoint, ...(section.bendPoints ?? []), section.endPoint]
							.map(
								(point, index) =>
									`${index === 0 ? "M" : "L"} ${point.x + offset.x} ${point.y + offset.y}`,
							)
							.join(" "),
					)
					.join(" "),
				labelX: label.x! + label.width! / HALF + offset.x,
				labelY: label.y! + label.height! / HALF + offset.y,
			};
		}),
	};
}

function nodeGeometry(
	children: ElkNode[],
	step: WorkflowGraph["steps"][string],
	direction: LayoutDirection,
) {
	const linksHeight = (step.workflows?.length ?? 0) * canvasSettings.workflowLinkHeight;
	if (children.length === 0) {
		return step.kind === "compound" || step.kind === "parallel"
			? {
					width: canvasSettings.scopeSize.width,
					height: canvasSettings.scopeSize.height + linksHeight,
				}
			: {
					width: canvasSettings.cardSize.width,
					height: canvasSettings.cardSize.height + linksHeight,
				};
	}
	const across: LayoutDirection = direction === "DOWN" ? "RIGHT" : "DOWN";
	return {
		children,
		layoutOptions: {
			"elk.padding": `[top=${canvasSettings.scopeSize.header + linksHeight},left=24,bottom=24,right=24]`,
			"elk.nodeSize.constraints": "MINIMUM_SIZE",
			"elk.nodeSize.minimum": "(320,140)",
			"elk.direction": step.kind === "parallel" ? across : direction,
		},
	};
}

function port(id: string): ElkPort {
	return { id, width: 0, height: 0 };
}

function portSide(endpoint: ElkPort, node: ElkNode): PortSide {
	if (endpoint.x === 0) {
		return "WEST";
	}
	if (endpoint.x === node.width) {
		return "EAST";
	}
	return endpoint.y === 0 ? "NORTH" : "SOUTH";
}
