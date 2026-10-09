import type {
	ColonyEvent,
	ColonyEventCursor,
	ColonyEventError,
	ColonyEventSubscription,
} from "@hive/shared/colony-events";
import { ColonyEventStreamError, colonyEventSchema } from "@hive/shared/colony-events";
import type { Database } from "bun:sqlite";
import { z } from "zod";

const FIRST = 0;
const ONE = 1;
const PAGE_SIZE = 64;
export const COLONY_EVENT_RETENTION = 10_000;
const rowSchema = z.array(z.strictObject({ sequence: z.number().int(), payload: z.string() }));
const boundsSchema = z.strictObject({ oldest: z.number().int(), latest: z.number().int() });
const encoder = new TextEncoder();

export type EventJournal = ReturnType<typeof openEventJournal>;

/** Durable facts and bounded, pull-driven readers; the daemon is the sole writer. */
export function openEventJournal(database: Database) {
	database.exec(`
 CREATE TABLE IF NOT EXISTS colony_event_log (id TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS colony_events (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT, root TEXT NOT NULL, beads_db TEXT NOT NULL,
 type TEXT NOT NULL, request_id TEXT NOT NULL, payload TEXT NOT NULL,
 UNIQUE(root, beads_db, type, request_id));
 CREATE INDEX IF NOT EXISTS colony_events_scope ON colony_events(root, beads_db, type, sequence);`);
	if (!database.query("SELECT id FROM colony_event_log").get()) {
		database.query("INSERT INTO colony_event_log(id) VALUES (?)").run(crypto.randomUUID());
	}
	const { id: logId } = z
		.strictObject({ id: z.uuid() })
		.parse(database.query("SELECT id FROM colony_event_log").get());
	const listeners = new Set<() => void>();
	const closers = new Set<() => void>();
	const bounds = () =>
		boundsSchema.parse(
			database
				.query(
					"SELECT COALESCE((SELECT sequence FROM colony_events ORDER BY sequence LIMIT 1), 1) AS oldest, COALESCE((SELECT sequence FROM colony_events ORDER BY sequence DESC LIMIT 1), 0) AS latest",
				)
				.get(),
		);
	const validate = (cursor: ColonyEventCursor) => {
		const range = bounds();
		if (cursor.logId !== logId) {
			throw failure("wrong_log", "Cursor belongs to a different Colony event journal");
		}
		if (cursor.sequence < range.oldest - ONE) {
			throw failure(
				"cursor_expired",
				"Cursor precedes retained Colony events; choose a new start explicitly",
			);
		}
		if (cursor.sequence > range.latest) {
			throw failure("future_cursor", "Cursor is ahead of this Colony event journal");
		}
		return range;
	};
	return {
		/** Called inside the transaction recording the corresponding domain checkpoint. */
		append(event: Omit<ColonyEvent, "cursor">): void {
			database
				.query(
					"INSERT INTO colony_events(root, beads_db, type, request_id, payload) VALUES (?, ?, ?, ?, ?) ON CONFLICT(root, beads_db, type, request_id) DO NOTHING",
				)
				.run(
					event.repository.root,
					event.repository.beadsDb,
					event.type,
					event.request.id,
					JSON.stringify(event),
				);
			database
				.query(
					"DELETE FROM colony_events WHERE sequence <= (SELECT MAX(sequence) FROM colony_events) - ?",
				)
				.run(COLONY_EVENT_RETENTION);
		},
		/** Notify only after committing. Readers fetch facts rather than queueing copies in memory. */
		notify(): void {
			for (const listener of listeners) {
				listener();
			}
		},
		cursor(): ColonyEventCursor {
			return { logId, sequence: bounds().latest };
		},
		close(): void {
			for (const close of closers) {
				close();
			}
		},
		/** The initial checkpoint establishes subscription readiness before any live producer starts. */
		// eslint-disable-next-line max-statements -- Keep subscriber query, wakeup registration and teardown in one lifetime.
		stream(subscription: ColonyEventSubscription, signal: AbortSignal): Response {
			const range = bounds();
			let cursor: ColonyEventCursor = { logId, sequence: range.latest };
			if (subscription.start.kind === "after") {
				({ cursor } = subscription.start);
			} else if (subscription.start.kind === "retained") {
				cursor = { logId, sequence: range.oldest - ONE };
			}
			validate(cursor);
			const pairs = subscription.colonies.map(() => "(?, ?)").join(", ");
			const topics = subscription.types.map(() => "?").join(", ");
			const query = database.prepare(`SELECT sequence, payload FROM colony_events
 WHERE sequence > ? AND (root, beads_db) IN (VALUES ${pairs}) AND type IN (${topics})
 ORDER BY sequence LIMIT ?`);
			const parameters = [
				...subscription.colonies.flatMap(({ root, beadsDb }) => [root, beadsDb]),
				...subscription.types,
				PAGE_SIZE,
			];
			let stopped = false;
			let wake = () => {};
			const notify = () => wake();
			let close = () => {};
			const detach = () => {
				if (stopped) {
					return;
				}
				stopped = true;
				listeners.delete(notify);
				closers.delete(close);
				signal.removeEventListener("abort", close);
				query.finalize();
				wake();
			};
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					close = () => {
						if (!stopped) {
							detach();
							controller.close();
						}
					};
					listeners.add(notify);
					closers.add(close);
					signal.addEventListener("abort", close, { once: true });
					controller.enqueue(frame({ kind: "checkpoint", cursor }));
					if (signal.aborted) {
						close();
					}
				},
				// eslint-disable-next-line max-statements -- Read one bounded page or await a commit; errors close this reader only.
				async pull(controller) {
					try {
						// eslint-disable-next-line no-unmodified-loop-condition -- Cancellation and daemon shutdown change stopped through detach.
						while (!stopped) {
							const changed = Promise.withResolvers<void>();
							wake = changed.resolve;
							const current = validate(cursor);
							const rows = rowSchema.parse(query.all(cursor.sequence, ...parameters));
							if (rows.length > FIRST) {
								const messages = rows.map(({ sequence, payload }) => {
									const event = colonyEventSchema.parse({
										...JSON.parse(payload),
										cursor: { logId, sequence },
									});
									return `data: ${JSON.stringify({ kind: "event", event })}\n\n`;
								});
								cursor = { logId, sequence: rows.at(-ONE)!.sequence };
								controller.enqueue(encoder.encode(messages.join("")));
								return;
							}
							if (current.latest > cursor.sequence) {
								cursor = { logId, sequence: current.latest };
								controller.enqueue(frame({ kind: "checkpoint", cursor }));
								return;
							}
							// Registration precedes the synchronous tail check, avoiding a replay/live gap.
							// eslint-disable-next-line no-await-in-loop -- Only a committed change or cancellation wakes this idle reader.
							await changed.promise;
						}
					} catch (error) {
						let detail: ColonyEventError = {
							kind: "error",
							code: "stream_failed",
							message: String(error),
						};
						if (error instanceof ColonyEventStreamError) {
							detail = { kind: "error", code: error.code, message: error.message };
						}
						controller.enqueue(frame(detail));
						close();
					}
				},
				cancel: detach,
			});
			return new Response(body, {
				headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
			});
		},
	};
}

// --- Private functions ---
function frame(message: unknown): Uint8Array {
	return encoder.encode(`data: ${JSON.stringify(message)}\n\n`);
}

function failure(code: ColonyEventError["code"], message: string): ColonyEventStreamError {
	return new ColonyEventStreamError({ kind: "error", code, message });
}
