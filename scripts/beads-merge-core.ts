import { canonicalize, compareText, parseJsonl } from "./beads-jsonl.ts";
import { z } from "zod";

const EMPTY_COUNT = 0;
const ORDER_EQUAL = 0;
const NEXT_ID = 1;
const commentSchema = z.strictObject({
	author: z.string(),
	created_at: z.string(),
	id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
	issue_id: z.string(),
	text: z.string(),
});
const commentsSchema = z.array(commentSchema);
type Comment = z.infer<typeof commentSchema>;

type ParsedJsonl = ReturnType<typeof parseJsonl>;
type InvalidResult = Extract<ParsedJsonl, { kind: "invalid" }>;
type ParsedRecords = Extract<ParsedJsonl, { kind: "parsed" }>["records"];
type IssueRecord = ParsedRecords extends ReadonlyMap<string, infer Record> ? Record : never;

interface ConflictRecords {
	/** Issue state from the common ancestor. */
	readonly ancestor: IssueRecord | undefined;
	/** Issue state from the current branch. */
	readonly current: IssueRecord | undefined;
	/** Canonical issue identifier. */
	readonly id: string;
	/** Issue state from the branch being merged. */
	readonly other: IssueRecord | undefined;
}

type MergeInputs =
	| {
			/** Parsed common-ancestor records. */
			readonly ancestor: ReadonlyMap<string, IssueRecord>;
			/** Parsed current-branch records. */
			readonly current: ReadonlyMap<string, IssueRecord>;
			/** Indicates that all three inputs passed validation. */
			readonly kind: "parsed";
			/** Parsed records from the branch being merged. */
			readonly other: ReadonlyMap<string, IssueRecord>;
	  }
	| InvalidResult;

type RecordMerge =
	| {
			/** Indicates that this issue was removed on both effective sides. */
			readonly kind: "deleted";
	  }
	| {
			/** Indicates a compatible issue value. */
			readonly kind: "record";
			/** Record selected by the three-way merge. */
			readonly record: IssueRecord;
	  }
	| {
			/** Incompatible issue states used to render a Git conflict. */
			readonly conflict: ConflictRecords;
			/** Indicates an unresolved same-issue change. */
			readonly kind: "conflicted";
	  };

export type MergeResult =
	| {
			/** Deterministic JSONL content for Git's current-side file. */
			readonly contents: string;
			/** Indicates a complete semantic merge. */
			readonly kind: "merged";
	  }
	| {
			/** Reviewable JSONL-like content containing conflict markers. */
			readonly contents: string;
			/** Issue identifiers with incompatible changes. */
			readonly issueIds: readonly string[];
			/** Indicates incompatible changes that Git must retain as unmerged. */
			readonly kind: "conflicted";
	  }
	| InvalidResult;

// eslint-disable-next-line max-statements -- Validate comments then merge and render one file-wide ID namespace.
export function mergeIssueJsonl(
	ancestorContents: string,
	currentContents: string,
	otherContents: string,
): MergeResult {
	const inputs = parseInputs(ancestorContents, currentContents, otherContents);
	if (inputs.kind === "invalid") {
		return inputs;
	}
	for (const records of [inputs.ancestor, inputs.current, inputs.other]) {
		for (const record of records.values()) {
			const parsed = commentsSchema.safeParse(record.data.comments ?? []);
			if (!parsed.success || parsed.data.some((comment) => comment.issue_id !== record.id)) {
				return { kind: "invalid", message: `Issue ${record.id} has invalid comments` };
			}
			if (record.data.updated_at !== undefined && typeof record.data.updated_at !== "string") {
				return { kind: "invalid", message: `Issue ${record.id} has invalid updated_at` };
			}
		}
	}
	const outcomes = mergeIds(inputs);
	const records = outcomes.flatMap((outcome) => {
		if (outcome.kind === "record") {
			return [outcome.record];
		}
		return [];
	});
	const rendered = renderCommentIds(records);
	const conflicts = outcomes.filter((outcome) => outcome.kind === "conflicted");
	const chunks = outcomes.flatMap((outcome) => {
		if (outcome.kind === "deleted") {
			return [];
		}
		if (outcome.kind === "record") {
			return [rendered.get(outcome.record.id)!];
		}
		return [renderConflict(outcome.conflict)];
	});
	const contents = renderChunks(chunks);
	if (conflicts.length === EMPTY_COUNT) {
		return { contents, kind: "merged" };
	}
	return {
		contents,
		issueIds: conflicts.map(({ conflict }) => conflict.id),
		kind: "conflicted",
	};
}
// --- Private functions ---

function parseInputs(
	ancestorContents: string,
	currentContents: string,
	otherContents: string,
): MergeInputs {
	const ancestor = parseJsonl(ancestorContents, "ancestor");
	if (ancestor.kind === "invalid") {
		return ancestor;
	}
	const current = parseJsonl(currentContents, "current");
	if (current.kind === "invalid") {
		return current;
	}
	const other = parseJsonl(otherContents, "other");
	if (other.kind === "invalid") {
		return other;
	}
	return {
		ancestor: ancestor.records,
		current: current.records,
		kind: "parsed",
		other: other.records,
	};
}

function recordsEqual(left: IssueRecord | undefined, right: IssueRecord | undefined): boolean {
	return left?.canonical === right?.canonical;
}

function equivalentRecord(
	left: IssueRecord | undefined,
	right: IssueRecord | undefined,
): IssueRecord | undefined {
	if (left === undefined) {
		return right;
	}
	if (right === undefined) {
		return left;
	}
	if (compareText(left.raw, right.raw) <= ORDER_EQUAL) {
		return left;
	}
	return right;
}

function selectedMerge(record: IssueRecord | undefined): RecordMerge {
	if (record === undefined) {
		return { kind: "deleted" };
	}
	return { kind: "record", record };
}

// eslint-disable-next-line max-statements -- Keep conservative scalar selection and append-only comment union together.
function mergeRecord(conflict: ConflictRecords): RecordMerge {
	const { ancestor, current, other } = conflict;
	if (recordsEqual(current, other)) {
		return selectedMerge(equivalentRecord(current, other));
	}
	if (recordsEqual(current, ancestor)) {
		return selectedMerge(other);
	}
	if (recordsEqual(other, ancestor)) {
		return selectedMerge(current);
	}
	if (current !== undefined && other !== undefined) {
		const base = scalar(ancestor);
		const left = scalar(current);
		const right = scalar(other);
		let selected: IssueRecord | undefined = undefined;
		if (left === right) {
			selected = equivalentRecord(current, other);
		} else if (left === base) {
			selected = other;
		} else if (right === base) {
			selected = current;
		}
		if (selected !== undefined) {
			const data = { ...selected.data };
			const comments = mergeComments([ancestor, current, other]);
			if (comments.length > EMPTY_COUNT) {
				data.comments = comments;
			}
			const updated = [ancestor, current, other]
				.flatMap((record) => {
					if (typeof record?.data.updated_at === "string") {
						return [record.data.updated_at];
					}
					return [];
				})
				.toSorted(
					(first, second) => Date.parse(first) - Date.parse(second) || compareText(first, second),
				)
				.at(-NEXT_ID);
			if (updated !== undefined) {
				data.updated_at = updated;
			}
			const raw = canonicalize(data);
			return selectedMerge({ canonical: raw, data, id: selected.id, raw });
		}
	}
	return { conflict, kind: "conflicted" };
}

function scalar(record: IssueRecord | undefined): string | undefined {
	if (record === undefined) {
		return undefined;
	}
	return canonicalize(
		Object.fromEntries(
			Object.entries(record.data).filter(([key]) => key !== "comments" && key !== "updated_at"),
		),
	);
}

function commentsOf(record: IssueRecord | undefined): Comment[] {
	return (record?.data.comments ?? []) as Comment[];
}

function commentIdentity(comment: Comment): string {
	return JSON.stringify([comment.issue_id, comment.author, comment.text, comment.created_at]);
}

/** Append-only multiset union retains repeated identical comments without counting each clone twice. */
// Preserve per-side multiplicity while selecting deterministic local counters.
// eslint-disable-next-line max-statements
function mergeComments(records: readonly (IssueRecord | undefined)[]): Comment[] {
	const combined = new Map<string, Comment[]>();
	for (const record of records) {
		const side = new Map<string, Comment[]>();
		for (const comment of commentsOf(record)) {
			const key = commentIdentity(comment);
			const copies = side.get(key) ?? [];
			copies.push(comment);
			side.set(key, copies);
		}
		for (const [key, copies] of side) {
			const previous = combined.get(key) ?? [];
			const count = Math.max(previous.length, copies.length);
			const candidates = [...previous, ...copies].toSorted((left, right) => left.id - right.id);
			combined.set(key, candidates.slice(EMPTY_COUNT, count));
		}
	}
	return [...combined]
		.toSorted(([left], [right]) => compareText(left, right))
		.flatMap(([, comments]) => comments);
}

/** Local counters may collide even when different issues were changed on the two hosts. */
// eslint-disable-next-line max-statements -- Allocate counters across the whole file while preserving unchanged rows.
function renderCommentIds(records: readonly IssueRecord[]): Map<string, string> {
	const all = records.flatMap((record) => commentsOf(record));
	const reserved = new Set(all.map(({ id }) => id));
	let nextId = NEXT_ID;
	const used = new Set<number>();
	const rendered = new Map<string, string>();
	for (const record of records) {
		let changed = false;
		const comments: Comment[] = [];
		for (const comment of commentsOf(record)) {
			let { id } = comment;
			if (used.has(id)) {
				while (reserved.has(nextId)) {
					nextId += NEXT_ID;
				}
				id = nextId;
				reserved.add(id);
				nextId += NEXT_ID;
				changed = true;
			}
			used.add(id);
			comments.push({ ...comment, id });
		}
		let contents = record.raw;
		if (changed) {
			contents = canonicalize({ ...record.data, comments });
		}
		rendered.set(record.id, contents);
	}
	return rendered;
}

function renderSide(record: IssueRecord | undefined): readonly string[] {
	if (record === undefined) {
		return [];
	}
	return [record.raw];
}

function renderConflict({ ancestor, current, id, other }: ConflictRecords): string {
	return [
		`<<<<<<< current (${id})`,
		...renderSide(current),
		`||||||| ancestor (${id})`,
		...renderSide(ancestor),
		"=======",
		...renderSide(other),
		`>>>>>>> other (${id})`,
	].join("\n");
}

function renderChunks(chunks: readonly string[]): string {
	if (chunks.length === EMPTY_COUNT) {
		return "";
	}
	return `${chunks.join("\n")}\n`;
}

function mergeIds(inputs: Exclude<MergeInputs, InvalidResult>): readonly RecordMerge[] {
	const ids = new Set([
		...inputs.ancestor.keys(),
		...inputs.current.keys(),
		...inputs.other.keys(),
	]);
	return [...ids].toSorted(compareText).map((id) =>
		mergeRecord({
			ancestor: inputs.ancestor.get(id),
			current: inputs.current.get(id),
			id,
			other: inputs.other.get(id),
		}),
	);
}
