import type { ActorOptions, AnyActorLogic } from "xstate";
import type { ColonyHintEvent, ColonyHints } from "./wake-hints.ts";
import type { DispatchInput, dispatch } from "./dispatch.ts";
import { assign, createActor, fromCallback, fromPromise, sendTo, setup, stateIn } from "xstate";
import { formatBeadsConflict, isBeadsConflict } from "@hive/shared";
import type { BeesConfig } from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Checkpoints and diagnostics remain bound to this host.
import { hostname } from "node:os";
import { match } from "ts-pattern";

const POLL_MILLISECONDS = 5000;
const QUIET_MILLISECONDS = 60_000;
const ZERO = 0;
const NEXT = 1;
export type ColonyActivity =
	| { state: "awake"; config: BeesConfig; revisionId: string }
	| { state: "asleep" }
	| { state: "failed"; message: string };
interface ColonyServices extends Pick<ActorOptions<AnyActorLogic>, "clock"> {
	/** Full authoritative pass, optionally instrumented by the caller. */
	scan: typeof dispatch;
	/** Attach hint observation for the awake actor. */
	observeHints: (notify: (event: ColonyHintEvent) => void) => ColonyHints;
	/** Monotonic milliseconds used with the actor's timer clock. */
	now: () => number;
	/** Diagnostic sink for hint and scan failures; defaults to stderr. */
	report?: (message: string) => void;
}
interface ScanContext {
	/** Last native reconciliation failure. */
	message: string;
	/** Delivered hints, including those arriving during a pass. */
	generation: number;
	/** Generation consumed at the start of the current or last pass. */
	consumed: number;
	/** Fixed origin for the next idle deadline. */
	completedAt: number;
	/** Last pass retained only unchanged running work, or remained empty. */
	quiet: boolean;
	/** Watch failure restores five-second polling until actor replacement. */
	degraded: boolean;
}
type HintCommand = { type: "UPDATE"; directories: string[] } | { type: "DISPOSE" };

/** XState owns hint lifetime, fixed deadlines, serial passes and drain precedence. */
export function createColony(
	input: DispatchInput,
	activity: ColonyActivity,
	services: ColonyServices,
) {
	const report = services.report ?? ((message: string) => console.error(message));
	const machine = setup({
		actors: {
			hints: fromCallback<HintCommand>(({ sendBack, receive }) => {
				const source = services.observeHints(sendBack);
				try {
					source.update(
						input.store
							.currentAttempts(input.repository.root)
							.map(({ receipt }) => receipt.directory),
					);
				} catch (error) {
					source.dispose();
					throw error;
				}
				receive((event) => {
					if (event.type === "UPDATE") {
						source.update(event.directories);
					} else {
						source.dispose();
					}
				});
				sendBack({ type: "WATCH_READY" });
				return () => source.dispose();
			}),
			scan: fromPromise(async () => {
				const before = retainedScanState(input);
				if (activity.state === "awake") {
					await services.scan(input, activity.config, activity.revisionId);
				}
				const after = retainedScanState(input);
				return {
					directories: after.directories,
					quiet: after.stable && before.signature === after.signature,
				};
			}),
		},
		actions: {
			hint: assign({ generation: ({ context }) => context.generation + NEXT }),
			degrade: assign({
				degraded: ({ context, event }) => {
					if (!context.degraded && event.type === "HINT_FAILURE") {
						report(
							`Colony ${input.repository.root} hints failed (${input.repository.beadsDb}); ` +
								`using five-second polling until wake: ${event.message}`,
						);
					}
					return true;
				},
			}),
		},
		delays: {
			nextScan: ({ context }) => {
				let delay = QUIET_MILLISECONDS;
				if (context.degraded || !context.quiet || context.generation > context.consumed) {
					delay = POLL_MILLISECONDS;
				}
				return Math.max(ZERO, context.completedAt + delay - services.now());
			},
		},
		guards: { draining: stateIn({ awake: { busy: "draining" } }) },
		types: {
			context: {} as ScanContext,
			events: {} as ColonyHintEvent | { type: "STOP" } | { type: "WATCH_READY" },
		},
	}).createMachine({
		id: "colony",
		context: {
			completedAt: ZERO,
			consumed: ZERO,
			degraded: false,
			generation: ZERO,
			message: match(activity)
				.with({ state: "failed" }, ({ message }) => message)
				.otherwise(() => ""),
			quiet: false,
		},
		initial: activity.state,
		states: {
			asleep: { type: "final" },
			awake: {
				initial: "starting",
				invoke: {
					id: "hints",
					src: "hints",
					onError: {
						actions: assign({ message: ({ event }) => scanFailure(input, event.error, report) }),
						target: "#colony.failed",
					},
				},
				on: {
					HINT: { actions: "hint" },
					HINT_FAILURE: { actions: ["degrade", sendTo("hints", { type: "DISPOSE" })] },
				},
				states: {
					starting: { on: { WATCH_READY: "busy", STOP: "#colony.asleep" } },
					busy: {
						entry: assign({ consumed: ({ context }) => context.generation }),
						initial: "running",
						invoke: {
							onDone: [
								{ guard: "draining", target: "#colony.asleep" },
								{
									actions: [
										assign({
											completedAt: () => services.now(),
											quiet: ({ event }) => event.output.quiet,
										}),
										sendTo("hints", ({ event }) => ({
											type: "UPDATE",
											directories: event.output.directories,
										})),
									],
									target: "idle",
								},
							],
							onError: {
								actions: assign({
									message: ({ event }) => scanFailure(input, event.error, report),
								}),
								target: "#colony.failed",
							},
							src: "scan",
						},
						states: {
							draining: {
								entry: sendTo("hints", { type: "DISPOSE" }),
								on: { HINT: {}, HINT_FAILURE: {} },
							},
							running: { on: { STOP: "draining" } },
						},
					},
					idle: {
						after: { nextScan: "busy" },
						on: {
							HINT: { actions: "hint", target: "idle", reenter: true },
							HINT_FAILURE: {
								actions: ["degrade", sendTo("hints", { type: "DISPOSE" })],
								target: "idle",
								reenter: true,
							},
							STOP: "#colony.asleep",
						},
					},
				},
			},
			failed: { on: { STOP: "asleep" } },
		},
	});
	const options: Pick<ActorOptions<AnyActorLogic>, "clock"> = {};
	if (services.clock !== undefined) {
		options.clock = services.clock;
	}
	return createActor(machine, options);
}

// --- Private functions ---
/** Retained state chooses cadence and subscriptions, never native or process authority. */
function retainedScanState({ repository, store }: DispatchInput) {
	const records = store
		.requests(repository.root)
		.filter(({ state, host }) => state !== "terminal" && host === hostname());
	const attempts = store.currentAttempts(repository.root);
	return {
		directories: attempts.map(({ receipt }) => receipt.directory),
		signature: JSON.stringify({
			records,
			attempts: attempts.map(({ id, state }) => ({ id, state })),
		}),
		stable: records.every(
			(record) =>
				record.state === "executing" &&
				attempts.some(({ id, state }) => id === record.context.attemptId && state === "running"),
		),
	};
}

function scanFailure(
	input: DispatchInput,
	error: unknown,
	report: (message: string) => void,
): string {
	let message = String(error);
	if (error instanceof Error) {
		({ message } = error);
	}
	if (isBeadsConflict(error)) {
		message = formatBeadsConflict(error, {
			...input.repository,
			host: hostname(),
			operation: "Colony dispatch",
		});
	}
	report(`Colony ${input.repository.root} failed: ${message}`);
	return message;
}
