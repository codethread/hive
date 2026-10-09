/* eslint-disable id-length -- React Flow and Dagre use x/y coordinates. */
import { Background, Controls, Handle, MarkerType, Position, ReactFlow } from "@xyflow/react";
import type { Edge, Node, NodeProps } from "@xyflow/react";
import type { GraphLabel, NodeLabel } from "@dagrejs/dagre";
import { graphlib, layout as runLayout } from "@dagrejs/dagre";
import type { Bee } from "../contracts.ts";
import type { GraphProps } from "./graph-loader.ts";
import { useMemo } from "react";

const CARD = { width: 272, height: 136 };
const ACTOR = { width: 184, height: 58 };
const HALF = 2;
const FIT = { padding: 0.16, maxZoom: 1 };
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 1.6;
const GRID_GAP = 24;
const NODE_TYPES = { request: RequestCard, actor: ActorPill };

type RequestNode = Node<
	{
		bee: Bee;
		context: boolean;
		chosen: boolean;
		onSelect: GraphProps["onSelect"];
	},
	"request"
>;
type ActorNode = Node<{ identity: string }, "actor">;
type GraphNode = RequestNode | ActorNode;

/** React Flow owns only the viewport; loaded evidence and URL selection remain outside it. */
export function BeeGraph({ scene, selected, onSelect, theme }: GraphProps) {
	const graph = useMemo(() => graphLayout(scene, onSelect), [scene, onSelect]);
	const nodes = useMemo(
		() =>
			graph.nodes.map((node): GraphNode =>
				node.type === "request"
					? { ...node, data: { ...node.data, chosen: node.data.bee.id === selected, onSelect } }
					: node,
			),
		[graph.nodes, selected, onSelect],
	);
	return (
		<div className="bee-graph" data-theme={theme}>
			<div className="bee-graph-toolbar">
				<div className="bee-graph-legend">
					<span>
						<i />
						Recorded requester
					</span>
					<span>
						<i className="inferred" />
						Inferred parent
					</span>
				</div>
				<span>
					{scene.matches.length} matches · {scene.contextIds.size} context
				</span>
			</div>
			<div className="bee-graph-canvas">
				<ReactFlow<GraphNode>
					nodes={nodes}
					edges={graph.edges}
					nodeTypes={NODE_TYPES}
					fitView
					fitViewOptions={FIT}
					minZoom={MIN_ZOOM}
					maxZoom={MAX_ZOOM}
					nodesDraggable={false}
					nodesConnectable={false}
					nodesFocusable={false}
					edgesFocusable={false}
					elementsSelectable={false}
					deleteKeyCode={null}
					colorMode={theme === "moss" ? "dark" : "light"}
					aria-label="Bee provenance graph"
				>
					<Background gap={GRID_GAP} size={1} color="var(--line)" />
					<Controls showInteractive={false} fitViewOptions={FIT} />
				</ReactFlow>
			</div>
			<div className="bee-graph-help">
				Drag canvas to pan · scroll to zoom · Tab then Enter to select a request
			</div>
		</div>
	);
}

// --- HTML nodes and deterministic layout of the supplied evidence ---

function RequestCard({ data }: NodeProps<RequestNode>) {
	const { bee, context, chosen, onSelect } = data;
	return (
		<div className={`bee-graph-card${context ? " context" : ""}${chosen ? " chosen" : ""}`}>
			<Handle type="target" position={Position.Left} />
			<button
				type="button"
				className="nodrag nopan"
				aria-pressed={chosen}
				onClick={() => {
					onSelect(bee.id);
				}}
			>
				<span className="bee-graph-card-top">
					<span>{bee.kind}</span>
					<span className={`bee-graph-outcome ${bee.outcome}`}>{bee.outcome}</span>
				</span>
				<strong title={bee.identity}>{bee.identity}</strong>
				<span className="bee-graph-request-id" title={bee.id}>
					{bee.id}
				</span>
				<span className="bee-graph-card-bottom">
					<span>
						{bee.taskIds.length} linked {bee.taskIds.length === 1 ? "bead" : "beads"}
					</span>
					<span>{context ? "Context" : "Match"}</span>
				</span>
			</button>
			<Handle type="source" position={Position.Right} />
		</div>
	);
}

function ActorPill({ data }: NodeProps<ActorNode>) {
	return (
		<div className="bee-graph-actor">
			<strong title={data.identity}>{data.identity}</strong>
			<span>recorded requester</span>
			<Handle type="source" position={Position.Right} />
		</div>
	);
}

// eslint-disable-next-line max-statements -- Translate one evidence snapshot without introducing a second domain model.
function graphLayout(
	scene: GraphProps["scene"],
	onSelect: GraphProps["onSelect"],
): { nodes: GraphNode[]; edges: Edge[] } {
	const nodes: GraphNode[] = [];
	const edges: Edge[] = [];
	const actors = new Set<string>();
	const inferredChildren = new Set(scene.inferred.map((edge) => edge.child));
	for (const bee of scene.requests) {
		const id = `request:${bee.id}`;
		nodes.push({
			id,
			type: "request",
			position: { x: 0, y: 0 },
			...CARD,
			data: { bee, context: scene.contextIds.has(bee.id), chosen: false, onSelect },
		});
		if (bee.requester !== null && !inferredChildren.has(bee.id)) {
			const source = `actor:${bee.requester}`;
			if (!actors.has(source)) {
				actors.add(source);
				nodes.push({
					id: source,
					type: "actor",
					position: { x: 0, y: 0 },
					...ACTOR,
					data: { identity: bee.requester },
				});
			}
			edges.push(graphEdge(`recorded:${bee.id}`, source, id, false));
		}
	}
	for (const edge of scene.inferred) {
		edges.push(
			graphEdge(
				`inferred:${edge.parent}:${edge.child}`,
				`request:${edge.parent}`,
				`request:${edge.child}`,
				true,
			),
		);
	}
	const layout = new graphlib.Graph<GraphLabel, NodeLabel>().setDefaultEdgeLabel(() => ({}));
	layout.setGraph({ rankdir: "LR", nodesep: 28, ranksep: 68, marginx: 24, marginy: 24 });
	for (const node of nodes) {
		layout.setNode(node.id, { ...(node.type === "request" ? CARD : ACTOR) });
	}
	for (const edge of edges) {
		layout.setEdge(edge.source, edge.target);
	}
	runLayout(layout);
	return {
		nodes: nodes.map((node) => {
			const position = layout.node(node.id);
			const size = node.type === "request" ? CARD : ACTOR;
			node.position = { x: position.x! - size.width / HALF, y: position.y! - size.height / HALF };
			return node;
		}),
		edges,
	};
}

// eslint-disable-next-line max-params -- Edge identity, endpoints and evidence style are explicit rendering inputs.
function graphEdge(id: string, source: string, target: string, inferred: boolean): Edge {
	const color = inferred ? "var(--accent)" : "var(--muted)";
	return {
		id,
		source,
		target,
		type: "smoothstep",
		selectable: false,
		ariaLabel: inferred ? "Inferred parent" : "Recorded requester",
		style: { stroke: color, strokeWidth: 1.7, strokeDasharray: inferred ? "6 4" : undefined },
		markerEnd: { type: MarkerType.ArrowClosed, color, width: 18, height: 18 },
	};
}
