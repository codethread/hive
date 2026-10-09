import { z } from "zod";

export const READY_WINDOW_MS = 30_000;
export const EXIT = { success: 0, failure: 1, usage: 2, gone: 3, queued: 75 } as const;
const FIRST_ID = 1;
const HEAD = 0;

const identity = {
	id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
	cwd: z.string().min(FIRST_ID),
	urgent: z.string().min(FIRST_ID).nullable(),
};
const timestamp = z.number().int().nonnegative();
const commandSchema = z.array(z.string()).min(FIRST_ID);
const ticketSchema = z.discriminatedUnion("state", [
	z.strictObject({ ...identity, state: z.literal("queued") }),
	z.strictObject({ ...identity, state: z.literal("ready"), readyAt: timestamp }),
	z.strictObject({
		...identity,
		state: z.literal("running"),
		pid: z.number().int().positive(),
		command: commandSchema,
		startedAt: timestamp,
	}),
]);
const queueSchema = z
	.strictObject({ nextId: identity.id, tickets: z.array(ticketSchema) })
	.refine(
		(queue) =>
			new Set(queue.tickets.map(({ id }) => id)).size === queue.tickets.length &&
			queue.tickets.every(({ id }) => id < queue.nextId) &&
			queue.tickets.filter(({ state }) => state !== "queued").length <= FIRST_ID,
		"Queue IDs or reservations are inconsistent",
	);

interface TicketIdentity {
	/** Monotonically increasing ID within this lock. */
	id: number;
	/** Directory of the caller that joined the queue. */
	cwd: string;
	/** Urgent-lane justification, or null for the ordinary FIFO lane. */
	urgent: string | null;
}

export type Ticket = TicketIdentity &
	(
		| {
				/** Waiting for an unreserved turn. */
				state: "queued";
		  }
		| {
				/** A turn reserved for a bounded exec window. */
				state: "ready";
				/** Reservation time in epoch milliseconds. */
				readyAt: number;
		  }
		| {
				/** A command owns the turn until its qlock process exits. */
				state: "running";
				/** Owning qlock process, not its child. */
				pid: number;
				/** Exact command argument vector. */
				command: string[];
				/** Start time in epoch milliseconds. */
				startedAt: number;
		  }
	);

export interface QueueState {
	/** Next unallocated ticket ID; never reused after completion. */
	nextId: number;
	/** Tickets in serving order, with at most one ready or running head. */
	tickets: Ticket[];
}

export interface FailureContext {
	/** Resolved lock when available. */
	lock?: string;
	/** Ticket retained by a failed or timed-out operation. */
	ticket?: number;
	/** One-based position when the ticket still exists. */
	position?: number;
	/** Number of tickets in the same queue. */
	total?: number;
}

export type FailureReason =
	| "usage"
	| "ticket_limit"
	| "ticket_gone"
	| "not_ready"
	| "timed_out"
	| "execution_failed"
	| "repository_lookup_failed"
	| "queue_busy";

export class QlockError extends Error {
	/** Stable machine-readable failure discriminator. */
	readonly reason: FailureReason;
	/** Documented process exit status. */
	readonly exitCode: number;
	/** Facts known before the operation failed. */
	readonly context: FailureContext;
	// eslint-disable-next-line max-params -- A typed failure carries reason, message, status and context together.
	constructor(
		reason: FailureReason,
		message: string,
		exitCode: number = EXIT.failure,
		context: FailureContext = {},
	) {
		super(message);
		this.name = "QlockError";
		this.reason = reason;
		this.exitCode = exitCode;
		this.context = context;
	}
}

/** Validate persisted state once, before it reaches the pure queue operations. */
export function parseQueue(value: unknown): QueueState {
	return queueSchema.parse(value);
}

export function emptyQueue(): QueueState {
	return { nextId: FIRST_ID, tickets: [] };
}

/** Drop expired reservations and dead runners, preserving an already-owned turn. */
export function advanceQueue(
	queue: QueueState,
	now: number,
	livePids: ReadonlySet<number>,
): QueueState {
	const tickets = queue.tickets
		.filter((ticket) => {
			if (ticket.state === "running") {
				return livePids.has(ticket.pid);
			}
			if (ticket.state === "ready") {
				return now - ticket.readyAt < READY_WINDOW_MS;
			}
			return true;
		})
		.toSorted(compareTickets);
	const [head] = tickets;
	if (head?.state === "queued") {
		tickets[HEAD] = { ...head, state: "ready", readyAt: now };
	}
	return { ...queue, tickets };
}

export function enqueue(queue: QueueState, cwd: string, urgent: string | null): QueueState {
	if (queue.nextId === Number.MAX_SAFE_INTEGER) {
		throw new QlockError("ticket_limit", "Ticket IDs exhausted for this lock");
	}
	return {
		nextId: queue.nextId + FIRST_ID,
		tickets: [...queue.tickets, { id: queue.nextId, cwd, urgent, state: "queued" }],
	};
}

export function ticketById(queue: QueueState, id: number): Ticket {
	const ticket = queue.tickets.find((entry) => entry.id === id);
	if (!ticket) {
		throw new QlockError(
			"ticket_gone",
			`Ticket ${id} is gone; omit --ticket to join again`,
			EXIT.gone,
			{
				ticket: id,
			},
		);
	}
	return ticket;
}

export function reserve(
	queue: QueueState,
	id: number,
	execution: Pick<Extract<Ticket, { state: "running" }>, "command" | "pid" | "startedAt">,
): QueueState {
	const ticket = ticketById(queue, id);
	if (ticket.state !== "ready") {
		throw new QlockError("not_ready", `Ticket ${id} is not ready`, EXIT.queued, { ticket: id });
	}
	return {
		...queue,
		tickets: queue.tickets.map((entry) => {
			if (entry.id !== id) {
				return entry;
			}
			return { id, cwd: ticket.cwd, urgent: ticket.urgent, state: "running", ...execution };
		}),
	};
}

export function finish(queue: QueueState, id: number): QueueState {
	return { ...queue, tickets: queue.tickets.filter((ticket) => ticket.id !== id) };
}

// --- Private functions ---

function compareTickets(left: Ticket, right: Ticket): number {
	return (
		Number(left.state === "queued") - Number(right.state === "queued") ||
		Number(left.urgent === null) - Number(right.urgent === null) ||
		left.id - right.id
	);
}
