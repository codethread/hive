import type { AuditResult, Domain, ReviewInput } from "../../../../.workflows/review/review.ts";
import { ReviewError, resolveScope } from "../../../../.workflows/review/scope.ts";
import type { ReviewGit, Scope } from "../../../../.workflows/review/scope.ts";
import { aggregateVerdict, selectDomains } from "../../../../.workflows/review/review.ts";
import { expect, test } from "bun:test";
import { initialTransition, transition } from "xstate";
import type { SnapshotFrom } from "xstate";
import { machine } from "../../../../.workflows/review/workflow.ts";

const ZERO = 0;
const clear: AuditResult = { verdict: "clear", response: "response-clear" };
const evidence = {
	sourceTask: "task",
	content: "diff-receipt",
	checks: ["passed"],
	architecture: [],
};
const spec = { request: "Change behavior", acceptance: "Preserve contracts", corrections: [] };
const changeScope: Scope = {
	kind: "worktree",
	base: "base",
	changes: [{ status: "M", path: "src/run.ts" }],
};
const input: ReviewInput = {
	target: "/target",
	scope: changeScope,
	evidence,
	purpose: { kind: "advisory", spec },
};

test.each([
	{ path: "docs/guide.md", selected: ["docs"], unmatched: [] },
	{ path: "lib/colony/src/run.ts", selected: ["code", "tests"], unmatched: [] },
	{ path: "lib/colony/src/run.test.ts", selected: ["code", "tests"], unmatched: [] },
	{ path: ".agents/skills/testing/SKILL.md", selected: ["docs"], unmatched: [] },
	{ path: "bun.lock", selected: ["code", "tests"], unmatched: [] },
	{ path: "figure.png", selected: [], unmatched: ["figure.png"] },
])("routes $path with independent Spec coverage", ({ path, selected, unmatched }) => {
	const coverage = selectDomains({ kind: "files", changes: [{ status: "current", path }] }, true);
	expect(
		Object.entries(coverage.paths)
			.filter(([domain, paths]) => domain !== "spec" && paths.length > ZERO)
			.map(([domain]) => domain),
	).toEqual([...selected]);
	expect(coverage.paths.spec).toEqual([path]);
	expect(coverage.unmatched).toEqual([...unmatched]);
});

test.each([
	{ name: "missing selected result", results: { code: clear }, expected: "incomplete" },
	{ name: "all selected results clear", results: { code: clear, tests: clear }, expected: "clear" },
	{
		name: "selected audit incomplete",
		results: { code: clear, tests: { verdict: "incomplete", response: "audit-gap" } },
		expected: "incomplete",
	},
] satisfies {
	name: string;
	results: Partial<Record<Domain, AuditResult>>;
	expected: AuditResult["verdict"];
}[])("aggregates $name", ({ results, expected }) => {
	expect(aggregateVerdict(selectDomains(changeScope, false), results)).toBe(expected);
});

// eslint-disable-next-line max-statements -- One coherent parallel join preserves original sibling outcomes.
test("partial out-of-order audits retain siblings and join only after every selected result", () => {
	const [initial] = initialTransition(machine, input);
	const [tested] = transition(machine, initial, { type: "TESTS.REVIEWED", data: clear });
	expect(tested.value).toEqual({
		audits: { code: "audit", tests: "done", docs: "done", spec: "audit" },
	});
	const [specified] = transition(machine, tested, {
		type: "SPEC.REVIEWED",
		data: { verdict: "findings", response: "spec-finding" },
	});
	expect(specified.context.results.tests).toEqual(clear);
	expect(specified.matches("audits")).toBe(true);
	const [joined] = transition(machine, specified, { type: "CODE.REVIEWED", data: clear });
	expect(joined.value).toBe("synthesis");
	expect(aggregateVerdict(joined.context.coverage, joined.context.results)).toBe("findings");
	const [done] = transition(machine, joined, {
		type: "SYNTHESIZED",
		data: { verdict: "findings", response: "synthesis" },
	});
	expect(done.status).toBe("done");
});

test("docs-only advisory work skips code/tests/spec and unknown paths remain incomplete", () => {
	const [start] = initialTransition(machine, {
		...input,
		purpose: { kind: "advisory" },
		scope: {
			kind: "files",
			changes: [
				{ status: "current", path: "README.md" },
				{ status: "current", path: "image.png" },
			],
		},
	});
	expect(start.value).toEqual({
		audits: { code: "done", tests: "done", docs: "audit", spec: "done" },
	});
	const [joined] = transition(machine, start, { type: "DOCS.REVIEWED", data: clear });
	expect(joined.value).toBe("synthesis");
	expect(aggregateVerdict(joined.context.coverage, joined.context.results)).toBe("incomplete");
});

test("Librarian role provenance survives an architectural-review heading in a scoped brief", () => {
	const gate = {
		run: "gate-run",
		stage: "gate-stage",
		response: "Final architectural review",
		verdict: "approved" as const,
		base: "base",
		content: "diff-receipt",
	};
	const context: SnapshotFrom<typeof machine>["context"] = {
		...input,
		purpose: {
			kind: "final-gate",
			spec,
			bookworm: { ...gate, role: "bookworm" },
			librarian: { ...gate, role: "librarian", request: "librarian-request" },
		},
		coverage: selectDomains(input.scope, true),
		results: {},
	};
	const brief = machine.states.audits!.states.code!.states.audit!.meta!.task({ context });
	expect(brief.bee).toEqual({ kind: "reviewer" });
	expect(brief.instructions).toContain('"role":"librarian"');
	expect(brief.instructions).toContain('"request":"librarian-request"');
	expect(brief.instructions).toContain('"response":"Final architectural review"');
});

test("worktree scope uses caller base and preserves rename pairing and untracked whitespace", async () => {
	const bases: string[] = [];
	const git: ReviewGit = {
		...gitFixture(),
		diff: (base) => {
			bases.push(base);
			return Promise.resolve([
				{ status: "R", previousPath: "old name.ts", path: "new name.md" },
				{ status: "D", path: "deleted.ts" },
			]);
		},
	};
	const resolved = await resolveScope({ kind: "worktree", base: "main", patterns: [] }, git);
	expect(resolved).toEqual({
		kind: "worktree",
		base: "resolved-main",
		changes: [
			{ status: "R", previousPath: "old name.ts", path: "new name.md" },
			{ status: "D", path: "deleted.ts" },
			{ status: "?", path: "untracked name.md" },
		],
	});
	expect(bases).toEqual(["resolved-main"]);
	expect(selectDomains(resolved, false).paths.code).toContain("old name.ts");
	expect(selectDomains(resolved, false).paths.docs).toContain("new name.md");
});

test.each([
	{ kind: "commit" as const, ref: "HEAD", patterns: [] },
	{
		kind: "range" as const,
		base: "main",
		head: "HEAD",
		mergeBase: false,
		expectedBase: "resolved-main",
		patterns: [],
	},
	{
		kind: "range" as const,
		base: "main",
		head: "HEAD",
		mergeBase: true,
		expectedBase: "ancestor",
		patterns: [],
	},
])("resolves $kind and $mergeBase comparison endpoints", async (request) => {
	const scope = await resolveScope({ ...request, patterns: [...request.patterns] }, gitFixture());
	expect(scope.changes).toEqual([{ status: "M", path: "src/run.ts" }]);
	expect(scope).toMatchObject({ head: "resolved-HEAD" });
	if (request.kind === "range") {
		expect(scope).toMatchObject({ base: request.expectedBase });
	}
});

test("whole-file selection includes unchanged files and an empty match fails explicitly", async () => {
	const git = gitFixture();
	expect(await resolveScope({ kind: "files", patterns: ["*.md"] }, git)).toEqual({
		kind: "files",
		changes: [{ status: "current", path: "unchanged.md" }],
	});
	await expect(
		resolveScope({ kind: "files", patterns: ["absent/**"] }, git),
	).rejects.toBeInstanceOf(ReviewError);
});

function gitFixture(): ReviewGit {
	return {
		root: () => Promise.resolve("/target"),
		resolve: (ref) => Promise.resolve(`resolved-${ref}`),
		files: () => Promise.resolve(["unchanged.md", "src/run.ts"]),
		untracked: () => Promise.resolve(["untracked name.md"]),
		diff: () => Promise.resolve([{ status: "M", path: "src/run.ts" }]),
		commit: () => Promise.resolve([{ status: "M", path: "src/run.ts" }]),
		mergeBase: () => Promise.resolve("ancestor"),
	};
}
