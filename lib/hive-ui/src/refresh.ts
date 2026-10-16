import { assign, fromPromise, setup } from "xstate";

export const REFRESH_INTERVAL_MS = 5000;
const visibilityEvent: { type: "SHOW" | "HIDE" } = { type: "SHOW" };

export function createRefreshMachine(refresh: () => Promise<void>) {
	return setup({
		types: {
			context: { visible: false },
			input: { visible: false },
			events: visibilityEvent,
		},
		actors: { refresh: fromPromise(refresh) },
		guards: { visible: ({ context }) => context.visible },
	}).createMachine({
		context: ({ input }) => input,
		initial: "checking",
		states: {
			checking: { always: [{ guard: "visible", target: "waiting" }, { target: "paused" }] },
			waiting: {
				after: { [REFRESH_INTERVAL_MS]: "refreshing" },
				on: { HIDE: { target: "paused", actions: assign({ visible: false }) } },
			},
			refreshing: {
				invoke: { src: "refresh", onDone: "checking" },
				on: {
					HIDE: { actions: assign({ visible: false }) },
					SHOW: { actions: assign({ visible: true }) },
				},
			},
			paused: {
				on: { SHOW: { target: "refreshing", actions: assign({ visible: true }) } },
			},
		},
	});
}
