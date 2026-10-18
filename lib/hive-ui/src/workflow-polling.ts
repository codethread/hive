const POLL_MS = 5000;

interface PollingEnvironment {
	/** Read only while the inspector's document is visible. */
	visible: () => boolean;
	/** Subscribe to document visibility and return its cleanup. */
	subscribe: (changed: () => void) => () => void;
	/** Schedule the next checkpoint read. */
	schedule: (read: () => void, ms: number) => () => void;
}

/** The mounted inspector owns this subscription; closing it cancels future reads. */
export function pollVisibleWorkflow(
	refresh: (conditional: boolean) => Promise<void>,
	environment: PollingEnvironment,
) {
	let cancel = () => {};
	let opened = false;
	const changed = () => {
		cancel();
		if (environment.visible()) {
			void refresh(opened);
			opened = true;
			cancel = environment.schedule(() => {
				void refresh(true);
			}, POLL_MS);
		}
	};
	const unsubscribe = environment.subscribe(changed);
	changed();
	return () => {
		cancel();
		unsubscribe();
	};
}
