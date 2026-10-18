import { EMPTY, simulateWorkflow, snapshot } from "./data.ts";
import type {
	WorkflowInspection,
	WorkflowSimulation,
	WorkflowSimulationRequest,
} from "../contracts.ts";
import { useEffect, useState } from "react";
import { Button } from "./primitives.tsx";
import type { Resource } from "./data.ts";
import { sample } from "openapi-sampler";
import { workflowSimulationRequestSchema } from "../contracts.ts";

const LAST = -1;
const JSON_INDENT = 2;

interface SimulationOrigin {
	inspection: WorkflowInspection;
	request: WorkflowSimulationRequest;
}

interface SimulationSession {
	request: WorkflowSimulationRequest;
	response: WorkflowSimulation;
}

export function useWorkflowSimulation(
	colony: string,
	inspection: WorkflowInspection,
	actorId: string,
) {
	const [origin, setOrigin] = useState<SimulationOrigin | null>(null);
	const request = origin?.request ?? null;
	const baseline = origin?.inspection ?? inspection;
	const [resource, setResource] = useState<Resource<SimulationSession>>(EMPTY);
	const session = snapshot(resource);
	const base = {
		checkpoint: baseline.checkpoint,
		savedAt: baseline.savedAt,
		definitionHash: baseline.definition.currentHash,
		actorId: request?.actorId ?? actorId,
	};
	const go = (next: WorkflowSimulationRequest) => {
		setResource((previous) => ({ kind: "loading", previous: snapshot(previous) }));
		setOrigin({ inspection: baseline, request: next });
	};
	useEffect(() => {
		let current = true;
		if (request !== null) {
			const load = async () => {
				try {
					const response = await simulateWorkflow(colony, inspection.runId, request);
					if (current) {
						setResource({ kind: "ready", data: { request, response }, receivedAt: Date.now() });
					}
				} catch (error) {
					if (current) {
						setResource((previous) => ({
							kind: "failed",
							previous: snapshot(previous),
							message: error instanceof Error ? error.message : String(error),
						}));
					}
				}
			};
			void load();
		}
		return () => {
			current = false;
		};
	}, [colony, inspection.runId, request]);
	return {
		active: request !== null,
		inspection: baseline,
		actorId: request?.actorId ?? actorId,
		newerSaved:
			origin !== null &&
			(baseline.checkpoint !== inspection.checkpoint ||
				baseline.savedAt !== inspection.savedAt ||
				baseline.definition.currentHash !== inspection.definition.currentHash),
		resource,
		session,
		busy: resource.kind === "loading",
		initialAllowed:
			baseline.actors.find((actor) => actor.id === (request?.actorId ?? actorId))!.path.length ===
			0,
		handleSaved: () => {
			setOrigin(null);
			setResource(EMPTY);
		},
		handleStart: () => {
			go({ ...base, start: { kind: "saved" }, events: [] });
		},
		handleInitial: (input: WorkflowSimulationRequest["events"][number]["data"]) => {
			go({ ...base, start: { kind: "initial", input }, events: [] });
		},
		advance: (
			choice: WorkflowSimulation["choices"][number],
			data: WorkflowSimulationRequest["events"][number]["data"],
		) => {
			go({
				...session!.request,
				events: [...session!.request.events, { node: choice.node, command: choice.command, data }],
			});
		},
		handleBack: () => {
			go({ ...session!.request, events: session!.request.events.slice(0, LAST) });
		},
		handleReset: () => {
			go({ ...session!.request, events: [] });
		},
	};
}

type Simulation = ReturnType<typeof useWorkflowSimulation>;

export function SimulationMode({ simulation }: { simulation: Simulation }) {
	return (
		<fieldset className="explorer-layout-options board-tabs" aria-label="Workflow mode">
			<button
				type="button"
				className="board-tab"
				aria-pressed={!simulation.active}
				onClick={simulation.handleSaved}
			>
				Saved
			</button>
			<button
				type="button"
				className="board-tab"
				aria-pressed={simulation.active}
				onClick={() => {
					if (!simulation.active) {
						simulation.handleStart();
					}
				}}
			>
				Simulate
			</button>
		</fieldset>
	);
}

export function SimulationControls({ simulation }: { simulation: Simulation }) {
	const { session, resource, busy } = simulation;
	return (
		<footer className="workflow-simulation" aria-label="Workflow simulation" aria-busy={busy}>
			{simulation.newerSaved && (
				<output className="absolute inset-x-3 bottom-3 z-10 rounded border border-line bg-canvas p-3 text-sm">
					The saved checkpoint or diagram source has changed. This simulation keeps its starting
					snapshot. Choose Saved to view the latest saved state.
				</output>
			)}
			{resource.kind === "failed" && <p role="alert">{resource.message}</p>}
			<div className="workflow-simulation-actions">
				<span className="workflow-simulation-label">Simulation</span>
				<Button
					variant="ghost"
					disabled={busy || session === null || session.request.events.length === 0}
					onClick={simulation.handleBack}
				>
					Back
				</Button>
				<Button
					variant="ghost"
					disabled={busy || session === null}
					onClick={simulation.handleReset}
				>
					Reset
				</Button>
				{simulation.initialAllowed && (
					<InitialInput simulation={simulation} schema={session?.response.inputSchema} />
				)}
				<span className="text-muted">Temporary walkthrough</span>
			</div>
			{session === null ? (
				<output>{busy ? "Preparing simulation…" : "Simulation did not start."}</output>
			) : (
				<>
					{session.response.choices.length === 0 ? (
						<p className="text-muted">No outcomes at this state.</p>
					) : (
						<OutcomeForm
							key={JSON.stringify(session.response.actor.snapshot.value)}
							choices={session.response.choices}
							simulation={simulation}
						/>
					)}
					{session.request.events.length > 0 && (
						<div className="explorer-history" aria-label="Simulated path">
							{session.request.events.map((event, index) => (
								<span
									key={session.request.events
										.slice(0, index + 1)
										.map((entry) => entry.command)
										.join(":")}
								>
									{index > 0 && " → "}
									{event.command}
								</span>
							))}
						</div>
					)}
				</>
			)}
		</footer>
	);
}

function OutcomeForm({
	choices,
	simulation,
}: {
	choices: WorkflowSimulation["choices"];
	simulation: Simulation;
}) {
	const [selected, setSelected] = useState(0);
	const choice = choices[selected]!;
	return (
		<div className="workflow-simulation-outcome">
			<label className="explorer-state-picker">
				Outcome
				<select
					value={selected}
					disabled={simulation.busy}
					onChange={(event) => {
						setSelected(Number(event.target.value));
					}}
				>
					{choices.map((entry, index) => (
						<option key={`${entry.node}:${entry.command}`} value={index}>
							{entry.title} · {entry.command}
						</option>
					))}
				</select>
			</label>
			<JsonForm
				key={`${choice.node}:${choice.command}`}
				schema={choice.schema}
				label="Event data"
				action="Apply event"
				busy={simulation.busy}
				onSubmit={(data) => {
					simulation.advance(choice, data);
				}}
			/>
		</div>
	);
}

function InitialInput({
	simulation,
	schema,
}: {
	simulation: Simulation;
	schema: Record<string, unknown> | undefined;
}) {
	return (
		<details className="workflow-simulation-input">
			<summary>From beginning</summary>
			<div className="workflow-simulation-input-body">
				<p>
					Enter initial input as JSON. The original input is not retained in the saved checkpoint.
				</p>
				<JsonForm
					schema={schema}
					label="Initial input"
					action="Start from beginning"
					busy={simulation.busy}
					onSubmit={simulation.handleInitial}
					expanded
				/>
			</div>
		</details>
	);
}

function JsonForm({
	schema,
	label,
	action,
	busy,
	onSubmit,
	expanded = false,
}: {
	schema: Record<string, unknown> | undefined;
	label: string;
	action: string;
	busy: boolean;
	onSubmit: (data: WorkflowSimulationRequest["events"][number]["data"]) => void;
	expanded?: boolean;
}) {
	const [draft, setDraft] = useState("{}");
	const [failure, setFailure] = useState<string | null>(null);
	return (
		<form
			className="workflow-simulation-form"
			onSubmit={(event) => {
				event.preventDefault();
				try {
					const data = workflowSimulationRequestSchema.shape.events.element.shape.data.parse(
						JSON.parse(draft),
					);
					setFailure(null);
					onSubmit(data);
				} catch (error) {
					setFailure(error instanceof Error ? error.message : String(error));
				}
			}}
		>
			<details open={expanded || undefined}>
				<summary>{label}</summary>
				<label>
					<span className="sr-only">{label}</span>
					<textarea
						value={draft}
						disabled={busy}
						spellCheck={false}
						onChange={(event) => {
							setDraft(event.target.value);
						}}
					/>
				</label>
				{schema !== undefined && (
					<details>
						<summary>Payload schema</summary>
						<pre>{JSON.stringify(schema, null, JSON_INDENT)}</pre>
					</details>
				)}
			</details>
			{schema !== undefined && (
				<Button
					type="button"
					variant="ghost"
					aria-label={`Use example ${label.toLowerCase()}`}
					disabled={busy}
					onClick={() => {
						setDraft(
							JSON.stringify(
								sample(schema, { quiet: true, skipNonRequired: true }),
								null,
								JSON_INDENT,
							),
						);
						setFailure(null);
					}}
				>
					Use example
				</Button>
			)}
			<Button type="submit" disabled={busy}>
				{action}
			</Button>
			{failure !== null && <p role="alert">{failure}</p>}
		</form>
	);
}
