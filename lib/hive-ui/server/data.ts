/* eslint-disable unicorn/no-null -- API contracts represent absent recorded facts explicitly. */
import type { Bee, Board, BoardFilter, Card, Colony, Detail, Provenance } from "../contracts.ts";
import {
	COLONY_OBSERVATION_PREFIX,
	beadSchema,
	beads,
	latestColonyObservation,
	readSpawnRequest,
} from "@hive/shared";
import { PAGE_SIZE, taskQuery } from "../contracts.ts";
import { z } from "zod";

const MAX_REQUESTS = 100;
const MAX_ANCESTORS = 8;
const INVENTORY_TTL_MS = 10_000;
const nativeSchema = beadSchema.extend({ created_by: z.string().optional(), title: z.string() });
const nativeListSchema = z.object({ issues: z.array(nativeSchema) });
type NativeBead = z.infer<typeof nativeSchema>;
interface Inventory {
	/** Only open requests in this endpoint; never full spawn history. */
	bees: Bee[];
	/** Source read time, unchanged when a cached inventory is reused. */
	readAt: string;
}
interface ReadContext {
	/** Server-selected diagnostics sink; machine mode uses a file. */
	log: (sample: object) => Promise<void>;
	/** Explicit startup allowlist entry, not a browser-supplied filesystem path. */
	colony: Colony;
	/** Correlates HTTP and native command timings. */
	requestId: string;
}

/** Owns native reads and a short-lived, endpoint-scoped open-request inventory. */
export function createBoardData() {
	const inventories = new Map<string, Promise<Inventory>>();
	// eslint-disable-next-line max-statements -- Coalesce endpoint reads while retaining the original source freshness.
	const inventory = async (context: ReadContext, fresh: boolean): Promise<Inventory> => {
		const key = context.colony.id;
		const existing = inventories.get(key);
		if (existing && !fresh) {
			const value = await existing;
			if (Date.now() - Date.parse(value.readAt) < INVENTORY_TTL_MS) {
				return value;
			}
		}
		const pending = readInventory(context);
		inventories.set(key, pending);
		try {
			return await pending;
		} catch (error) {
			inventories.delete(key);
			throw error;
		}
	};
	return {
		board: async (context: ReadContext, filter: BoardFilter, fresh: boolean): Promise<Board> => {
			const current = await inventory(context, fresh);
			const taskIds = [...new Set(current.bees.flatMap((request) => request.taskIds))];
			const args = taskQuery(filter, taskIds);
			// An empty --id group means all tasks to br, so empty membership needs no query.
			const { tasks, query } = await readTasks(context, args, taskIds);
			const cards = tasks.slice(0, PAGE_SIZE).map((bead) => card(bead, current.bees));
			return {
				bees: current.bees,
				cards,
				fetchedAt: new Date().toISOString(),
				hasMore: tasks.length > PAGE_SIZE,
				inventoryReadAt: current.readAt,
				labels: [...new Set(cards.flatMap((item) => item.labels))].toSorted(),
				query,
			};
		},
		detail: async (context: ReadContext, id: string): Promise<Detail> => {
			const [current, bead] = await Promise.all([inventory(context, false), show(context, id)]);
			return {
				card: card(bead, current.bees),
				comments: bead.comments.map((comment) => ({
					at: comment.created_at,
					author: comment.author,
					id: comment.id,
					text: comment.text,
				})),
				description: bead.description,
				fetchedAt: new Date().toISOString(),
			};
		},
		provenance: readProvenance,
	};
}

// --- Native I/O and projections ---
async function readTasks(
	context: ReadContext,
	args: string[],
	taskIds: string[],
): Promise<{ tasks: NativeBead[]; query: string[] }> {
	if (taskIds.length === 0) {
		return { query: [], tasks: [] };
	}
	const tasks = nativeListSchema.parse(await read(context, args)).issues;
	const query = [
		"br",
		...args,
		"--no-auto-import",
		"--no-auto-flush",
		"--db",
		context.colony.beadsDb,
		"--actor",
		"hive-ui",
		"--json",
	];
	return { query, tasks };
}

// eslint-disable-next-line max-statements -- Native execution telemetry covers success, size and failure in one boundary.
async function read(context: ReadContext, args: string[]): Promise<unknown> {
	const started = performance.now();
	let outcome = "error";
	let bytes = 0;
	let failure: string | undefined = undefined;
	try {
		const value = await beads(context.colony, "hive-ui", [
			...args,
			"--no-auto-import",
			"--no-auto-flush",
		]);
		bytes = new TextEncoder().encode(JSON.stringify(value)).length;
		outcome = "ok";
		return value;
	} catch (error) {
		failure = String(error);
		throw error;
	} finally {
		const ms = Math.round(performance.now() - started);
		await context.log({
			args,
			bytes,
			colony: context.colony.id,
			failure,
			ms,
			operation: args[0],
			outcome,
			requestId: context.requestId,
			scope: "native",
		});
	}
}

async function show(context: ReadContext, id: string): Promise<NativeBead> {
	return z
		.array(nativeSchema)
		.length(1)
		.parse(await read(context, ["show", id]))[0]!;
}

async function readInventory(context: ReadContext): Promise<Inventory> {
	const listing = nativeListSchema.parse(
		await read(context, [
			"list",
			"--label",
			"system",
			"--label",
			"bee",
			"--status",
			"open",
			"--limit",
			String(MAX_REQUESTS + 1),
		]),
	);
	if (listing.issues.length > MAX_REQUESTS) {
		throw new Error(
			`This MVP supports up to ${MAX_REQUESTS} open requests per colony. Narrow the tracker before loading the board.`,
		);
	}
	const ids = listing.issues.map((issue) => issue.id);
	let requests: NativeBead[] = [];
	if (ids.length > 0) {
		requests = z.array(nativeSchema).parse(await read(context, ["show", ...ids]));
	}
	return { bees: requests.map((request) => bee(request)), readAt: new Date().toISOString() };
}

function bee(bead: NativeBead): Bee {
	const request = readSpawnRequest(bead);
	const observed = latestColonyObservation(bead);
	let observation: Bee["observation"] = null;
	if (observed) {
		observation = {
			at: observed.created_at,
			author: observed.author,
			text: observed.text.slice(COLONY_OBSERVATION_PREFIX.length).trim(),
		};
	}
	return {
		harness: request.recipe.harness,
		id: request.id,
		identity: request.identity,
		kind: request.recipe.kind,
		model: request.recipe.model,
		observation,
		requester: bead.created_by ?? null,
		status: bead.status,
		taskIds: request.taskIds,
	};
}

function card(bead: NativeBead, bees: Bee[]): Card {
	return {
		assignee: bead.assignee ?? null,
		bees: bees.filter((item) => item.taskIds.includes(bead.id)),
		id: bead.id,
		labels: bead.labels,
		priority: bead.priority,
		status: bead.status,
		title: bead.title,
		updatedAt: bead.updated_at,
	};
}

/** Traverse only requested ancestry. Names are attribution, never unique parent keys. */
// eslint-disable-next-line max-statements -- Bounded traversal keeps ambiguity, cycles and recorded attribution together.
async function readProvenance(context: ReadContext, id: string): Promise<Provenance> {
	const chain: Bee[] = [];
	const seen = new Set<string>();
	let current = await show(context, id);
	let end: Provenance["end"] = { kind: "limit" };
	/* eslint-disable no-await-in-loop -- Each ancestry step depends on the recorded requester in its predecessor. */
	for (let depth = 0; depth < MAX_ANCESTORS; depth++) {
		if (seen.has(current.id)) {
			end = { id: current.id, kind: "cycle" };
			break;
		}
		seen.add(current.id);
		const item = bee(current);
		chain.push(item);
		if (item.requester === null) {
			end = { kind: "unmatched", requester: null };
			break;
		}
		const matches = nativeListSchema.parse(
			await read(context, [
				"list",
				"--label",
				"system",
				"--label",
				"bee",
				"--assignee",
				item.requester,
				"--all",
				"--limit",
				"3",
			]),
		).issues;
		if (matches.length === 0) {
			end = { kind: "unmatched", requester: item.requester };
			break;
		}
		if (matches.length > 1) {
			end = {
				candidates: matches.map((match) => match.id),
				kind: "ambiguous",
				requester: item.requester,
			};
			break;
		}
		current = await show(context, matches[0]!.id);
	}
	/* eslint-enable no-await-in-loop */
	return { chain, end, fetchedAt: new Date().toISOString() };
}
