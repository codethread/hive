import { describe, expect, test } from "bun:test";
import {
	branchExistsInList,
	parseTrunkFromRemoteShow,
	parseTrunkFromSymbolicRef,
	parseWorktreeList,
} from "../../src/git/worktrees.ts";

describe("git worktree parsers", () => {
	test.each([
		{
			name: "branch",
			input: "worktree /repo\nHEAD abc123\nbranch refs/heads/main\n",
			expected: {
				path: "/repo",
				head: "abc123",
				branch: "main",
				branchRef: "refs/heads/main",
				detached: false,
				bare: false,
			},
		},
		{
			name: "detached",
			input: "worktree /repo\nHEAD abc123\ndetached\n",
			expected: {
				path: "/repo",
				head: "abc123",
				branch: null,
				branchRef: null,
				detached: true,
				bare: false,
			},
		},
		{
			name: "bare",
			input: "worktree /repo.git\nbare\n",
			expected: {
				path: "/repo.git",
				head: null,
				branch: null,
				branchRef: null,
				detached: false,
				bare: true,
			},
		},
	])("parses a $name checkout", ({ input, expected }) => {
		expect(parseWorktreeList(input)).toEqual([
			{
				...expected,
				canonical: true,
				pool: null,
				locked: false,
				lockReason: null,
				prunable: false,
				prunableReason: null,
			},
		]);
	});

	test.each([
		{ path: "/repo__feat1", branch: "wk-pool/feat1", index: 1, placeholder: true },
		{ path: "/repo__feat2", branch: "my-feature", index: 2, placeholder: false },
		{ path: "/repo/.worktrees/feat3", branch: "wk-pool/feat3", index: 3, placeholder: true },
		{ path: "/repo/.wktree/feat4", branch: "wk-pool/feat4", index: 4, placeholder: true },
	])("recognizes pool slot $path", ({ path, branch, index, placeholder }) => {
		expect(
			parseWorktreeList(
				`worktree /repo\nHEAD aaa\nbranch refs/heads/main\n\nworktree ${path}\nHEAD bbb\nbranch refs/heads/${branch}\n`,
			)[1],
		).toMatchObject({ path, branch, canonical: false, pool: { index, placeholder } });
	});

	test.each([
		{ name: "main", input: "refs/remotes/origin/main\n", expected: "main" },
		{ name: "develop", input: "refs/remotes/origin/develop\n", expected: "develop" },
		{ name: "empty output", input: "\n", expected: null },
	])("parses symbolic-ref: $name", ({ input, expected }) => {
		expect(parseTrunkFromSymbolicRef(input)).toBe(expected);
	});

	test.each([
		{
			name: "declared HEAD",
			input: "* remote origin\n  Fetch URL: git@example.test/repo\n  HEAD branch: develop\n",
			expected: "develop",
		},
		{
			name: "missing HEAD",
			input: "* remote origin\n  Fetch URL: git@example.test/repo\n",
			expected: null,
		},
		{ name: "unknown HEAD", input: "* remote origin\n  HEAD branch: (unknown)\n", expected: null },
	])("parses remote show: $name", ({ input, expected }) => {
		expect(parseTrunkFromRemoteShow(input)).toBe(expected);
	});

	test.each([
		{ output: "* main\n  feature\n  feature-extra\n", branch: "feature", exists: true },
		{ output: "* main\n+ checked-out-elsewhere\n", branch: "checked-out-elsewhere", exists: true },
		{ output: "* main\n  feature-extra\n", branch: "feature", exists: false },
	])("matches exact branch $branch in $output", ({ output, branch, exists }) => {
		expect(branchExistsInList(output, branch)).toBe(exists);
	});
});
