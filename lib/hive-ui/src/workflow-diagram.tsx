/* eslint-disable react/iframe-missing-sandbox -- Cross-origin Stately needs scripts and its own storage origin. */
import { useEffect, useRef, useState } from "react";
import type { WorkflowPreview } from "../contracts.ts";
import { createInspector } from "@statelyai/sdk/inspect";

const LAST_PATH_SEGMENT = -1;

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
	useEffect(() => {
		const inspector = createInspector({
			producerId: "hive-preview",
			selectedSessionId: "hive-preview:actor-0",
			inspectorBaseUrl: "https://editor.stately.ai/inspect",
			name: "Hive saved workflow",
			readOnly: true,
			bidirectional: false,
			theme,
		});
		inspector.on("loaded", () => {
			setNotice("Stately connected · saved state highlighted");
		});
		inspector.on("error", (error) => {
			setNotice(`Stately: ${error.message}`);
		});
		const ids = new Map(
			actors.map((actor, index) => [JSON.stringify(actor.path), `actor-${index}`]),
		);
		for (const actor of actors) {
			const parent =
				actor.path.length === 0
					? undefined
					: ids.get(JSON.stringify(actor.path.slice(0, LAST_PATH_SEGMENT)));
			inspector.actor(ids.get(JSON.stringify(actor.path))!, {
				machine: actor.machine,
				snapshot: actor.snapshot,
				...(parent === undefined ? {} : { parent }),
			});
		}
		frame.current!.src = inspector.inspectorUrl!;
		return () => {
			inspector.destroy();
		};
	}, [actors, theme]);
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
