import { PanelBottomClose, PanelBottomOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./resizable.tsx";
import { useId, useState, useSyncExternalStore } from "react";
import { Button } from "./primitives.tsx";
import type { ReactNode } from "react";
import { usePanelRef } from "react-resizable-panels";

const NARROW_WORKSPACE = "(max-width: 800px)";
const PANEL_SETTINGS = {
	defaultSize: "34%",
	minWidth: 320,
	maxSize: "65%",
	collapsedSize: 44,
	narrowMin: "20%",
	diagramNarrowMin: "30%",
};

export function WorkflowWorkspace({
	diagram,
	heading,
	children,
}: {
	diagram: ReactNode;
	heading: ReactNode;
	children: ReactNode;
}) {
	const [open, setOpen] = useState(true);
	const panel = usePanelRef();
	const bodyId = useId();
	const narrow = useSyncExternalStore(subscribeWorkspaceSize, isNarrowWorkspace);
	const CloseIcon = narrow ? PanelBottomClose : PanelRightClose;
	const OpenIcon = narrow ? PanelBottomOpen : PanelRightOpen;
	return (
		<ResizablePanelGroup
			className="explorer-split"
			orientation={narrow ? "vertical" : "horizontal"}
		>
			<ResizablePanel
				className="explorer-canvas"
				minSize={narrow ? PANEL_SETTINGS.diagramNarrowMin : PANEL_SETTINGS.minWidth}
			>
				{diagram}
			</ResizablePanel>
			<ResizableHandle withHandle aria-label="Resize instructions" />
			<ResizablePanel
				panelRef={panel}
				collapsible
				collapsedSize={PANEL_SETTINGS.collapsedSize}
				defaultSize={PANEL_SETTINGS.defaultSize}
				minSize={narrow ? PANEL_SETTINGS.narrowMin : PANEL_SETTINGS.minWidth}
				maxSize={PANEL_SETTINGS.maxSize}
				groupResizeBehavior="preserve-pixel-size"
				onResize={(size) => {
					setOpen(Math.round(size.inPixels) > PANEL_SETTINGS.collapsedSize);
				}}
			>
				<aside
					className="explorer-instruction-panel"
					data-open={open}
					aria-label="Step instructions"
				>
					<header className="explorer-instruction-header">
						{open && heading}
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="size-8"
							aria-label={open ? "Hide instructions" : "Show instructions"}
							title={open ? "Hide instructions" : "Show instructions"}
							aria-expanded={open}
							aria-controls={bodyId}
							onClick={() => {
								if (open) {
									panel.current!.collapse();
								} else {
									panel.current!.expand();
								}
							}}
						>
							{open ? <CloseIcon /> : <OpenIcon />}
						</Button>
					</header>
					<div id={bodyId} className="explorer-instruction-body" hidden={!open}>
						{children}
					</div>
				</aside>
			</ResizablePanel>
		</ResizablePanelGroup>
	);
}

function subscribeWorkspaceSize(onChange: () => void) {
	const query = globalThis.matchMedia(NARROW_WORKSPACE);
	query.addEventListener("change", onChange);
	return () => {
		query.removeEventListener("change", onChange);
	};
}

function isNarrowWorkspace() {
	return globalThis.matchMedia(NARROW_WORKSPACE).matches;
}
