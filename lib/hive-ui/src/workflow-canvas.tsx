/* eslint-disable id-length -- React Flow and SVG use x/y coordinates. */
/* eslint-disable oxc/no-map-spread -- React Flow models compose immutable node and edge data. */
/* eslint-disable jsx-a11y/prefer-tag-over-role -- Inline SVG illustrations need an accessible image role. */
import { ArrowUpRight, ChevronRight, Workflow } from "lucide-react";
import {
	Background,
	BaseEdge,
	Controls,
	Handle,
	Panel,
	Position,
	ReactFlow,
	useStore as useFlowStore,
	useReactFlow,
} from "@xyflow/react";
import type { Edge, EdgeProps, Node, NodeProps } from "@xyflow/react";
import type { LayoutDirection, WorkflowPort } from "./workflow-explorer-layout.ts";
import { Suspense, use, useEffect, useId, useMemo, useState } from "react";
import { canvasSettings, workflowLayout } from "./workflow-explorer-layout.ts";
import { workflowScope, workflowScopePath, workflowScopeSummary } from "./workflow-graph.ts";
import type { ReactNode } from "react";
import type { WorkflowBeeStatus } from "./workflow-bee-status.tsx";
import { WorkflowBeeStatusBadge } from "./workflow-bee-status.tsx";
import type { WorkflowGraph } from "./workflow-graph.ts";
import type { WorkflowInspection } from "../contracts.ts";

const LAST = -1;
const NODE_TYPES = { step: StepNode, scope: ScopeNode };
const EDGE_TYPES = { routed: RoutedEdge };
const ZOOM_MODES = ["step", "workflow", "choices"] as const;
const EDGE_LAYERS = { default: 0, current: 1, hovered: 2 };
const PORT_POSITIONS = {
	NORTH: Position.Top,
	EAST: Position.Right,
	SOUTH: Position.Bottom,
	WEST: Position.Left,
};

export type StepGraphNode = Node<
	{
		id: string;
		title: string;
		kind: string;
		bee: string | null;
		beeStatus?: WorkflowBeeStatus;
		childWorkflows?: ChildWorkflowLinksProps | undefined;
		status: StepStatus;
		availableLabel: string;
		hovered: boolean;
		chosen: boolean;
		initial: boolean;
		ports: WorkflowPort[];
		direction: LayoutDirection;
		onInspect?: (id: string) => void;
		onPreview?: (id: string | null) => void;
	},
	"step"
>;
type ScopeGraphNode = Node<
	StepGraphNode["data"] & {
		onInspect: (id: string) => void;
		collapsed: boolean;
		focused: boolean;
		summary: string;
		onToggle: (id: string) => void;
		onFocus: (id: string) => void;
	},
	"scope"
>;
type CanvasNode = StepGraphNode | ScopeGraphNode;
export type RoutedGraphEdge = Edge<
	{ path: string; labelX: number; labelY: number; target: string },
	"routed"
>;
export type StepStatus = "current" | "available" | "default";
interface StepSelection {
	step: string;
}
type ZoomMode = (typeof ZOOM_MODES)[number];
interface ScopeNavigation {
	structure: string;
	focus: string | null;
	collapsed: Set<string>;
}
interface ChildWorkflow {
	id: string;
	title: string;
	status: WorkflowInspection["actors"][number]["snapshot"]["status"];
}
interface WorkflowNavigation {
	path: ChildWorkflow[];
	children: ChildWorkflow[];
	disabled: boolean;
	onOpen: (id: string) => void;
}
interface ChildWorkflowLinksProps {
	workflows: ChildWorkflow[];
	disabled: boolean;
	onOpen: (id: string) => void;
}

// eslint-disable-next-line max-statements -- Keep scope navigation and collapse state beside their canvas controls.
export function WorkflowCanvas({
	identity,
	graph,
	available,
	availableLabel,
	current,
	focusSelection,
	selected,
	theme,
	onInspect,
	toolbar,
	workflowNavigation,
}: {
	identity: string;
	graph: WorkflowGraph;
	available: string[];
	availableLabel: string;
	current: string[];
	focusSelection: StepSelection | null;
	selected: string;
	theme: "light" | "dark";
	onInspect: (id: string) => void;
	toolbar?: ReactNode;
	workflowNavigation?: WorkflowNavigation | undefined;
}) {
	const [direction, setDirection] = useState<LayoutDirection>(canvasSettings.initialDirection);
	const [zoomMode, setZoomMode] = useState<ZoomMode>(
		Object.values(graph.steps).some((step) => step.children.length > 0) ? "workflow" : "step",
	);
	const structure = JSON.stringify([
		identity,
		Object.entries(graph.steps).map(([id, step]) => [id, step.parent, step.children]),
	]);
	const initialNavigation = useMemo<ScopeNavigation>(
		() => ({ structure, focus: null, collapsed: new Set() }),
		[structure],
	);
	const [navigationByWorkflow, setNavigationByWorkflow] = useState<Record<string, ScopeNavigation>>(
		{},
	);
	const retained = navigationByWorkflow[identity];
	const navigation = retained?.structure === structure ? retained : initialNavigation;
	const setNavigation = (update: (previous: ScopeNavigation) => ScopeNavigation) => {
		setNavigationByWorkflow((previous) => ({
			...previous,
			[identity]: update(
				previous[identity]?.structure === structure ? previous[identity] : initialNavigation,
			),
		}));
	};
	const { focus, collapsed } = navigation;
	const view = useMemo(() => workflowScope(graph, focus, collapsed), [graph, focus, collapsed]);
	const scopeIds = Object.keys(workflowScope(graph, focus, new Set()).steps);
	const hasScopes = Object.values(graph.steps).some((step) => step.children.length > 0);
	const open = (id: string | null) => {
		setNavigation((previous) => {
			const next = new Set(previous.collapsed);
			if (id !== null) {
				next.delete(id);
			}
			return { ...previous, focus: id, collapsed: next };
		});
		setZoomMode("workflow");
	};
	const toggle = (id: string) => {
		setNavigation((previous) => {
			const next = new Set(previous.collapsed);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return { ...previous, collapsed: next };
		});
	};
	const reveal = () => {
		setNavigation((previous) => {
			const next = new Set(previous.collapsed);
			for (const id of workflowScopePath(graph, selected)) {
				next.delete(id);
			}
			return { ...previous, focus: null, collapsed: next };
		});
		setZoomMode("step");
	};
	const hiddenEdges =
		Object.values(graph.transitions).flat().length - Object.values(view.transitions).flat().length;
	const linked = new Set(Object.values(graph.steps).flatMap((step) => step.workflows ?? []));
	const unlinked = workflowNavigation?.children.filter(({ id }) => !linked.has(id)) ?? [];
	return (
		<>
			<div className="explorer-graph-toolbar">
				{toolbar}
				<fieldset className="explorer-layout-options board-tabs" aria-label="Layout direction">
					<button
						type="button"
						className="board-tab"
						aria-pressed={direction === "DOWN"}
						onClick={() => {
							setDirection("DOWN");
						}}
					>
						↓ Vertical
					</button>
					<button
						type="button"
						className="board-tab"
						aria-pressed={direction === "RIGHT"}
						onClick={() => {
							setDirection("RIGHT");
						}}
					>
						→ Horizontal
					</button>
				</fieldset>
				<label className="explorer-zoom-picker">
					Zoom
					<select
						value={zoomMode}
						onChange={(event) => {
							setZoomMode(ZOOM_MODES.find((mode) => mode === event.target.value)!);
						}}
					>
						<option value="step">Step</option>
						<option value="workflow">Full view</option>
						<option value="choices">Choices</option>
					</select>
				</label>
				{hasScopes && (
					<>
						<button
							className="button"
							onClick={() => {
								setNavigation((previous) => {
									const next = new Set(previous.collapsed);
									for (const id of scopeIds) {
										if (graph.steps[id]!.children.length > 0) {
											next.add(id);
										}
									}
									for (const [id, step] of Object.entries(view.steps)) {
										if (step.parent === null) {
											next.delete(id);
										}
									}
									return { ...previous, collapsed: next };
								});
							}}
						>
							Collapse all
						</button>
						<button
							className="button"
							onClick={() => {
								setNavigation((previous) => {
									const next = new Set(previous.collapsed);
									for (const id of scopeIds) {
										next.delete(id);
									}
									return { ...previous, collapsed: next };
								});
							}}
						>
							Expand all
						</button>
					</>
				)}
			</div>
			{(hasScopes || (workflowNavigation?.path.length ?? 0) > 1 || unlinked.length > 0) && (
				<nav className="explorer-scope-breadcrumbs" aria-label="State scope">
					<Workflow size={16} aria-hidden="true" />
					{(workflowNavigation?.path ?? [{ id: identity, title: "Workflow" }]).map(
						(entry, index, path) => (
							<span className="explorer-breadcrumb" key={entry.id}>
								{index > 0 && <ChevronRight size={14} aria-hidden="true" />}
								<button
									aria-current={index === path.length - 1 && focus === null ? "page" : undefined}
									disabled={workflowNavigation?.disabled === true && index !== path.length - 1}
									title={
										workflowNavigation?.disabled === true && index !== path.length - 1
											? "Choose Saved to navigate workflows"
											: undefined
									}
									onClick={() => {
										if (index === path.length - 1) {
											open(null);
										} else {
											workflowNavigation!.onOpen(entry.id);
										}
									}}
								>
									{entry.title}
								</button>
							</span>
						),
					)}
					{focus !== null &&
						workflowScopePath(graph, focus).map((id) => (
							<span className="explorer-breadcrumb" key={id}>
								<ChevronRight size={14} aria-hidden="true" />
								<button
									aria-current={id === focus ? "page" : undefined}
									onClick={() => {
										open(id);
									}}
								>
									{graph.steps[id]!.title.split(" / ").at(LAST)}
								</button>
							</span>
						))}
					{unlinked.length > 0 && (
						<div className="explorer-child-workflows">
							<span>Child workflows</span>
							<ChildWorkflowLinks
								navigation={{
									workflows: unlinked,
									onOpen: workflowNavigation!.onOpen,
									disabled: workflowNavigation!.disabled,
								}}
							/>
						</div>
					)}
					{hiddenEdges > 0 && <small>{hiddenEdges} transitions outside this view</small>}
				</nav>
			)}
			<Suspense fallback={null}>
				<RoutedWorkflowCanvas
					graph={view}
					sourceGraph={graph}
					collapsed={collapsed}
					focus={focus}
					onFocus={open}
					onToggle={toggle}
					onReveal={reveal}
					key={direction}
					available={available}
					availableLabel={availableLabel}
					direction={direction}
					current={current}
					focusSelection={focusSelection}
					selected={selected}
					zoomMode={zoomMode}
					onZoomModeChange={setZoomMode}
					theme={theme}
					onInspect={onInspect}
					workflowNavigation={workflowNavigation}
				/>
			</Suspense>
		</>
	);
}

function RoutedWorkflowCanvas({
	graph,
	sourceGraph,
	collapsed,
	focus,
	onFocus,
	onToggle,
	onReveal,
	available,
	availableLabel,
	direction,
	current,
	focusSelection,
	selected,
	zoomMode,
	onZoomModeChange,
	theme,
	onInspect,
	workflowNavigation,
}: {
	graph: WorkflowGraph;
	sourceGraph: WorkflowGraph;
	collapsed: ReadonlySet<string>;
	focus: string | null;
	onFocus: (id: string) => void;
	onToggle: (id: string) => void;
	onReveal: () => void;
	available: string[];
	availableLabel: string;
	direction: LayoutDirection;
	current: string[];
	focusSelection: StepSelection | null;
	selected: string;
	zoomMode: ZoomMode;
	onZoomModeChange: (mode: ZoomMode) => void;
	theme: "light" | "dark";
	onInspect: (id: string) => void;
	workflowNavigation?: WorkflowNavigation | undefined;
}) {
	const layout = use(workflowLayout(graph, direction));
	const { steps } = graph;
	const [hovered, setHovered] = useState<string | null>(null);
	const nodes: CanvasNode[] = layout.nodes.map((node) => ({
		id: node.id,
		type:
			steps[node.id]!.kind === "compound" || steps[node.id]!.kind === "parallel" ? "scope" : "step",
		position: node.position,
		...(node.parent === null ? {} : { parentId: node.parent }),
		width: node.width,
		height: node.height,
		style: { width: node.width, height: node.height },
		measured: { width: node.width, height: node.height },
		handles: node.ports.map((port) => ({
			...port,
			width: 0,
			height: 0,
			position: PORT_POSITIONS[port.side],
		})),
		data: {
			id: node.id,
			collapsed: collapsed.has(node.id),
			focused: node.id === focus,
			summary: workflowScopeSummary(sourceGraph, node.id, current),
			onFocus,
			onToggle,
			status: stepStatus(node.id, current, available),
			availableLabel,
			hovered: node.id === hovered,
			chosen: node.id === selected,
			initial: graph.initial.includes(node.id),
			title: steps[node.id]!.title,
			kind: steps[node.id]!.kind,
			bee: steps[node.id]!.bee ?? null,
			childWorkflows:
				workflowNavigation === undefined || steps[node.id]!.workflows === undefined
					? undefined
					: {
							workflows: steps[node.id]!.workflows!.map((id) =>
								workflowNavigation.children.find((child) => child.id === id)!,
							),
							onOpen: workflowNavigation.onOpen,
							disabled: workflowNavigation.disabled,
						},
			ports: node.ports,
			direction,
			onInspect,
			onPreview: setHovered,
		},
	}));
	const edges: RoutedGraphEdge[] = layout.edges.map((edge) => ({
		id: edge.id,
		source: edge.source,
		target: edge.target,
		sourceHandle: edge.sourceHandle,
		targetHandle: edge.targetHandle,
		label: edge.label,
		type: "routed",
		...edgeAppearance(edge, current, hovered),
		focusable: true,
		ariaRole: "button",
		ariaLabel: `Inspect ${steps[edge.target]!.title} via ${edge.label} from ${steps[edge.source]!.title}`,
		domAttributes: {
			onKeyDown: (event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					onInspect(edge.target);
				}
			},
		},
		data: {
			path: edge.path,
			labelX: edge.labelX,
			labelY: edge.labelY,
			target: edge.target,
		},
	}));
	return (
		<ReactFlow<CanvasNode, RoutedGraphEdge>
			nodes={nodes}
			edges={edges}
			nodeTypes={NODE_TYPES}
			edgeTypes={EDGE_TYPES}
			onEdgeClick={(_event, edge) => {
				onInspect(edge.data!.target);
			}}
			minZoom={canvasSettings.minZoom}
			maxZoom={canvasSettings.maxZoom}
			nodesDraggable={false}
			nodesConnectable={false}
			nodesFocusable={false}
			edgesFocusable={false}
			elementsSelectable={false}
			deleteKeyCode={null}
			colorMode={theme}
			aria-label="Workflow diagram"
		>
			<Background
				gap={canvasSettings.gridGap}
				size={canvasSettings.gridDotSize}
				color="var(--explorer-grid)"
			/>
			<WorkflowZoomControls
				graph={graph}
				sourceGraph={sourceGraph}
				onReveal={onReveal}
				selected={selected}
				focusSelection={focusSelection}
				zoomMode={zoomMode}
				onZoomModeChange={onZoomModeChange}
			/>
		</ReactFlow>
	);
}

export function StepNode({ data }: Pick<NodeProps<StepGraphNode>, "data">) {
	const kind = data.childWorkflows === undefined ? data.kind : "workflow";
	const Inspect = data.onInspect === undefined ? "div" : "button";
	return (
		<div
			className="explorer-step"
			data-direction={data.direction}
			data-bee={data.bee !== null}
			data-bee-status={data.beeStatus}
			data-status={data.status}
			data-hovered={data.hovered}
		>
			{data.initial && (
				<svg
					className="explorer-initial-marker"
					viewBox="0 0 44 48"
					role="img"
					aria-label="Initial state"
				>
					<title>Initial state</title>
					<circle cx="10" cy="10" r="9" fill="currentColor" />
					<path
						d="M 12 23 C 12 34 21 34 33 34"
						fill="none"
						stroke="currentColor"
						strokeWidth="4"
						strokeLinecap="round"
					/>
					<path d="M 30 26 L 44 34 L 30 42 Z" fill="currentColor" />
				</svg>
			)}
			{data.ports.map((port) => (
				<Handle
					key={port.id}
					id={port.id}
					type={port.type}
					position={PORT_POSITIONS[port.side]}
					style={{ left: port.x, top: port.y, transform: "translate(-50%, -50%)" }}
				/>
			))}
			<Inspect
				type={data.onInspect === undefined ? undefined : "button"}
				className="explorer-step-inspect nodrag nopan"
				aria-label={data.onInspect === undefined ? undefined : `Inspect ${data.title}`}
				aria-pressed={data.onInspect === undefined ? undefined : data.chosen}
				onPointerEnter={() => {
					data.onPreview?.(data.id);
				}}
				onPointerLeave={() => {
					data.onPreview?.(null);
				}}
				onFocus={() => {
					data.onPreview?.(data.id);
				}}
				onBlur={() => {
					data.onPreview?.(null);
				}}
				onClick={() => {
					data.onInspect?.(data.id);
				}}
			>
				<span className="explorer-step-meta">
					<span className={data.bee === null ? undefined : "explorer-step-bee"}>
						{data.bee === null ? (
							kind
						) : (
							<>
								<span aria-hidden="true">🐝</span> {data.bee}
							</>
						)}
					</span>
					{data.status !== "default" && (
						<span>{data.status === "current" ? "Current" : data.availableLabel}</span>
					)}
				</span>
				<span className="explorer-step-heading">
					<strong className="text-base font-semibold">{data.title.split(" / ").at(LAST)}</strong>
					{data.beeStatus !== undefined && <WorkflowBeeStatusBadge status={data.beeStatus} />}
				</span>
			</Inspect>
			{data.childWorkflows !== undefined && <ChildWorkflowLinks navigation={data.childWorkflows} />}
		</div>
	);
}

export function ScopeNode({ data }: Pick<NodeProps<ScopeGraphNode>, "data">) {
	return (
		<section
			className="explorer-scope"
			data-kind={data.kind}
			data-bee={data.bee !== null}
			data-selected={data.chosen}
			data-status={data.status}
		>
			{data.ports.map((port) => (
				<Handle
					key={port.id}
					id={port.id}
					type={port.type}
					position={PORT_POSITIONS[port.side]}
					style={{ left: port.x, top: port.y, transform: "translate(-50%, -50%)" }}
				/>
			))}
			<header className="explorer-scope-header">
				<button
					className="explorer-scope-name nodrag nopan"
					aria-label={`Inspect ${data.title}`}
					aria-pressed={data.chosen}
					onClick={() => {
						data.onInspect(data.id);
					}}
				>
					<small>
						{data.bee !== null && <span className="explorer-step-bee">🐝 {data.bee} · </span>}
						{data.kind === "parallel" ? "Parallel · all branches" : "Compound · one child current"}
					</small>
					<span className="explorer-scope-heading">
						<strong>{data.title.split(" / ").at(LAST)}</strong>
						{data.status !== "default" && (
							<span className="explorer-scope-position">
								{data.status === "current" ? "Current" : data.availableLabel}
							</span>
						)}
					</span>
				</button>
				<div className="explorer-scope-actions">
					{!data.focused && (
						<button
							className="nodrag nopan"
							aria-label={`Focus ${data.title}`}
							title={`Focus ${data.title}`}
							onClick={() => {
								data.onFocus(data.id);
							}}
						>
							<ArrowUpRight size={16} aria-hidden="true" />
						</button>
					)}
					<button
						className="nodrag nopan"
						aria-label={`${data.collapsed ? "Expand" : "Collapse"} ${data.title}`}
						aria-expanded={!data.collapsed}
						onClick={() => {
							data.onToggle(data.id);
						}}
					>
						{data.collapsed ? "+" : "−"}
					</button>
				</div>
			</header>
			{data.childWorkflows !== undefined && <ChildWorkflowLinks navigation={data.childWorkflows} />}
			{data.collapsed && <p className="explorer-scope-summary">{data.summary}</p>}
		</section>
	);
}

function ChildWorkflowLinks({ navigation }: { navigation: ChildWorkflowLinksProps }) {
	const { workflows, disabled, onOpen } = navigation;
	const statuses = { active: "Active", done: "Done", error: "Failed", stopped: "Stopped" };
	return (
		<div className="explorer-workflow-links">
			{workflows.map((workflow) => (
				<button
					key={workflow.id}
					className="explorer-workflow-link nodrag nopan"
					aria-label={`Open ${workflow.title} workflow`}
					disabled={disabled}
					title={
						disabled ? "Choose Saved to navigate workflows" : `Open ${workflow.title} workflow`
					}
					onClick={() => {
						onOpen(workflow.id);
					}}
				>
					<Workflow size={16} aria-hidden="true" />
					<span>{workflow.title}</span>
					<small>{statuses[workflow.status]}</small>
					<ArrowUpRight size={16} aria-hidden="true" />
				</button>
			))}
		</div>
	);
}

function RoutedEdge(props: EdgeProps<RoutedGraphEdge>) {
	const { path, labelX, labelY } = props.data!;
	return <WorkflowEdgePath path={path} labelX={labelX} labelY={labelY} label={props.label} />;
}

export function edgeAppearance(
	edge: { source: string; target: string },
	current: string[],
	hovered: string | null,
) {
	const currentRelation = edgeRelation(edge, current);
	const hoverRelation = hovered === null ? null : edgeRelation(edge, [hovered]);
	const relation = currentRelation ?? hoverRelation;
	const prefix = relation === null ? "" : `explorer-edge-${relation} `;
	if (hoverRelation !== null) {
		return { className: `${prefix}explorer-edge-hovered`, zIndex: EDGE_LAYERS.hovered };
	}
	if (currentRelation !== null) {
		return {
			className: `${prefix}explorer-edge-${hovered === null ? "normal" : "muted"}`,
			zIndex: EDGE_LAYERS.current,
		};
	}
	return {
		className: `explorer-edge-${hovered === null ? "normal" : "dimmed"}`,
		zIndex: EDGE_LAYERS.default,
	};
}

function edgeRelation(edge: { source: string; target: string }, active: string[]) {
	if (active.includes(edge.source)) {
		return "outgoing";
	}
	if (active.includes(edge.target)) {
		return "incoming";
	}
	return null;
}

export function stepStatus(id: string, current: string[], available: string[]): StepStatus {
	if (current.includes(id)) {
		return "current";
	}
	return available.includes(id) ? "available" : "default";
}

export function WorkflowEdgePath({
	path,
	labelX,
	labelY,
	label,
}: {
	path: string;
	labelX: number;
	labelY: number;
	label: ReactNode;
}) {
	const arrowId = useId();
	return (
		<>
			<defs>
				<marker
					id={arrowId}
					viewBox="0 0 10 10"
					markerWidth={canvasSettings.hoverArrowSize}
					markerHeight={canvasSettings.hoverArrowSize}
					refX="10"
					refY="5"
					orient="auto"
					markerUnits="userSpaceOnUse"
				>
					<path className="explorer-edge-arrow" d="M 0 0 L 10 5 L 0 10 Z" />
				</marker>
			</defs>
			<BaseEdge
				path={path}
				markerEnd={`url(#${arrowId})`}
				labelX={labelX}
				labelY={labelY}
				label={label}
				labelBgPadding={[
					canvasSettings.labelBgPadding.horizontal,
					canvasSettings.labelBgPadding.vertical,
				]}
				labelBgBorderRadius={canvasSettings.labelBgBorderRadius}
			/>
		</>
	);
}

function WorkflowZoomControls({
	graph,
	sourceGraph,
	selected,
	focusSelection,
	zoomMode,
	onZoomModeChange,
	onReveal,
}: {
	graph: WorkflowGraph;
	sourceGraph: WorkflowGraph;
	selected: string;
	focusSelection: StepSelection | null;
	zoomMode: ZoomMode;
	onZoomModeChange: (mode: ZoomMode) => void;
	onReveal: () => void;
}) {
	const { fitView, viewportInitialized } = useReactFlow<CanvasNode, RoutedGraphEdge>();
	const width = useFlowStore((state) => state.width);
	const height = useFlowStore((state) => state.height);
	useEffect(() => {
		if (!viewportInitialized || width === 0 || height === 0) {
			return;
		}
		const focusStep =
			workflowScopePath(sourceGraph, focusSelection?.step ?? selected)
				.toReversed()
				.find((id) => id in graph.steps) ?? Object.keys(graph.steps)[0]!;
		const ids = Object.keys(graph.steps);
		let visible = ids;
		if (zoomMode === "step") {
			visible = [focusStep];
		} else if (zoomMode === "choices") {
			visible = ids.filter(
				(id) =>
					id === focusStep ||
					graph.transitions[focusStep]!.some((edge) => edge.target === id) ||
					graph.transitions[id]!.some((edge) => edge.target === focusStep),
			);
		}
		void fitView({
			...canvasSettings.fitView,
			nodes: visible.map((id) => ({ id })),
			minZoom: canvasSettings.minZoom,
			maxZoom: canvasSettings.initialZoom,
			duration: canvasSettings.focusDuration,
		});
	}, [
		fitView,
		focusSelection,
		graph,
		sourceGraph,
		height,
		selected,
		viewportInitialized,
		width,
		zoomMode,
	]);
	return (
		<>
			<Controls
				showInteractive={false}
				fitViewOptions={canvasSettings.fitView}
				onFitView={() => {
					onZoomModeChange("workflow");
				}}
			/>
			<Panel position="bottom-right">
				<button type="button" className="explorer-focus-step button" onClick={onReveal}>
					Show selected step
				</button>
			</Panel>
		</>
	);
}
