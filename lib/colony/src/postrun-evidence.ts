/* eslint-disable unicorn/no-null -- Missing native counters remain unknown rather than zero. */
// eslint-disable-next-line import/no-nodejs-modules -- Codex's native default applies when CODEX_HOME is not supplied.
import { homedir } from "node:os";
// eslint-disable-next-line import/no-nodejs-modules -- Locate only the exact native thread named by the owned stdout log.
import { join } from "node:path";
import { z } from "zod";

const MAX_LOG_BYTES = 16_777_216;
const ZERO = 0;
const ONE = 1;
const usageSchema = z.object({
	cached_input_tokens: z.number().int().nonnegative(),
	input_tokens: z.number().int().nonnegative(),
	output_tokens: z.number().int().nonnegative(),
});
const threadEventSchema = z.object({ type: z.literal("thread.started"), thread_id: z.string() });
const usageEventSchema = z.object({ type: z.literal("turn.completed"), usage: usageSchema });
const sessionSchema = z.object({
	type: z.literal("session_meta"),
	payload: z.object({ id: z.string() }),
});
const tokenEventSchema = z.object({
	type: z.literal("event_msg"),
	payload: z.object({
		type: z.literal("token_count"),
		info: z.object({ total_token_usage: usageSchema, last_token_usage: usageSchema }),
	}),
});
const countersSchema = z.strictObject({
	input: z.number(),
	cachedInput: z.number(),
	output: z.number(),
});
const threadCountersSchema = countersSchema.extend({
	id: z.string().nullable(),
	/** Input to the first recorded native model call, not a measurement of wasted orientation. */
	firstInput: z.number().nullable(),
});
export const tokenEvidenceSchema = z.strictObject({
	/** Latest cumulative counters per thread; cached input is included in input. */
	measured: countersSchema.nullable(),
	/** Thread identities expose resumed counters that can overlap across attempts. */
	threads: z.array(threadCountersSchema),
	/** Scoped native source paths only; never copied transcript content. */
	sources: z.array(z.string()),
	/** Assigning work to an onboarding phase remains a heuristic judgment. */
	orientation: z.literal("unavailable"),
	/** Missing events, bounded reads and cumulative-counter caveats. */
	uncertainty: z.array(z.string()),
});
export type TokenEvidence = z.infer<typeof tokenEvidenceSchema>;
type ThreadCounters = z.infer<typeof threadCountersSchema>;

/** Exec turn totals and native rollout token_count totals are cumulative, not increments. */
// eslint-disable-next-line max-statements -- Fold the two native event shapes once without summing repeated snapshots.
export function codexTokenEvidence(lines: string[]): TokenEvidence {
	const threads = new Map<string | null, ThreadCounters>();
	let thread: string | null = null;
	let malformed = false;
	for (const line of lines) {
		const event = parseEvent(line);
		malformed ||= event === undefined;
		const started = threadEventSchema.safeParse(event);
		const session = sessionSchema.safeParse(event);
		if (started.success) {
			thread = started.data.thread_id;
		} else if (session.success) {
			thread = session.data.payload.id;
		}
		const completed = usageEventSchema.safeParse(event);
		const native = tokenEventSchema.safeParse(event);
		let usage: z.infer<typeof usageSchema> | undefined = undefined;
		let firstInput = threads.get(thread)?.firstInput ?? null;
		if (completed.success) {
			({ usage } = completed.data);
		} else if (native.success) {
			usage = native.data.payload.info.total_token_usage;
			firstInput ??= native.data.payload.info.last_token_usage.input_tokens;
		}
		if (usage !== undefined) {
			threads.set(thread, {
				id: thread,
				input: usage.input_tokens,
				cachedInput: usage.cached_input_tokens,
				output: usage.output_tokens,
				firstInput,
			});
		}
	}
	const uncertainty = [
		"Orientation attribution is not measured. First-call input, where present, includes all initial context and is not wasted-token accounting.",
		"Counters are thread-cumulative observations, not attempt deltas or unique document tokens. Cached input is a subset. Do not add overlapping resumed-thread totals.",
	];
	if (threads.has(null)) {
		uncertainty.push("Thread identity unavailable; cross-attempt overlap cannot be established.");
	}
	if (malformed) {
		uncertainty.push("Some log lines were not native JSON events; coverage may be incomplete.");
	}
	if (threads.size === ZERO) {
		uncertainty.push("No native usage counters found.");
	}
	return {
		measured: sumCounters([...threads.values()]),
		threads: [...threads.values()],
		sources: [],
		orientation: "unavailable",
		uncertainty,
	};
}

/** Read only owned stdout and exact thread-matched rollouts; missing telemetry is visible coverage. */
// eslint-disable-next-line max-statements -- Keep source selection and cross-source cumulative-counter deduplication adjacent.
export async function readTokenEvidence(
	path: string,
	harness: string,
	codexHome = process.env["CODEX_HOME"] ?? join(homedir(), ".codex"),
): Promise<TokenEvidence> {
	const lines = await boundedLines(path);
	if (harness !== "codex" || lines === undefined) {
		return {
			...codexTokenEvidence([]),
			uncertainty: ["Native Codex stdout unavailable, unsupported or above the 16 MiB read bound."],
		};
	}
	const evidence = codexTokenEvidence(lines);
	evidence.sources.push(path);
	const ids = new Set<string>();
	for (const line of lines) {
		const event = threadEventSchema.safeParse(parseEvent(line));
		if (event.success && z.uuid().safeParse(event.data.thread_id).success) {
			ids.add(event.data.thread_id);
		}
	}
	for (const id of ids) {
		// eslint-disable-next-line no-await-in-loop -- Read at most one exact, validated native thread per observed identity.
		const rollout = await readRollout(codexHome, id);
		if (rollout.kind === "unavailable") {
			evidence.uncertainty.push(`Thread ${id}: ${rollout.reason}`);
		} else {
			const { source, native } = rollout;
			evidence.sources.push(source);
			const index = evidence.threads.findIndex((item) => item.id === id);
			const existing = evidence.threads[index];
			if (existing === undefined) {
				evidence.threads.push(native);
			} else if (native.input >= existing.input && native.output >= existing.output) {
				evidence.threads[index] = native;
			} else {
				existing.firstInput = native.firstInput;
				evidence.uncertainty.push(`Thread ${id}: stdout has newer totals than the native rollout.`);
			}
		}
	}
	evidence.measured = sumCounters(evidence.threads);
	if (evidence.measured !== null) {
		evidence.uncertainty = evidence.uncertainty.filter(
			(item) => item !== "No native usage counters found.",
		);
	}
	return evidence;
}

// --- Native data and filesystem boundaries ---
function parseEvent(line: string): unknown {
	try {
		return JSON.parse(line);
	} catch {
		return undefined;
	}
}
function sumCounters(threads: ThreadCounters[]): TokenEvidence["measured"] {
	if (threads.length === ZERO) {
		return null;
	}
	return threads.reduce(
		(total, item) => ({
			input: total.input + item.input,
			cachedInput: total.cachedInput + item.cachedInput,
			output: total.output + item.output,
		}),
		{ input: ZERO, cachedInput: ZERO, output: ZERO },
	);
}
async function boundedLines(path: string): Promise<string[] | undefined> {
	const file = Bun.file(path);
	if (!(await file.exists()) || file.size > MAX_LOG_BYTES) {
		return;
	}
	const text = await file.text();
	return text.split("\n").filter(Boolean);
}
async function readRollout(home: string, id: string) {
	const paths = await matchingRollouts(home, id);
	if (paths.length !== ONE) {
		return {
			kind: "unavailable",
			reason: "No unique native rollout; first-call evidence unavailable.",
		} as const;
	}
	const source = paths[ZERO]!;
	const lines = await boundedLines(source);
	const native = codexTokenEvidence(lines ?? []).threads.find((item) => item.id === id);
	if (!native) {
		return {
			kind: "unavailable",
			reason: "Native rollout counters unavailable or above the read bound.",
		} as const;
	}
	return { kind: "available", source, native } as const;
}
async function matchingRollouts(home: string, id: string): Promise<string[]> {
	try {
		return await Array.fromAsync(
			new Bun.Glob(`**/rollout-*${id}.jsonl`).scan({ cwd: join(home, "sessions"), absolute: true }),
		);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return [];
		}
		throw error;
	}
}
