import { preferences } from "./data.ts";
import { useStore } from "zustand";

export function OutlineClosedToggle() {
	const includeClosed = useStore(preferences, (state) => state.outlineClosed);
	return (
		<label className="flex shrink-0 items-center gap-2 text-xs text-muted">
			<input
				type="checkbox"
				checked={includeClosed}
				onChange={(event) => {
					preferences.setState({ outlineClosed: event.target.checked });
				}}
			/>
			Include closed
		</label>
	);
}
