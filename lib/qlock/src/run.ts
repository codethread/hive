import { EXIT, QlockError, advanceQueue, enqueue, finish, reserve, ticketById } from "./queue.ts";
import type { QueueState, Ticket } from "./queue.ts";

const POLL_MS = 1000;
const PROGRESS_MS = 15_000;
const FIRST_POSITION = 1;
const MILLISECONDS_PER_SECOND = 1000;
const FOREVER = -1;

export type LockTarget =
	| {
			/** Explicit caller-supplied lock path. */
			kind: "path";
			/** Path relative to the calling directory. */
			path: string;
	  }
	| {
			/** Repository/destination-specific merge queue. */
			kind: "merge";
			/** Full local branch ref. */
			ref: string;
	  };

export type TicketRequest =
	| {
			/** Join the queue with a new ticket. */
			kind: "new";
			/** Urgent-lane justification, or null for ordinary FIFO order. */
			urgent: string | null;
	  }
	| {
			/** Resume an existing ticket without reallocating or reprioritizing it. */
			kind: "existing";
			/** Ticket ID within the selected lock. */
			id: number;
	  };

interface ExecOperation {
	/** Join or resume, wait, and execute in one invocation. */
	kind: "exec";
	/** New admission or an existing place in the queue. */
	ticket: TicketRequest;
	/** Command and literal arguments, supplied again on resume. */
	command: string[];
	/** Whole seconds to wait, or -1 for an unbounded wait. */
	waitSeconds: number;
	/** Exit status when the ticket remains queued at the deadline. */
	timeoutCode: number;
}

export type Operation =
	| {
			/** Inspect the queue after advancing it; never allocate a ticket. */
			kind: "status";
	  }
	| ExecOperation;

export interface Request {
	/** Parsed action; only relevant options are present. */
	operation: Operation;
	/** Queue identity, resolved by the native adapter. */
	target: LockTarget;
}

export interface QueueStore {
	/** Atomically read, transform and persist state under one interprocess transaction. */
	update: (transform: (state: QueueState) => QueueState) => QueueState;
	/** Release the database connection, not the running-command reservation. */
	close: () => void;
}

export interface Dependencies {
	/** Resolve an explicit path or validate and derive a merge queue. */
	resolveLock: (target: LockTarget) => Promise<string>;
	/** Open a local queue; initialization errors propagate. */
	openQueue: (lock: string) => Promise<QueueStore>;
	/** Epoch milliseconds used for ready windows and elapsed waits. */
	now: () => number;
	/** Yield between queue observations. */
	sleep: (milliseconds: number) => Promise<void>;
	/** Check whether a recorded qlock PID is still alive; unknown errors propagate. */
	isAlive: (pid: number) => boolean;
	/** Run a foreground child, forwarding signals and preserving its exit status. */
	execute: (command: string[]) => Promise<number>;
	/** Current qlock process identity. */
	pid: number;
	/** Original calling directory, recorded with new tickets. */
	cwd: string;
	/** Result and help output. */
	stdout: (text: string) => void;
	/** Human progress and error output. */
	stderr: (text: string) => void;
}

export type Outcome =
	| {
			/** Child streams were inherited; no metadata document follows them. */
			kind: "executed";
			/** Actual child status. */
			code: number;
	  }
	| {
			/** Complete ordered queue observation. */
			kind: "status";
			/** Resolved queue path. */
			lock: string;
			/** Tickets in serving order. */
			tickets: Ticket[];
	  };

/** Coordinate queue transitions without constructing filesystem or process dependencies. */
// Keep queue acquisition, execution cleanup and failure context in one lifecycle.
// eslint-disable-next-line max-statements
export async function runRequest(request: Request, deps: Dependencies): Promise<Outcome> {
	const { operation } = request;
	let id: number | undefined = undefined;
	if (operation.kind === "exec" && operation.ticket.kind === "existing") {
		({ id } = operation.ticket);
	}
	let lock: string | undefined = undefined;
	try {
		lock = await deps.resolveLock(request.target);
		const store = await deps.openQueue(lock);
		try {
			if (operation.kind === "status") {
				return { kind: "status", lock, tickets: refresh(store, deps).tickets };
			}
			if (operation.ticket.kind === "new") {
				const { urgent } = operation.ticket;
				const queue = refresh(store, deps, (state) => enqueue(state, deps.cwd, urgent));
				id = queue.nextId - FIRST_POSITION;
			} else {
				({ id } = operation.ticket);
			}
			const ticket = id;
			await reserveTurn(store, deps, { ...operation, ticket });
			try {
				return { kind: "executed", code: await deps.execute(operation.command) };
			} finally {
				store.update((state) => finish(state, ticket));
			}
		} finally {
			store.close();
		}
	} catch (error) {
		const failure = normalizeError(error);
		if (lock !== undefined) {
			failure.context.lock = lock;
		}
		if (id !== undefined) {
			failure.context.ticket = id;
		}
		throw failure;
	}
}

export function normalizeError(error: unknown): QlockError {
	if (error instanceof QlockError) {
		return error;
	}
	if (error instanceof Error) {
		return new QlockError("execution_failed", error.message);
	}
	return new QlockError("execution_failed", String(error));
}

// --- Private functions ---

function refresh(
	store: QueueStore,
	deps: Dependencies,
	transform = (state: QueueState) => state,
): QueueState {
	return store.update((state) => {
		const live = new Set([deps.pid]);
		for (const ticket of state.tickets) {
			if (ticket.state === "running" && deps.isAlive(ticket.pid)) {
				live.add(ticket.pid);
			}
		}
		const now = deps.now();
		return advanceQueue(transform(advanceQueue(state, now, live)), now, live);
	});
}

/** Inspect readiness and claim the turn in the same state transaction. */
// eslint-disable-next-line max-statements -- Keep the bounded wait and its atomic claim in one lifecycle.
async function reserveTurn(
	store: QueueStore,
	deps: Dependencies,
	operation: Omit<ExecOperation, "ticket"> & { ticket: number },
): Promise<void> {
	const { ticket: id } = operation;
	const started = deps.now();
	let progressAt = started;
	while (true) {
		let reserved = false;
		const queue = refresh(store, deps, (state) => {
			const ticket = ticketById(state, id);
			if (ticket.state === "running") {
				throw new QlockError("not_ready", `Ticket ${id} is already running`, EXIT.queued, {
					ticket: id,
				});
			}
			if (ticket.state === "queued") {
				return state;
			}
			reserved = true;
			return reserve(state, id, {
				command: operation.command,
				pid: deps.pid,
				startedAt: deps.now(),
			});
		});
		if (reserved) {
			return;
		}
		const elapsed = deps.now() - started;
		const position = queue.tickets.findIndex((ticket) => ticket.id === id) + FIRST_POSITION;
		if (
			operation.waitSeconds !== FOREVER &&
			elapsed >= operation.waitSeconds * MILLISECONDS_PER_SECOND
		) {
			throw new QlockError(
				"timed_out",
				`Ticket ${id} still queued (#${position}/${queue.tickets.length}); resume with --ticket ${id} before --`,
				operation.timeoutCode,
				{ ticket: id, position, total: queue.tickets.length },
			);
		}
		if (deps.now() >= progressAt) {
			deps.stderr(`qlock: ticket ${id} waiting #${position}/${queue.tickets.length}\n`);
			progressAt = deps.now() + PROGRESS_MS;
		}
		// eslint-disable-next-line no-await-in-loop -- Poll only after the preceding observation, never concurrently.
		await deps.sleep(POLL_MS);
	}
}
