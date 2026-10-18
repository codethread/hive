import { ScopeNode, StepNode } from "../workflow-canvas.tsx";
import { expect, screen, userEvent } from "storybook/test";
import type { Meta } from "@storybook/react-vite";
import { WorkflowBeeVariants } from "./workflow-bee-variants.tsx";
import { WorkflowCardVariants } from "./workflow-explorer.tsx";
import { useState } from "react";

const meta = {
	title: "Workflow preview/Cards",
	component: StepNode,
	parameters: { controls: { disable: true } },
} satisfies Meta<typeof StepNode>;
export default meta;

export const StepStates = {
	name: "Step states",
	render: () => <WorkflowCardVariants />,
};
export const BeeStatus = {
	name: "Bee status",
	render: () => (
		<main className="workflow-explorer explorer-variants">
			<section className="explorer-workspace">
				<WorkflowBeeVariants />
			</section>
		</main>
	),
};

export const ScopeStates = {
	render: () => <ScopeVariants />,
	play: async () => {
		await expect(
			await screen.findByRole("button", { name: "Inspect Current scope" }),
		).toHaveTextContent("Current");
		await expect(
			screen.getByRole("button", { name: "Inspect Inactive scope" }),
		).not.toHaveTextContent("Current");
		await expect(screen.getByRole("button", { name: "Inspect Target scope" })).toHaveTextContent(
			"Direct target",
		);
		await expect(screen.getByRole("button", { name: "Inspect Bee scope" })).toHaveTextContent(
			"Current",
		);
		await expect(screen.getByRole("button", { name: "Inspect Bee scope" })).toHaveTextContent(
			"worker",
		);
		await userEvent.click(screen.getByRole("button", { name: "Collapse Bee scope" }));
		await expect(screen.getByText("Work")).toBeVisible();
	},
};

function ScopeVariants() {
	const [selected, setSelected] = useState("");
	const [collapsed, setCollapsed] = useState(new Set<string>());
	const variants = [
		{ title: "Current scope", status: "current", bee: null },
		{ title: "Inactive scope", status: "default", bee: null },
		{ title: "Target scope", status: "available", bee: null },
		{ title: "Bee scope", status: "current", bee: "worker" },
	] as const;
	return (
		<main className="workflow-explorer explorer-variants">
			<section className="explorer-bee-variants" aria-label="Scope status variants">
				<div className="explorer-bee-variant-grid">
					{variants.map(({ title, status, bee }) => (
						<div key={title} style={{ height: 140 }}>
							<ScopeNode
								data={{
									id: title,
									title,
									status,
									bee,
									kind: "compound",
									availableLabel: "Direct target",
									chosen: selected === title,
									initial: false,
									ports: [],
									direction: "DOWN",
									hovered: false,
									focused: true,
									collapsed: collapsed.has(title),
									summary: status === "current" ? "Work" : "Not current",
									onInspect: setSelected,
									onFocus: setSelected,
									onToggle: (id) => {
										setCollapsed((previous) => {
											const next = new Set(previous);
											if (next.has(id)) {
												next.delete(id);
											} else {
												next.add(id);
											}
											return next;
										});
									},
								}}
							/>
						</div>
					))}
				</div>
			</section>
		</main>
	);
}
