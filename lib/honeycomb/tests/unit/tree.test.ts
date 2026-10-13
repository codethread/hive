import { expect, test } from "bun:test";
import { formatWorktreeTree, toTreePayload } from "../../src/protocol-payloads.ts";
import { buildWorktreeTree } from "../../src/domain/worktree.ts";
import { parseWorktreeList } from "../../src/git/worktrees.ts";

const worktrees = parseWorktreeList(`worktree /repo
HEAD D
branch refs/heads/trunk

worktree /repo__feat1
HEAD A
branch refs/heads/wk-pool/feat1

worktree /repo__feat2
HEAD B
branch refs/heads/wk-pool/feat2

worktree /repo/old
HEAD B
branch refs/heads/old

worktree /repo/parent
HEAD P
branch refs/heads/parent

worktree /repo__feat3
HEAD P
branch refs/heads/wk-pool/feat3

worktree /repo/child
HEAD C
branch refs/heads/child

worktree /repo/sibling
HEAD Q
branch refs/heads/sibling

worktree /repo__feat4
HEAD R
branch refs/heads/wk-pool/feat4
`);

// Default history A--B--D; P forks at A, Q at B, and P--R--C is a feature stack.
const tree = buildWorktreeTree({
	worktrees,
	defaultBranch: { branch: "trunk", ref: "refs/heads/trunk", head: "D" },
	comparisons: new Map([
		["D", { kind: "related", ahead: 0, behind: 0 }],
		["A", { kind: "related", ahead: 0, behind: 2 }],
		["B", { kind: "related", ahead: 0, behind: 1 }],
		["P", { kind: "related", ahead: 1, behind: 2 }],
		["Q", { kind: "related", ahead: 1, behind: 1 }],
		["R", { kind: "related", ahead: 2, behind: 2 }],
		["C", { kind: "related", ahead: 3, behind: 2 }],
	]),
	ancestors: new Map([
		["D", new Set(["A", "B"])],
		["B", new Set(["A"])],
		["P", new Set(["A"])],
		["Q", new Set(["A", "B"])],
		["R", new Set(["A", "P"])],
		["C", new Set(["A", "P", "R"])],
	]),
});

test("free members stay flat while an active member at the same HEAD can parent a stack", () => {
	expect(formatWorktreeTree(tree)).toMatchInlineSnapshot(`
	  "Worktrees (default-branch groups; inferred feature stacks, not creation history)
	  └── trunk [canonical] [default]
	      ├── old [0 ahead, 1 behind]
	      ├── parent [1 ahead, 2 behind]
	      │   └── child [3 ahead, 2 behind]
	      └── sibling [1 ahead, 1 behind]

	  Free pool slots (relative to default branch)
	  ├── wk-pool/feat1 [pool:free] [0 ahead, 2 behind]
	  ├── wk-pool/feat2 [pool:free] [0 ahead, 1 behind]
	  ├── wk-pool/feat3 [pool:free] [1 ahead, 2 behind]
	  └── wk-pool/feat4 [pool:free] [2 ahead, 2 behind]
	  "
	`);
});

test("JSON preserves equal-HEAD inventory but infers only active feature parents", () => {
	const payload = toTreePayload(tree);
	expect(
		payload.nodes
			.flatMap((node) => node.worktrees)
			.map((worktree) => worktree.path)
			.toSorted(),
	).toEqual(worktrees.map((worktree) => worktree.path).toSorted());
	expect(payload.nodes.find((node) => node.id === "P")).toMatchObject({
		worktrees: [{ branch: "parent" }, { branch: "wk-pool/feat3" }],
		parentage: { kind: "unknown", reason: "no_ancestor" },
	});
	expect(payload.nodes.find((node) => node.id === "C")).toMatchObject({
		parentage: { kind: "inferred", head: "P" },
	});
	expect(
		payload.nodes.filter((node) => node.parentage.kind === "inferred").map((node) => node.id),
	).toEqual(["C"]);
});
