import { expect, test } from "bun:test";
import { mergeIssueJsonl } from "./merge-core.ts";

const EMPTY_COUNT = 0;

function issue(id: string, title: string): string {
	return JSON.stringify({ id, title });
}

function jsonl(...records: readonly string[]): string {
	if (records.length === EMPTY_COUNT) {
		return "";
	}
	return `${records.join("\n")}\n`;
}

test("merges independent issue additions in stable ID order #test-507", () => {
	const current = jsonl(issue("hv-b", "B"));
	const other = jsonl(issue("hv-a", "A"));
	const expected = jsonl(issue("hv-a", "A"), issue("hv-b", "B"));
	expect(mergeIssueJsonl("", current, other)).toEqual({
		contents: expected,
		kind: "merged",
	});
});

test("merges changes to different existing issues", () => {
	const ancestorA = issue("hv-a", "old A");
	const ancestorB = issue("hv-b", "old B");
	const ancestor = jsonl(ancestorA, ancestorB);
	const current = jsonl(issue("hv-a", "new A"), ancestorB);
	const other = jsonl(ancestorA, issue("hv-b", "new B"));
	const expected = jsonl(issue("hv-a", "new A"), issue("hv-b", "new B"));
	expect(mergeIssueJsonl(ancestor, current, other)).toEqual({
		contents: expected,
		kind: "merged",
	});
});

test("accepts semantically identical records with different key order", () => {
	const current = '{"id":"hv-a","title":"same"}';
	const other = '{"title":"same","id":"hv-a"}';
	expect(mergeIssueJsonl("", jsonl(current), jsonl(other))).toEqual({
		contents: jsonl(current),
		kind: "merged",
	});
});

test("keeps incompatible same-issue changes as a Git conflict", () => {
	const ancestor = jsonl(issue("hv-a", "old"));
	const current = jsonl(issue("hv-a", "current"));
	const other = jsonl(issue("hv-a", "other"));
	const result = mergeIssueJsonl(ancestor, current, other);
	expect(result.kind).toBe("conflicted");
	if (result.kind !== "conflicted") {
		throw new Error("expected a conflict");
	}
	expect(result.issueIds).toEqual(["hv-a"]);
	expect(result.contents).toBe(
		[
			"<<<<<<< current (hv-a)",
			issue("hv-a", "current"),
			"||||||| ancestor (hv-a)",
			issue("hv-a", "old"),
			"=======",
			issue("hv-a", "other"),
			">>>>>>> other (hv-a)",
			"",
		].join("\n"),
	);
});

test("keeps delete-versus-edit changes as a Git conflict", () => {
	const ancestor = jsonl(issue("hv-a", "old"));
	const other = jsonl(issue("hv-a", "new"));
	expect(mergeIssueJsonl(ancestor, "", other).kind).toBe("conflicted");
});

// eslint-disable-next-line max-statements -- Keep the three-way fixture and preservation assertions in one scenario.
test("combines append-only comments with status changes and ignores local ID renumbering #test-512", () => {
	const original = { id: "hv-a", status: "open", updated_at: "2026-10-10T00:00:00Z" };
	const comment = {
		author: "colony",
		created_at: "2026-10-10T00:00:01Z",
		id: 1,
		issue_id: "hv-a",
		text: "waiting",
	};
	const ancestor = jsonl(JSON.stringify({ ...original, comments: [comment] }));
	const left = jsonl(
		JSON.stringify({
			...original,
			status: "in_progress",
			assignee: "agent-a",
			updated_at: "2026-10-10T01:00:02+01:00",
			comments: [{ ...comment, id: 99 }],
		}),
	);
	const right = jsonl(
		JSON.stringify({
			...original,
			updated_at: "2026-10-10T00:00:03Z",
			comments: [comment, { ...comment, text: "running", id: 2 }],
		}),
	);
	const result = mergeIssueJsonl(ancestor, left, right);
	expect(result.kind).toBe("merged");
	if (result.kind !== "merged") {
		throw new Error("expected compatible comment merge");
	}
	const row = JSON.parse(result.contents);
	expect(row).toMatchObject({
		status: "in_progress",
		assignee: "agent-a",
		updated_at: "2026-10-10T00:00:03Z",
	});
	expect(row.comments.map((entry: { text: string }) => entry.text).toSorted()).toEqual([
		"running",
		"waiting",
	]);
	expect(mergeIssueJsonl(ancestor, right, left)).toEqual(result);
	expect(mergeIssueJsonl(result.contents, result.contents, result.contents)).toEqual(result);
});

test.each([
	[{ assignee: "left" }, { assignee: "right" }],
	[
		{ status: "closed", closed_at: "2026-10-10T00:00:01Z" },
		{ status: "closed", closed_at: "2026-10-10T00:00:02Z" },
	],
])("retains genuine assignment and closure disputes", (left, right) => {
	const base = { id: "hv-a", status: "open" };
	const ancestor = jsonl(JSON.stringify(base));
	const current = jsonl(JSON.stringify({ ...base, ...left }));
	const other = jsonl(JSON.stringify({ ...base, ...right }));
	expect(mergeIssueJsonl(ancestor, current, other).kind).toBe("conflicted");
});

test("rejects malformed comment ownership instead of losing evidence", () => {
	const row = JSON.stringify({
		id: "hv-a",
		comments: [{ author: "a", id: 1, issue_id: "hv-b", text: "wrong owner", created_at: "now" }],
	});
	expect(mergeIssueJsonl("", jsonl(row), "").kind).toBe("invalid");
});

test.each([
	["malformed JSON", "{", "current: line 1 is invalid JSON"],
	["missing ID", '{"title":"A"}', "current: line 1 must contain a non-empty string id"],
	[
		"duplicate ID",
		jsonl(issue("hv-a", "A"), issue("hv-a", "B")),
		"current: duplicate issue id hv-a",
	],
])("rejects $name", (_name, current, message) => {
	const result = mergeIssueJsonl("", current, "");
	expect(result.kind).toBe("invalid");
	if (result.kind !== "invalid") {
		throw new Error("expected invalid input");
	}
	expect(result.message).toContain(message);
});
