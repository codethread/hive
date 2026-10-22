/* eslint-disable id-length -- React Flow and Dagre use x/y coordinates. */
/* The graph composes layout, themed cards, activity and its accessible help dialog. */
/* eslint-disable import/max-dependencies */
import {
	Background,
	Controls,
	Handle,
	MarkerType,
	Panel,
	Position,
	ReactFlow,
	getNodesBounds,
	useReactFlow,
} from "@xyflow/react";
import { Badge, Button, Card as SurfaceCard } from "./primitives.tsx";
import { BeeActivity, outcomeName } from "./ui.tsx";
import {
	Circle,
	CircleCheck,
	CircleSlash,
	CircleX,
	Info,
	Layers3,
	TriangleAlert,
	X,
} from "lucide-react";
import {
	Root as Dialog,
	Close as DialogClose,
	Content as DialogContent,
	Description as DialogDescription,
	Overlay as DialogOverlay,
	Portal as DialogPortal,
	Title as DialogTitle,
	Trigger as DialogTrigger,
} from "@radix-ui/react-dialog";
import type { Edge, Node, NodeProps, Rect } from "@xyflow/react";
import type { GraphLabel, NodeLabel } from "@dagrejs/dagre";
import { graphlib, layout as runLayout } from "@dagrejs/dagre";
import { useEffect, useMemo } from "react";
import type { Bee } from "../contracts.ts";
import type { GraphProps } from "./graph-loader.ts";
import { beeActivity } from "./activity.ts";
import { useActivityClock } from "./activity-clock.tsx";

const CARD = { width: 292, height: 172 };
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
					? {
							...node,
							data: {
								...node.data,
								chosen: node.data.bee.id === selected,
								onSelect,
							},
						}
					: node,
			),
		[graph.nodes, selected, onSelect],
	);
	return (
		<div className="bee-graph" data-theme={theme}>
			<div className="bee-graph-canvas">
				<ReactFlow<GraphNode>
					nodes={nodes}
					edges={graph.edges}
					nodeTypes={NODE_TYPES}
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
					<FitGraph bounds={getNodesBounds(graph.nodes)} />
					<Background gap={GRID_GAP} size={1} color="var(--line)" />
					<Controls showInteractive={false} fitViewOptions={FIT} />
					<Panel position="top-right" className="bee-graph-toolbar">
						<span>
							{scene.requests.length} {scene.requests.length === 1 ? "request" : "requests"}
							{scene.contextIds.size > 0 && ` · ${scene.contextIds.size} from ancestry`}
						</span>
						<GraphInfo theme={theme} />
					</Panel>
				</ReactFlow>
			</div>
		</div>
	);
}

// --- HTML nodes and deterministic layout of the supplied evidence ---

function FitGraph({ bounds: { x, y, width, height } }: { bounds: Rect }) {
	const { fitBounds, viewportInitialized } = useReactFlow();
	useEffect(() => {
		if (viewportInitialized) {
			void fitBounds({ x, y, width, height }, FIT);
		}
	}, [viewportInitialized, fitBounds, x, y, width, height]);
	return null;
}

function GraphInfo({ theme }: Pick<GraphProps, "theme">) {
	return (
		<Dialog>
			<DialogTrigger asChild>
				<Button variant="ghost" size="icon" aria-label="About this graph" title="About this graph">
					<Info aria-hidden="true" />
				</Button>
			</DialogTrigger>
			<DialogPortal>
				<DialogOverlay className="fixed inset-0 z-50 bg-black/50" />
				<DialogContent
					data-theme={theme}
					className={`fixed top-1/2 left-1/2 z-50 max-h-[85dvh] w-[calc(100%-2rem)] max-w-md
							-translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-line
							bg-panel p-5 text-sm text-ink shadow-xl`}
				>
					<header className="flex items-center justify-between gap-4">
						<DialogTitle className="font-semibold">About this graph</DialogTitle>
						<DialogClose asChild>
							<Button variant="ghost" size="icon" aria-label="Close graph information">
								<X aria-hidden="true" />
							</Button>
						</DialogClose>
					</header>
					<DialogDescription className="text-xs text-muted">
						Connections, activity and navigation.
					</DialogDescription>
					<dl className="mt-5 space-y-4 text-xs">
						<div>
							<dt className="bee-graph-legend font-medium">
								<i aria-hidden="true" /> Recorded requester
							</dt>
							<dd className="mt-1 text-muted">A solid line shows who requested the bee.</dd>
						</div>
						<div>
							<dt className="bee-graph-legend font-medium">
								<i aria-hidden="true" className="inferred" /> Inferred parent
							</dt>
							<dd className="mt-1 text-muted">
								A dashed line links a requester name to a historical bee request. Cards marked “From
								ancestry” were added when ancestry was loaded.
							</dd>
						</div>
						<div>
							<dt className="flex items-center gap-2 font-medium text-active">
								<span aria-hidden="true">🐝</span> Active bee
							</dt>
							<dd className="mt-1 text-muted">
								Orange means recorded output in the last 2 minutes. “Open” means the request hasn’t
								finished; assignment alone does not establish activity.
							</dd>
						</div>
						<div>
							<dt className="flex items-center gap-2 font-medium text-attention">
								<TriangleAlert aria-hidden="true" className="size-4" /> Investigate
							</dt>
							<dd className="mt-1 text-muted">
								Red means an unresolved failure or 10+ minutes without output on an open request.
								Silence is a reason to check, not proof the bee is stalled.
							</dd>
						</div>
						<div>
							<dt className="font-medium">Quiet or unknown</dt>
							<dd className="mt-1 text-muted">
								2–10 minutes without output stays neutral. Activity is unknown when no output
								timestamp is available. Refresh the workspace to load new evidence.
							</dd>
						</div>
					</dl>
					<p className="mt-5 border-t border-line pt-4 text-xs text-muted">
						Drag to pan · Scroll or use +/− to zoom · Fit to show all nodes · Tab then Enter to
						select a card
					</p>
				</DialogContent>
			</DialogPortal>
		</Dialog>
	);
}

function RequestCard({ data }: NodeProps<RequestNode>) {
	const { bee, context, chosen, onSelect } = data;
	const now = useActivityClock();
	const activity = beeActivity(bee, now);
	const OutcomeIcon = {
		pending: Circle,
		succeeded: CircleCheck,
		cancelled: CircleSlash,
		failed: CircleX,
	}[bee.outcome];
	return (
		<SurfaceCard
			data-activity={activity}
			data-attention={bee.needsAttention}
			className={`bee-graph-card${context ? " context" : ""}${chosen ? " chosen" : ""}`}
		>
			<Handle type="target" position={Position.Left} />
			<Button
				variant="ghost"
				type="button"
				className="nodrag nopan"
				aria-pressed={chosen}
				onClick={() => {
					onSelect(bee.id);
				}}
			>
				<span className="bee-graph-card-top">
					<span>{bee.kind}</span>
					<Badge
						variant="secondary"
						className={`bee-graph-outcome ${bee.outcome}`}
						data-attention={bee.needsAttention}
						title={
							bee.outcome === "pending"
								? "Request has not finished. It may be waiting, running or retrying; bee activity is shown separately."
								: undefined
						}
					>
						<OutcomeIcon aria-hidden="true" />
						{outcomeName(bee.outcome)}
					</Badge>
				</span>
				<strong title={bee.identity}>{bee.identity}</strong>
				<span className="bee-graph-request-id" title={bee.id}>
					{bee.id}
				</span>
				<span className="bee-graph-activity">
					<BeeActivity bee={bee} />
				</span>
				<span className="bee-graph-card-bottom">
					<span className="inline-flex items-center gap-1">
						<Layers3 aria-hidden="true" className="size-3" />
						{bee.taskIds.length} linked {bee.taskIds.length === 1 ? "bead" : "beads"}
					</span>
					{context && <span>From ancestry</span>}
				</span>
			</Button>
			<Handle type="source" position={Position.Right} />
		</SurfaceCard>
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
			data: {
				bee,
				context: scene.contextIds.has(bee.id),
				chosen: false,
				onSelect,
			},
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
