import type {
	ColonyEvent,
	ColonyEventCursor,
	ColonyEventMessage,
	ColonyEventSubscription,
} from "./colony-events.ts";
import {
	ColonyEventStreamError,
	colonyEventErrorSchema,
	colonyEventMessageSchema,
	colonyEventSubscriptionSchema,
} from "./colony-events.ts";
import { EventSourceParserStream } from "eventsource-parser/stream";

const MAX_MESSAGE_CHARACTERS = 1_048_576;

export interface ColonyEventConsumerOptions {
	/** Selected daemon's Unix socket. The initial client uses Bun's Unix-socket fetch. */
	socket: string;
	/** Selected daemon state directory, checked by the server. */
	state: string;
	/** Explicit colony/type selection and replay position. */
	subscription: ColonyEventSubscription;
	/** Cancels both the open connection and a pending read. */
	signal?: AbortSignal | undefined;
}

export interface ColonyListenerOptions {
	/** Unix socket of the selected daemon. */
	socket: string;
	/** Private state directory of that daemon, not the listener's checkpoint location. */
	state: string;
	/** Exact repository/tracker pairs this listener handles. */
	colonies: ColonyEventSubscription["colonies"];
	/** Starting point used only when no saved checkpoint exists. */
	start: ColonyEventSubscription["start"];
	/** Consumer-owned progress; use a separate checkpoint for each listener and selection. */
	checkpoint: {
		/** Return the last successfully processed position, or undefined for a new consumer. */
		load: () => Promise<ColonyEventCursor | undefined>;
		/** Durably save progress after all matching handlers succeed. */
		save: (cursor: ColonyEventCursor) => Promise<void>;
	};
}

type EventHandler<EventType extends ColonyEvent["type"]> = (
	event: Extract<ColonyEvent, { type: EventType }>,
) => void | Promise<void>;

/** Typed listener authoring; register handlers before running one stream per instance. */
export class ColonyListener {
	readonly #options: ColonyListenerOptions;
	readonly #handlers = new Map<ColonyEvent["type"], EventHandler<ColonyEvent["type"]>[]>();

	constructor(options: ColonyListenerOptions) {
		this.#options = options;
	}

	/** Matching async handlers run serially; a rejection stops this consumer without checkpointing. */
	on<EventType extends ColonyEvent["type"]>(
		type: EventType,
		handler: EventHandler<EventType>,
	): this {
		const handlers = this.#handlers.get(type) ?? [];
		// TypeScript cannot correlate a generic discriminator with its indexed callback type.
		handlers.push((event) => handler(event as Extract<ColonyEvent, { type: EventType }>));
		this.#handlers.set(type, handlers);
		return this;
	}

	/** Caller owns startup and retry policy. Effects may repeat after an interrupted checkpoint save. */
	// eslint-disable-next-line max-statements -- Restore progress, run ordered handlers and save only completed effects in one consumer lifetime.
	async run(signal?: AbortSignal): Promise<void> {
		const options = this.#options;
		const cursor = await options.checkpoint.load();
		let { start } = options;
		if (cursor) {
			start = { kind: "after", cursor };
		}
		const stream = subscribeColonyEvents({
			socket: options.socket,
			state: options.state,
			subscription: {
				colonies: options.colonies,
				types: [...this.#handlers.keys()],
				start,
			},
			signal,
		});
		for await (const message of stream) {
			if (message.kind === "event") {
				for (const handler of this.#handlers.get(message.event.type)!) {
					// eslint-disable-next-line no-await-in-loop -- Complete ordered effects before persisting this event's checkpoint.
					await handler(message.event);
				}
				await options.checkpoint.save(message.event.cursor);
			} else {
				await options.checkpoint.save(message.cursor);
			}
		}
	}
}

/**
 * Subscribe once. Save a message's cursor only after its effects complete.
 * Reconnection/retry policy belongs to the caller; interruption can repeat effects.
 */
// eslint-disable-next-line max-statements -- Keep socket acquisition, streaming, cancellation and cleanup in one lifetime.
export async function* subscribeColonyEvents(
	options: ColonyEventConsumerOptions,
): AsyncGenerator<ColonyEventMessage> {
	const subscription = colonyEventSubscriptionSchema.parse(options.subscription);
	const controller = new AbortController();
	let { signal } = controller;
	if (options.signal) {
		signal = AbortSignal.any([options.signal, controller.signal]);
	}
	try {
		const response = await fetch("http://localhost/events", {
			method: "POST",
			unix: options.socket,
			headers: { "content-type": "application/json", "x-colony-state": options.state },
			body: JSON.stringify(subscription),
			signal,
		});
		if (!response.ok) {
			throw new ColonyEventStreamError(colonyEventErrorSchema.parse(await response.json()));
		}
		if (!response.body || response.headers.get("content-type") !== "text/event-stream") {
			throw new Error("Expected a Colony event stream");
		}
		const messages = response.body.pipeThrough(new TextDecoderStream()).pipeThrough(
			new EventSourceParserStream({
				onError: "terminate",
				maxBufferSize: MAX_MESSAGE_CHARACTERS,
			}),
		);
		const reader = messages.getReader();
		try {
			while (true) {
				// eslint-disable-next-line no-await-in-loop -- Reads follow stream backpressure and must remain ordered.
				const { value, done } = await reader.read();
				if (done) {
					return;
				}
				const message = colonyEventMessageSchema.parse(JSON.parse(value.data));
				if (message.kind === "error") {
					throw new ColonyEventStreamError(message);
				}
				yield message;
			}
		} finally {
			// Abort the socket before releasing transforms; awaiting iterator cancellation can stall on an idle stream.
			controller.abort();
			reader.releaseLock();
		}
	} finally {
		controller.abort();
	}
}
