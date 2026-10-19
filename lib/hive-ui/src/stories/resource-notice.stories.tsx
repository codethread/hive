import type { Meta, StoryObj } from "@storybook/react-vite";
import { annotationKey, hierarchyKey } from "../../contracts.ts";
import { expect, screen, userEvent, waitFor } from "storybook/test";
import { Button } from "../primitives.tsx";
import type { CardAnnotations } from "../../contracts.ts";
import type { Resource } from "../data.ts";
import { ResourceNotice } from "../ui.tsx";
import { annotationStatus } from "../data.ts";
import { useState } from "react";

const SOURCE_COUNT = 2;

const meta = {
	title: "Foundations/Resource notice",
	component: ResourceNotice,
	args: { source: "fixture", label: "Hierarchy", resource: { kind: "loading", previous: null } },
} satisfies Meta<typeof ResourceNotice>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Loading: Story = {};
export const Refreshing: Story = { args: { resource: { kind: "loading", previous: {} } } };
export const Unavailable: Story = {
	args: { resource: { kind: "failed", previous: null, message: "Fixture read failed." } },
};
export const RetainedSnapshot: Story = {
	args: { resource: { kind: "failed", previous: {}, message: "Refresh failed." } },
};
export const OutOfDate: Story = { args: { resource: { kind: "stale", data: {} } } };

export const FailureRecovery: Story = {
	render: () => <AnnotationRecovery />,
	play: async ({ canvas }) => {
		await userEvent.click(canvas.getByRole("button", { name: "Fail annotation read" }));
		await screen.findByText("Metadata unavailable");
		await userEvent.click(screen.getByRole("button", { name: "Close toast" }));
		await waitFor(() => expect(screen.queryByText("Metadata unavailable")).not.toBeInTheDocument());
		await userEvent.click(canvas.getByRole("button", { name: "Retry annotation read" }));
		await userEvent.click(canvas.getByRole("button", { name: "Fail annotation read" }));
		await expect(screen.queryByText("Metadata unavailable")).not.toBeInTheDocument();
		await userEvent.click(canvas.getByRole("button", { name: "Recover annotation read" }));
		await userEvent.click(canvas.getByRole("button", { name: "Fail annotation read" }));
		await screen.findByText("Metadata unavailable");
	},
};

export const IndependentSources: Story = {
	render: () => <IndependentNotices />,
	play: async ({ canvas }) => {
		await waitFor(() =>
			expect(screen.getAllByText("Hierarchy unavailable")).toHaveLength(SOURCE_COUNT),
		);
		await userEvent.click(canvas.getByRole("button", { name: "Recover board hierarchy" }));
		await waitFor(() => expect(screen.getAllByText("Hierarchy unavailable")).toHaveLength(1));
	},
};

function AnnotationRecovery() {
	const [resource, setResource] = useState<Resource<CardAnnotations>>({ kind: "empty" });
	return (
		<div className="flex gap-3 p-6">
			<ResourceNotice
				source="annotations:fixture"
				label="Metadata"
				resource={annotationStatus("fixture", [["card"]], {
					[annotationKey("fixture", ["card"])]: resource,
				})}
			/>
			<Button
				onClick={() => {
					setResource({ kind: "failed", previous: null, message: "Read failed." });
				}}
			>
				Fail annotation read
			</Button>
			<Button
				onClick={() => {
					setResource({ kind: "loading", previous: null });
				}}
			>
				Retry annotation read
			</Button>
			<Button
				onClick={() => {
					setResource({
						kind: "ready",
						data: { cards: [], fetchedAt: "2026-10-19T00:00:00Z" },
						receivedAt: 0,
					});
				}}
			>
				Recover annotation read
			</Button>
		</div>
	);
}

function IndependentNotices() {
	const [recovered, setRecovered] = useState(false);
	const failed = { kind: "failed" as const, previous: null, message: "Hierarchy read failed." };
	return (
		<div className="p-6">
			<ResourceNotice
				source={`hierarchy:${hierarchyKey("fixture", ["board"])}`}
				label="Hierarchy"
				resource={recovered ? { kind: "ready", data: {}, receivedAt: 0 } : failed}
			/>
			<ResourceNotice source="outline:fixture/root" label="Hierarchy" resource={failed} />
			<Button
				onClick={() => {
					setRecovered(true);
				}}
			>
				Recover board hierarchy
			</Button>
		</div>
	);
}
