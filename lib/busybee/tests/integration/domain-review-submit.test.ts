import type { ReviewRequest, SubmissionServices } from "../../../../.workflows/review/submit.ts";
import { expect, test } from "bun:test";
import { ReviewError } from "../../../../.workflows/review/scope.ts";
import type { ReviewGit } from "../../../../.workflows/review/scope.ts";
import { submitReview } from "../../../../.workflows/review/submit.ts";

const request: ReviewRequest = {
	scope: { kind: "files", patterns: ["*.md"] },
	evidence: { sourceTask: "task", content: "receipt", checks: [], architecture: [] },
	purpose: { kind: "advisory" },
};
const git: ReviewGit = {
	root: () => Promise.resolve("/checkout"),
	files: () => Promise.resolve(["README.md"]),
	resolve: () => Promise.resolve("commit"),
	untracked: () => Promise.resolve([]),
	diff: () => Promise.resolve([]),
	commit: () => Promise.resolve([]),
	mergeBase: () => Promise.resolve("base"),
};

test("submission propagates identity and tracker separately from catalogue and normalized target", async () => {
	const started: unknown[] = [];
	const fixture = services();
	fixture.start = (input, options) => {
		started.push({ input, options });
		return Promise.resolve({
			id: "review-run",
			status: "active",
			active: [
				{
					bead: "audit",
					commands: ["reviewed"],
					context: { large: "caller context" },
					instructions: "Complete audit brief",
					path: [],
					request: "worker",
					title: "Review docs",
				},
			],
			created: [],
		});
	};
	const result = await submitReview(
		request,
		{
			target: "../checkout/nested",
			repo: "../catalogue",
			parent: "task",
			owner: "human",
			actor: "explicit-actor",
			db: "../tracker/beads.db",
		},
		fixture,
	);
	expect(result).toEqual({
		ok: true,
		kind: "review_started",
		id: "review-run",
		status: "active",
		active: [
			{ bead: "audit", commands: ["reviewed"], path: [], request: "worker", title: "Review docs" },
		],
	});
	expect(started).toEqual([
		{
			input: {
				target: "/checkout",
				scope: { kind: "files", changes: [{ status: "current", path: "README.md" }] },
				evidence: request.evidence,
				purpose: request.purpose,
			},
			options: {
				repo: "/catalogue",
				parent: "task",
				owner: "human",
				actor: "explicit-actor",
				db: "/tracker/beads.db",
			},
		},
	]);
});

test("dry-run resolves scope without publication or mutation identity", async () => {
	const fixture = services();
	fixture.actor = undefined;
	expect(await submitReview(request, { "dry-run": true }, fixture)).toMatchObject({
		kind: "review_plan",
		coverage: { paths: { code: [], tests: [], docs: ["README.md"], spec: [] }, unmatched: [] },
	});
});

test("final worktree submission rejects an implicit base before resolving or publishing", async () => {
	const gate = {
		run: "run",
		stage: "stage",
		response: "response",
		verdict: "approved" as const,
		base: "base",
		content: "receipt",
	};
	await expect(
		submitReview(
			{
				...request,
				scope: { kind: "worktree", patterns: [] },
				purpose: {
					kind: "final-gate",
					spec: { request: "intent", acceptance: "criteria", corrections: [] },
					bookworm: { ...gate, role: "bookworm" },
					librarian: { ...gate, role: "librarian" },
				},
			},
			{},
			services(),
		),
	).rejects.toBeInstanceOf(ReviewError);
});

function services(): SubmissionServices {
	return {
		cwd: "/caller",
		actor: "inherited-actor",
		readText: () => {
			throw new Error("Unexpected file read");
		},
		git: () => git,
		start: () => {
			throw new Error("Unexpected publication");
		},
		stdout: () => {},
	};
}
