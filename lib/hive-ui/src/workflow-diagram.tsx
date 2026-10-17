/* eslint-disable react/iframe-missing-sandbox -- Cross-origin Stately needs scripts and its own storage origin. */
import { useEffect, useRef, useState } from "react";
import type { WorkflowPreview } from "../contracts.ts";
import { createInspector } from "@statelyai/sdk/inspect";
import { createWorkflowPublisher } from "./workflow-actors.ts";

/** Publish only the producer's structural projection, never the checkpoint body. */
export function WorkflowDiagram({
	actors,
	theme,
}: {
	actors: WorkflowPreview["actors"];
	theme: "light" | "dark";
}) {
	const [notice, setNotice] = useState("Connecting to Stately…");
	const frame = useRef<HTMLIFrameElement>(null);
	const connection = useRef<ReturnType<typeof createInspector> | null>(null);
	const publish = useRef<ReturnType<typeof createWorkflowPublisher> | null>(null);
	useEffect(() => {
		const inspector = createInspector({
			producerId: "hive-preview",
			selectedSessionId: "hive-preview:actor-0",
			inspectorBaseUrl: "https://editor.stately.ai/inspect",
			name: "Hive saved workflow",
			readOnly: true,
			bidirectional: false,
		});
		inspector.on("loaded", () => {
			setNotice("Stately connected · saved workflow state");
		});
		inspector.on("error", (error) => {
			setNotice(`Stately: ${error.message}`);
		});
		connection.current = inspector;
		publish.current = createWorkflowPublisher(inspector, (id) => {
			inspector.selectActor(`hive-preview:${id}`);
		});
		frame.current!.src = inspector.inspectorUrl!;
		return () => {
			inspector.destroy();
		};
	}, []);
	useEffect(() => {
		publish.current!(actors);
	}, [actors]);
	useEffect(() => {
		connection.current!.setTheme(theme);
	}, [theme]);
	return (
		<div className="workflow-preview-body">
			<div className="workflow-preview-toolbar">
				<output>{notice}</output>
				<span className="text-xs text-muted">Pan, zoom & follow in Stately</span>
			</div>
			<div className="workflow-editor">
				<iframe
					sandbox="allow-scripts allow-same-origin"
					ref={frame}
					title="Stately workflow diagram"
				/>
			</div>
		</div>
	);
}
