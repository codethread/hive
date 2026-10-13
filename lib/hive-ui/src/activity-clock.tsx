import { createContext, useContext, useSyncExternalStore } from "react";

const TICK_MS = 1000;
const listeners = new Set<() => void>();
let now = Date.now();
// eslint-disable-next-line init-declarations -- The first subscriber starts the shared timer; the last stops it.
let timer: ReturnType<typeof setInterval> | undefined;

/** Storybook fixes the clock while production ages recorded evidence without fetching. */
export const ActivityClock = createContext<number | null>(null);

export function useActivityClock(): number {
	const fixed = useContext(ActivityClock);
	return useSyncExternalStore(
		fixed === null ? subscribe : subscribeFixed,
		fixed === null ? snapshot : () => fixed,
	);
}

// --- One local clock shared by all visible cards; never a data poll. ---
function snapshot() {
	return now;
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	if (listeners.size === 1) {
		now = Date.now();
		timer = setInterval(() => {
			now = Date.now();
			for (const notify of listeners) {
				notify();
			}
		}, TICK_MS);
	}
	return () => {
		listeners.delete(listener);
		if (listeners.size === 0) {
			clearInterval(timer);
		}
	};
}

function subscribeFixed() {
	return () => {};
}
