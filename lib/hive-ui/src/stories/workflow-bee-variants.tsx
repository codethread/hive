import { StepNode } from "../workflow-canvas.tsx";
import type { WorkflowBeeStatus } from "../workflow-bee-status.tsx";
import { landGraph } from "./workflow-explorer-data.ts";

const variants = [
	{ status: "pending", caption: "Pending · no observed output", current: false },
	{ status: "active", caption: "Active · recent output", current: false },
	{ status: "quiet", caption: "Quiet · no recent output", current: false },
	{ status: "succeeded", caption: "Request succeeded", current: false },
	{ status: "failed", caption: "Request failed", current: false },
	{ status: "cancelled", caption: "Request cancelled", current: false },
	{ status: "unknown", caption: "Status unavailable", current: false },
	{ status: "attention", caption: "Investigate · no observed output for 10+ min", current: false },
	{ status: "active", caption: "Active + current workflow step", current: true },
] satisfies { status: WorkflowBeeStatus; caption: string; current: boolean }[];

export function WorkflowBeeVariants() {
	return (
		<section className="explorer-bee-variants" aria-label="Bee status variants">
			<header>
				<h1>Bee status</h1>
				<p>
					Illustrative statuses; no live request data. Current marks workflow position
					independently.
				</p>
			</header>
			<div className="explorer-bee-variant-grid">
				{variants.map(({ status, caption, current }) => (
					<figure key={caption}>
						<figcaption>{caption}</figcaption>
						<div className="explorer-bee-variant-card">
							<StepNode
								data={{
									id: caption,
									title: "Review",
									kind: "task",
									bee: landGraph.steps["review"]!.bee!,
									beeStatus: status,
									status: current ? "current" : "default",
									availableLabel: "Available",
									hovered: false,
									chosen: false,
									initial: false,
									ports: [],
									direction: "DOWN",
								}}
							/>
						</div>
					</figure>
				))}
			</div>
		</section>
	);
}
