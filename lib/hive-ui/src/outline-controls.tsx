import { preferences } from "./data.ts";
import { useStore } from "zustand";

export function OutlineControls() {
	const workflows = useStore(preferences, (state) => state.outlineWorkflows);
	const closed = useStore(preferences, (state) => state.outlineClosed);
	return (
		<div className="flex shrink-0 flex-wrap items-center gap-4">
			<label className="flex items-center gap-2 text-xs text-muted">
				<input
					type="checkbox"
					checked={workflows}
					onChange={(event) => {
						preferences.setState({ outlineWorkflows: event.target.checked });
					}}
				/>
				Workflows
			</label>
			<label className="flex items-center gap-2 text-xs text-muted">
				<input
					type="checkbox"
					checked={closed}
					onChange={(event) => {
						preferences.setState({ outlineClosed: event.target.checked });
					}}
				/>
				Closed
			</label>
		</div>
	);
}
