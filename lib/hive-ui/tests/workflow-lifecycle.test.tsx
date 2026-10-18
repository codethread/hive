import { expect, test } from "bun:test";
import type { WorkflowLifecycle } from "@hive/shared";
import { WorkflowLifecycleBanner } from "../src/workflow-lifecycle.tsx";
import { renderToStaticMarkup } from "react-dom/server";

test.each([
	{ outcome: "succeeded", resolution: { kind: "resolved" }, expected: "Succeeded" },
	{ outcome: "failed", resolution: { kind: "unresolved" }, expected: "Failed" },
	{
		outcome: "failed",
		resolution: {
			kind: "acknowledged",
			actor: "reviewer",
			acknowledgedAt: "later",
			reason: "Accepted",
		},
		expected: "Failed",
	},
	{
		outcome: "failed",
		resolution: { kind: "superseded", replacementIds: ["replacement"] },
		expected: "Failed",
	},
	{
		outcome: "cancelled",
		resolution: { kind: "superseded", replacementIds: ["replacement"] },
		expected: "Cancelled",
	},
] satisfies {
	outcome: "succeeded" | "failed" | "cancelled";
	resolution: WorkflowLifecycle["resolution"];
	expected: string;
}[])(
	"#test-201 native $outcome stays visible with $resolution.kind follow-up",
	// eslint-disable-next-line max-statements -- Verify outcome, provenance and escaping for each visible disposition.
	({ outcome, resolution, expected }) => {
		const inspection = fixture();
		inspection.lifecycle = {
			kind: "terminal",
			closedAt: "closed",
			fact: {
				kind: "busybee-lifecycle",
				formatVersion: 1,
				scope: "run",
				runId: inspection.runId,
				outcome,
				reason: "Retained <evidence>",
			},
		};
		inspection.nativeStatus = "closed";
		inspection.resolution = structuredClone(resolution);
		const html = renderToStaticMarkup(
			<WorkflowLifecycleBanner inspection={inspection} colony="selected" />,
		);
		expect(html).toContain(`Workflow: ${expected}`);
		expect(html).toContain("Native task: closed");
		expect(html).toContain("Retained &lt;evidence&gt;");
		if (resolution.kind === "acknowledged") {
			expect(html).toContain("Follow-up acknowledged by reviewer at later. Accepted");
		} else if (resolution.kind === "superseded") {
			expect(html).toContain('href="/colonies/selected?bead=replacement"');
		}
	},
);

test("pending and unclassified native facts remain separate from publication observations", () => {
	const inspection = fixture();
	inspection.publication.locked = true;
	const pending = renderToStaticMarkup(
		<WorkflowLifecycleBanner inspection={inspection} colony="selected" />,
	);
	expect(pending).toContain("Workflow: Pending");
	expect(pending).toContain("Publication: lock retained");
	inspection.nativeStatus = "closed";
	inspection.lifecycle = { kind: "unavailable", reason: "unclassified_closure" };
	const unclassified = renderToStaticMarkup(
		<WorkflowLifecycleBanner inspection={inspection} colony="selected" />,
	);
	expect(unclassified).toContain("Workflow: Unclassified closure");
	expect(unclassified).not.toContain("Succeeded");
});

function fixture(): WorkflowLifecycle {
	return {
		runId: "run",
		nativeStatus: "in_progress",
		updatedAt: "updated",
		publication: { checkpoint: "checkpoint", savedAt: "saved", locked: false, settlement: "none" },
		lifecycle: { kind: "pending" },
		resolution: { kind: "unresolved" },
	};
}
