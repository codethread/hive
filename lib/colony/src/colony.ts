import { assign, createActor, fromPromise, setup, stateIn } from "xstate";
import { formatBeadsConflict, isBeadsConflict } from "@hive/shared";
import type { AnyActorLogic } from "xstate";
import type { BeesConfig } from "@hive/shared";
import type { DispatchInput } from "./dispatch.ts";
import { dispatch } from "./dispatch.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Identify the host where Colony stopped.
import { hostname } from "node:os";
import { match } from "ts-pattern";

const POLL_MILLISECONDS = 1000;
export type ColonyActivity =
	| { state: "awake"; config: BeesConfig; revisionId: string }
	| { state: "asleep" }
	| { state: "failed"; message: string };

/** XState owns timer, pass lifetime and failure state; no overlapping scans. */
export function createColony(input: DispatchInput, activity: ColonyActivity) {
	const actors: Record<string, AnyActorLogic> = {};
	if (activity.state === "awake") {
		const { config, revisionId } = activity;
		actors["scan"] = fromPromise(() => dispatch(input, config, revisionId));
	}
	const machine = setup({
		actors,
		guards: { draining: stateIn({ busy: "draining" }) },
		types: { context: {} as { message: string }, events: {} as { type: "STOP" } },
	}).createMachine({
		context: {
			message: match(activity)
				.with({ state: "failed" }, ({ message }) => message)
				.otherwise(() => ""),
		},
		initial: match(activity)
			.with({ state: "awake" }, () => "busy")
			.otherwise(({ state }) => state),
		states: {
			asleep: { type: "final" },
			busy: {
				initial: "running",
				invoke: {
					onDone: [{ guard: "draining", target: "asleep" }, { target: "idle" }],
					onError: {
						actions: assign({
							message: ({ event }) => {
								let message = String(event.error);
								if (event.error instanceof Error) {
									({ message } = event.error);
								}
								if (isBeadsConflict(event.error)) {
									message = formatBeadsConflict(event.error, {
										...input.repository,
										host: hostname(),
										operation: "Colony dispatch",
									});
								}
								console.error(`Colony ${input.repository.root} failed: ${message}`);
								return message;
							},
						}),
						target: "failed",
					},
					src: "scan",
				},
				states: { draining: {}, running: { on: { STOP: "draining" } } },
			},
			failed: { on: { STOP: "asleep" } },
			idle: { after: { [POLL_MILLISECONDS]: "busy" }, on: { STOP: "asleep" } },
		},
	});
	return createActor(machine);
}
