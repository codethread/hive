import { compareText, parseJsonl } from "./beads-jsonl.ts";

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

type MergeResult =
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

const EMPTY_COUNT = 0;
const ORDER_EQUAL = 0;

const parseInputs = (
	ancestorContents: string,
	currentContents: string,
	otherContents: string,
): MergeInputs => {
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
};

const recordsEqual = (left: IssueRecord | undefined, right: IssueRecord | undefined): boolean =>
	left?.canonical === right?.canonical;

const equivalentRecord = (
	left: IssueRecord | undefined,
	right: IssueRecord | undefined,
): IssueRecord | undefined => {
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
};

const selectedMerge = (record: IssueRecord | undefined): RecordMerge => {
	if (record === undefined) {
		return { kind: "deleted" };
	}
	return { kind: "record", record };
};

const mergeRecord = (conflict: ConflictRecords): RecordMerge => {
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
	return { conflict, kind: "conflicted" };
};

const renderSide = (record: IssueRecord | undefined): readonly string[] => {
	if (record === undefined) {
		return [];
	}
	return [record.raw];
};

const renderConflict = ({ ancestor, current, id, other }: ConflictRecords): string =>
	[
		`<<<<<<< current (${id})`,
		...renderSide(current),
		`||||||| ancestor (${id})`,
		...renderSide(ancestor),
		"=======",
		...renderSide(other),
		`>>>>>>> other (${id})`,
	].join("\n");

const renderChunks = (chunks: readonly string[]): string => {
	if (chunks.length === EMPTY_COUNT) {
		return "";
	}
	return `${chunks.join("\n")}\n`;
};

const mergeIds = (inputs: Exclude<MergeInputs, InvalidResult>): readonly RecordMerge[] => {
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
};

const mergeIssueJsonl = (
	ancestorContents: string,
	currentContents: string,
	otherContents: string,
): MergeResult => {
	const inputs = parseInputs(ancestorContents, currentContents, otherContents);
	if (inputs.kind === "invalid") {
		return inputs;
	}
	const outcomes = mergeIds(inputs);
	const conflicts = outcomes.filter((outcome) => outcome.kind === "conflicted");
	const chunks = outcomes.flatMap((outcome) => {
		if (outcome.kind === "deleted") {
			return [];
		}
		if (outcome.kind === "record") {
			return [outcome.record.raw];
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
};

export { mergeIssueJsonl, type MergeResult };
