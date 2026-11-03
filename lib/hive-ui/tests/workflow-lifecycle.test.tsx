import { expect, test } from "bun:test";
import type { WorkflowLifecycle } from "@hive/shared";
import { WorkflowLifecycleBanner } from "../src/workflow-lifecycle.tsx";
import { renderToStaticMarkup } from "react-dom/server";

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
