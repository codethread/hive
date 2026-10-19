/* eslint-disable id-length -- React Flow and SVG use x/y coordinates. */
/* eslint-disable oxc/no-map-spread -- React Flow models compose immutable node and edge data. */
/* eslint-disable jsx-a11y/prefer-tag-over-role -- Inline SVG illustrations need an accessible image role. */
import type { LandVisit, SampleContext, StepId } from "./workflow-explorer-data.ts";
import type { Node, NodeProps } from "@xyflow/react";
import { Position, ReactFlow } from "@xyflow/react";
import type { RoutedGraphEdge, StepGraphNode } from "../workflow-canvas.tsx";
import {
	StepNode,
	WorkflowCanvas,
	WorkflowEdgePath,
	edgeAppearance,
	stepStatus,
} from "../workflow-canvas.tsx";
import {
	advance,
	availableOutcomes,
	exampleStep,
	exampleVisit,
	initialStep,
	landGraph,
	renderInstructions,
	sampleContext,
	stepIds,
	steps,
	transitionCount,
	transitions,
} from "./workflow-explorer-data.ts";
import { MarkdownContent } from "../markdown.tsx";
import type { ReactNode } from "react";
import type { WorkflowPort } from "../workflow-explorer-layout.ts";
import { WorkflowWorkspace } from "../workflow-workspace.tsx";
import { canvasSettings } from "../workflow-explorer-layout.ts";
import { preferences } from "../data.ts";
import { useState } from "react";
import { useStore } from "zustand";
import { z } from "zod";

const LAST_ENTRY = -1;
const EDGE_TYPES = { routed: VariantRoutedEdge };
const VARIANT_NODE_TYPES = { step: VariantStepNode };
const CARD_VARIANTS = [
	["Default step", "finish"],
	["Current step", "check"],
	["Bee task · available", "review"],
	["Integration verification", "verify"],
	["Final state", "done"],
] satisfies [string, StepId][];
const HOVER_CARD_VARIANTS = [
	["Default · hovered", "finish"],
	["Current · hovered", "check"],
	["Bee task · hovered", "review"],
] satisfies [string, StepId][];
const VARIANT_CONNECTIONS = [
	{ source: "finish", target: "verify", sourceSide: "NORTH", targetSide: "SOUTH" },
	{ source: "review", target: "finish", sourceSide: "EAST", targetSide: "WEST" },
	{ source: "check", target: "review", sourceSide: "EAST", targetSide: "WEST" },
] satisfies VariantConnection[];
const EDGE_VARIANTS = [
	{ title: "Default edge", label: "NEXT", className: "" },
	{ title: "Incoming to current step", label: "CHECK", className: "explorer-edge-incoming" },
	{ title: "Outgoing from current step", label: "PASSED", className: "explorer-edge-outgoing" },
	{ title: "Hovered edge", label: "NEXT", className: "explorer-edge-hovered" },
	{
		title: "Incoming · dimmed",
		label: "CHECK",
		className: "explorer-edge-incoming explorer-edge-muted",
	},
	{
		title: "Outgoing · dimmed",
		label: "PASSED",
		className: "explorer-edge-outgoing explorer-edge-muted",
	},
];
const HALF = 2;
const PORT_POSITIONS = {
	NORTH: Position.Top,
	EAST: Position.Right,
	SOUTH: Position.Bottom,
	WEST: Position.Left,
};

type VariantStepGraphNode = Node<StepGraphNode["data"] & { caption: string }, "step">;

interface VariantConnection {
	source: StepId;
	target: StepId;
	sourceSide: WorkflowPort["side"];
	targetSide: WorkflowPort["side"];
}

interface StepSelection {
	step: StepId;
}

// eslint-disable-next-line max-statements -- Keep the panel's simulation, selection and sample context together.
export function WorkflowExplorer() {
	const [context, setContext] = useState(sampleContext);
	const [mode, setMode] = useState<"inspect" | "simulate">("inspect");
	const [history, setHistory] = useState<LandVisit[]>(() => [
		exampleVisit(sampleContext, "example"),
	]);
	const [selection, setSelection] = useState<StepSelection | null>(null);
	const selected = selection?.step ?? exampleStep;
	const selectStep = (step: StepId) => {
		setSelection({ step });
	};
	const theme = useStore(preferences, (state) => state.theme);
	const { snapshot } = history.at(LAST_ENTRY)!;
	const current = snapshot.value;
	const instructions = renderInstructions(selected, snapshot.context);
	const outcomes = availableOutcomes(snapshot, context);
	const path = history.flatMap((entry) => entry.path);
	const restart = (start: "initial" | "example") => {
		const next = exampleVisit(context, start);
		setHistory([next]);
		selectStep(next.snapshot.value);
	};
	const visit = (next: LandVisit) => {
		setHistory((previous) => [...previous, next]);
		selectStep(next.snapshot.value);
	};
	return (
		<main className="workflow-explorer">
			<section className="explorer-workspace" aria-label="Workflow with instruction panel">
				<header className="explorer-toolbar">
					<h1>Land workflow</h1>
					<div className="explorer-segmented board-tabs" aria-label="Workflow mode">
						<button
							type="button"
							className="board-tab"
							aria-pressed={mode === "inspect"}
							onClick={() => {
								setMode("inspect");
								restart("example");
							}}
						>
							Example snapshot (Check)
						</button>
						<button
							type="button"
							className="board-tab"
							aria-pressed={mode === "simulate"}
							onClick={() => {
								setMode("simulate");
								restart("example");
							}}
						>
							Simulate
						</button>
					</div>
					<output aria-live="polite" className="explorer-current">
						<span className="workflow-status-dot" />
						{steps[current].title}
					</output>
					{mode === "simulate" && (
						<div className="explorer-reset-actions">
							<button
								type="button"
								onClick={() => {
									restart("initial");
								}}
							>
								Start from beginning
							</button>
							<button
								type="button"
								onClick={() => {
									restart("example");
								}}
							>
								Reset to example snapshot
							</button>
						</div>
					)}
					<ContextControls
						context={context}
						onChange={(updated) => {
							setContext(updated);
							const next = exampleVisit(updated, "example");
							setHistory([next]);
							selectStep(next.snapshot.value);
						}}
					/>
				</header>
				<WorkflowWorkspace
					diagram={
						<WorkflowCanvas
							identity="land-workshop"
							graph={landGraph}
							availableLabel="Available"
							available={outcomes
								.filter((outcome) => outcome.enabled)
								.map((outcome) => outcome.target)}
							current={[current]}
							focusSelection={selection}
							selected={selected}
							theme={theme === "paper" ? "light" : "dark"}
							onInspect={(id) => {
								selectStep(stepIds.find((step) => step === id)!);
							}}
						/>
					}
					heading={
						<label className="explorer-state-picker">
							Inspect step
							<select
								value={selected}
								onChange={(event) => {
									selectStep(stepIds.find((id) => id === event.target.value)!);
								}}
							>
								{stepIds.map((id) => (
									<option key={id} value={id}>
										{steps[id].title}
									</option>
								))}
							</select>
						</label>
					}
				>
					<InstructionBody
						title={instructions.title}
						source={instructions.source}
						instructions={instructions.instructions}
					/>
				</WorkflowWorkspace>
				{mode === "simulate" && (
					<footer className="explorer-events">
						<div className="explorer-event-buttons">
							{outcomes.map((outcome) => (
								<button
									type="button"
									key={outcome.command}
									disabled={!outcome.enabled}
									title={
										outcome.enabled
											? outcome.event.type
											: "This outcome requires a pull request target"
									}
									onClick={() => {
										visit(advance(snapshot, outcome.event));
									}}
								>
									{outcome.command}
									<span>→ {steps[outcome.target].title}</span>
								</button>
							))}
						</div>
						{current === "done" && <p>Walkthrough complete. Reset to try another route.</p>}
						<button
							type="button"
							className="explorer-back button"
							disabled={history.length === 1}
							onClick={() => {
								const previous = history.slice(0, LAST_ENTRY);
								setHistory(previous);
								selectStep(previous.at(LAST_ENTRY)!.snapshot.value);
							}}
						>
							Back one event
						</button>
						<div className="explorer-history" aria-label="Simulated path">
							{path.map((step, index) => (
								<span key={path.slice(0, index + 1).join(":")}>
									{index > 0 && " → "}
									{steps[step].title}
								</span>
							))}
						</div>
					</footer>
				)}
				<p className="explorer-footnote">
					{stepIds.length} states · {transitionCount} transitions · Land definition · fictional
					context · local simulation only
				</p>
			</section>
		</main>
	);
}

export function WorkflowCardVariants() {
	const { cardSize, variants } = canvasSettings;
	const theme = useStore(preferences, (state) => state.theme);
	const [hovered, setHovered] = useState<string | null>(null);
	const previews = [
		...CARD_VARIANTS.map(([caption, id]) => ({ caption, id, key: id, hovered: false })),
		...HOVER_CARD_VARIANTS.map(([caption, id]) => ({
			caption,
			id,
			key: `hover-${id}`,
			hovered: true,
		})),
	];
	const available = VARIANT_CONNECTIONS.filter(
		(connection) => connection.source === exampleStep,
	).map((connection) => connection.target);
	const portOffsets = {
		NORTH: { x: cardSize.width / HALF, y: 0 },
		EAST: { x: cardSize.width, y: cardSize.height / HALF },
		SOUTH: { x: cardSize.width / HALF, y: cardSize.height },
		WEST: { x: 0, y: cardSize.height / HALF },
	};
	const nodes: VariantStepGraphNode[] = previews.map(
		({ caption, id, key, hovered: preview }, index) => {
			const ports: WorkflowPort[] = VARIANT_CONNECTIONS.flatMap((connection, connectionIndex) => [
				...(connection.source === key
					? [
							{
								id: `${connectionIndex}:out`,
								type: "source" as const,
								side: connection.sourceSide,
								...portOffsets[connection.sourceSide],
							},
						]
					: []),
				...(connection.target === key
					? [
							{
								id: `${connectionIndex}:in`,
								type: "target" as const,
								side: connection.targetSide,
								...portOffsets[connection.targetSide],
							},
						]
					: []),
			]);
			return {
				id: key,
				type: "step",
				position: {
					x: (index % variants.columns) * (cardSize.width + variants.gap),
					y: Math.floor(index / variants.columns) * (cardSize.height + variants.gap),
				},
				...cardSize,
				measured: cardSize,
				handles: ports.map((port) => ({
					...port,
					width: 0,
					height: 0,
					position: PORT_POSITIONS[port.side],
				})),
				data: {
					id,
					caption,
					status: stepStatus(id, [exampleStep], available),
					availableLabel: "Available",
					title: steps[id].title,
					kind: steps[id].kind,
					bee: landGraph.steps[id]!.bee ?? null,
					hovered: preview || id === hovered,
					chosen: id === "review",
					initial: id === initialStep,
					ports,
					direction: "DOWN",
					...(preview ? {} : { onPreview: setHovered }),
				},
			};
		},
	);
	const edges: RoutedGraphEdge[] = VARIANT_CONNECTIONS.map((connection, index) => {
		const source = nodes.find((node) => node.id === connection.source)!;
		const target = nodes.find((node) => node.id === connection.target)!;
		const start = {
			x: source.position.x + portOffsets[connection.sourceSide].x,
			y: source.position.y + portOffsets[connection.sourceSide].y,
		};
		const end = {
			x: target.position.x + portOffsets[connection.targetSide].x,
			y: target.position.y + portOffsets[connection.targetSide].y,
		};
		const transition = transitions[connection.source].find(
			(edge) => edge.target === connection.target,
		)!;
		return {
			id: transition.id,
			source: connection.source,
			target: connection.target,
			sourceHandle: `${index}:out`,
			targetHandle: `${index}:in`,
			type: "routed",
			label: transition.label,
			...edgeAppearance(connection, [exampleStep], hovered),
			data: {
				path: `M ${start.x} ${start.y} L ${end.x} ${end.y}`,
				labelX: (start.x + end.x) / HALF,
				labelY: (start.y + end.y) / HALF,
				target: connection.target,
			},
		};
	});
	return (
		<main className="workflow-explorer explorer-variants">
			<section className="explorer-workspace">
				<header className="explorer-toolbar">
					<h1>Workflow card states</h1>
				</header>
				<section aria-label="Card variants" className="explorer-canvas explorer-variant-cards">
					<ReactFlow<VariantStepGraphNode, RoutedGraphEdge>
						nodes={nodes}
						edges={edges}
						nodeTypes={VARIANT_NODE_TYPES}
						edgeTypes={EDGE_TYPES}
						fitView
						fitViewOptions={{ ...canvasSettings.fitView, maxZoom: canvasSettings.initialZoom }}
						nodesDraggable={false}
						nodesConnectable={false}
						nodesFocusable={false}
						elementsSelectable={false}
						panOnDrag={false}
						zoomOnScroll={false}
						zoomOnPinch={false}
						zoomOnDoubleClick={false}
						preventScrolling={false}
						deleteKeyCode={null}
						colorMode={theme === "paper" ? "light" : "dark"}
						aria-label="Connected workflow variants"
					/>
				</section>
			</section>
		</main>
	);
}

export function WorkflowEdgeVariants() {
	const { variants } = canvasSettings;
	return (
		<main className="workflow-explorer explorer-variants">
			<section className="explorer-workspace">
				<header className="explorer-toolbar">
					<h1>Workflow edge states</h1>
				</header>
				<section aria-label="Edge variants" className="explorer-canvas explorer-variant-edges">
					{EDGE_VARIANTS.map((variant) => (
						<figure key={variant.title}>
							<figcaption>{variant.title}</figcaption>
							<svg
								width="100%"
								height={variants.edgeHeight}
								viewBox={`0 0 ${variants.edgeWidth} ${variants.edgeHeight}`}
								role="img"
								aria-label={variant.title}
							>
								<title>{variant.title}</title>
								<g className={`react-flow__edge ${variant.className}`}>
									<WorkflowEdgePath
										path={
											`M ${variants.edgeInset} ${variants.edgeHeight / HALF} ` +
											`H ${variants.edgeWidth - variants.edgeInset}`
										}
										labelX={variants.edgeWidth / HALF}
										labelY={variants.edgeHeight / HALF}
										label={variant.label}
									/>
								</g>
							</svg>
						</figure>
					))}
				</section>
			</section>
		</main>
	);
}

function ContextControls({
	context,
	onChange,
}: {
	context: SampleContext;
	onChange: (context: SampleContext) => void;
}) {
	const [draft, setDraft] = useState(context);
	return (
		<details className="explorer-context">
			<summary>Sample values</summary>
			<form
				className="explorer-context-popover"
				onSubmit={(event) => {
					event.preventDefault();
					onChange(draft);
				}}
			>
				<div className="explorer-context-fields">
					<label>
						Landing target
						<select
							value={draft.target}
							onChange={(event) => {
								setDraft({
									...draft,
									target: z.enum(["pr", "worktree"]).parse(event.target.value),
								});
							}}
						>
							<option value="pr">Pull request</option>
							<option value="worktree">Worktree</option>
						</select>
					</label>
					<label>
						Example request
						<input
							required
							value={draft.request}
							onChange={(event) => {
								setDraft({ ...draft, request: event.target.value });
							}}
						/>
					</label>
					{draft.target === "worktree" ? (
						<label>
							Branch
							<input
								required
								value={draft.branch}
								onChange={(event) => {
									setDraft({ ...draft, branch: event.target.value });
								}}
							/>
						</label>
					) : (
						<label>
							Pull request URL
							<input
								required
								type="url"
								value={draft.prUrl}
								onChange={(event) => {
									setDraft({ ...draft, prUrl: event.target.value });
								}}
							/>
						</label>
					)}
					<label>
						Example outcome evidence
						<input
							required
							value={draft.evidence}
							onChange={(event) => {
								setDraft({ ...draft, evidence: event.target.value });
							}}
						/>
					</label>
				</div>
				<p>
					Apply these example values to restart at Check. Outcomes use this fictional evidence; no
					review, checks or integration are performed.
				</p>
				<button type="submit" className="explorer-apply-context button">
					Apply &amp; reset
				</button>
			</form>
		</details>
	);
}

function VariantStepNode(props: NodeProps<VariantStepGraphNode>) {
	return (
		<>
			<span className="explorer-variant-caption">{props.data.caption}</span>
			<StepNode data={props.data} />
		</>
	);
}

function VariantRoutedEdge({ data, label }: { data: RoutedGraphEdge["data"]; label?: ReactNode }) {
	return (
		<WorkflowEdgePath path={data!.path} labelX={data!.labelX} labelY={data!.labelY} label={label} />
	);
}
function InstructionBody({
	title,
	source,
	instructions,
}: {
	title: string;
	source: string;
	instructions: string;
}) {
	return (
		<>
			<p className="explorer-instruction-source">{source}</p>
			<h2 className="text-lg">{title}</h2>
			<MarkdownContent>{instructions}</MarkdownContent>
		</>
	);
}
