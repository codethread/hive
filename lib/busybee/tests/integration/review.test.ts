/* eslint-disable import/no-nodejs-modules -- Reuse native disposable Git/Beads fixtures for workflow boundaries. */
import { ReviewError, resolveScope } from "../../../../.workflows/review/scope.ts";
import { close, issueIds, record, useNativeFixture, view } from "./support.ts";
import { cp, mkdir } from "node:fs/promises";
import { expect, test } from "bun:test";
import { runViewSchema, startNamed } from "../../src/runtime.ts";
import type { ReviewInput } from "../../../../.workflows/review/workflow.ts";
import type { Services } from "../../src/native.ts";
import { join } from "node:path";
import { resultSchema } from "../../../../.workflows/review/workflow.ts";
import { runSubmission } from "../../../../.workflows/review/submit.ts";
import { selectReviews } from "../../../../.workflows/review/concerns.ts";
import { tracker } from "../../src/native.ts";

const ZERO = 0;
const ONE = 1;
const TWO = 2;
const fixture = useNativeFixture("busybee-review-");
const workflowDirectory = new URL("../../../../.workflows/review", import.meta.url).pathname;
const cataloguePath = new URL(
	"../../../../.agents/skills/code-review/concerns.toml",
	import.meta.url,
).pathname;
const catalogue = await Bun.file(cataloguePath).text();
const clean = resultSchema.parse({
	choice: "reviewed",
	evidence: ["Inspected assigned source"],
	findings: [],
	notVerified: [],
});
const finding = {
	category: "violation",
	severity: "medium",
	location: "README.md:1",
	standard: "Fixture specification: include usage",
	problem: "Usage is absent",
	fix: "Document usage",
};

test("worktree scope combines staged, unstaged and untracked paths while files scope includes unchanged content", async () => {
	await dirtyWorktree();
	const scope = await resolveScope(
		{ kind: "worktree", patterns: ["**/*.md"] },
		fixture.options.repo,
		fixture.services,
	);
	expect(scope).toMatchObject({
		kind: "worktree",
		files: ["README.md", "staged.md", "untracked space.md"],
		untracked: ["untracked space.md"],
	});
	const files = await resolveScope(
		{ kind: "files", patterns: ["**/*.md"] },
		fixture.options.repo,
		fixture.services,
	);
	expect(files.files).toContain("unchanged.md");
	expect(files.files).not.toContain("ignored/secret.md");
});

test("a commit selects only its introduced changes; ranges retain deletions and both sides of renames", async () => {
	const first = await reviewHistory();
	const latest = await resolveScope(
		{ kind: "commit", ref: "HEAD", patterns: [] },
		fixture.options.repo,
		fixture.services,
	);
	expect(latest.files).toEqual(["sixth.md"]);
	const range = await resolveScope(
		{ kind: "range", range: `${first}..HEAD`, patterns: [] },
		fixture.options.repo,
		fixture.services,
	);
	expect(range.files).toEqual(["README.md", "renamed.ts", "sixth.md", "unchanged.md"]);
	const root = await resolveScope(
		{ kind: "commit", ref: first, patterns: ["**/*.md"] },
		fixture.options.repo,
		fixture.services,
	);
	expect(root.files).toEqual(["README.md", "unchanged.md"]);
	const mergeBase = await resolveScope(
		{ kind: "range", range: `${first}...HEAD`, patterns: ["*.md"] },
		fixture.options.repo,
		fixture.services,
	);
	expect(mergeBase).toMatchObject({
		base: first,
		files: ["README.md", "sixth.md", "unchanged.md"],
	});
});

test("empty scopes fail before creating workflow work", async () => {
	await initialCommit();
	const before = await issueIds(fixture);
	await expect(
		resolveScope(
			{ kind: "files", patterns: ["missing/**"] },
			fixture.options.repo,
			fixture.services,
		),
	).rejects.toBeInstanceOf(ReviewError);
	expect(await issueIds(fixture)).toEqual(before);
});

test("submission dry-run resolves a real checkout and separates optional spec work without tracker mutations", async () => {
	await installWorkflow();
	await initialCommit();
	await write("request.txt", "The documentation must explain usage.");
	const before = await issueIds(fixture);
	const output: string[] = [];
	const code = await runSubmission(
		["--files", "README.md", "--spec", "request.txt", "--dry-run", "--json"],
		{
			...fixture.services,
			start: () => Promise.reject(new Error("Dry-run must not start a workflow")),
			stdout: (value) => {
				output.push(value);
			},
		},
	);
	expect(code).toBe(ZERO);
	expect(output).toHaveLength(ONE);
	expect(JSON.parse(output[ZERO]!)).toMatchObject({
		ok: true,
		input: { jobs: [{ id: "documentation" }, { id: "spec" }] },
	});
	expect(await issueIds(fixture)).toEqual(before);
});

test("submission preserves exact file paths and starts native specialist tasks", async () => {
	await installWorkflow();
	await initialCommit();
	await write(" leading.md", "A file name whose space must be preserved.");
	const { submitted, services } = scriptedBees();
	const result = await submitFile(" leading.md", services);
	const worker = result.active.find((entry) => entry.request)!;
	expect(submitted).toEqual(["reviewer"]);
	expect(worker.context["job"]).toMatchObject({ id: "documentation", files: [" leading.md"] });
	expect(worker.context["scope"]).toMatchObject({ kind: "files", files: [" leading.md"] });
	expect(result.status).toBe("active");
});

// eslint-disable-next-line max-statements -- Keep partial collection, final join and restored reporting in one native story.
test("automatic specialist reviews join into a persisted report, keeping standards and spec independent", async () => {
	await installWorkflow();
	const input = reviewInput(
		["README.md", "tests/check.test.ts"],
		"The feature must meet this fixture requirement.",
	);
	const { submitted, services } = scriptedBees();
	const inputFile = join(fixture.root, "input.json");
	await Bun.write(inputFile, JSON.stringify(input));
	const started = await startNamed("review", { ...fixture.options, inputFile }, services);
	const workers = started.active.filter((entry) => entry.request);
	expect(workers).toHaveLength(input.jobs.length);
	expect(submitted).toEqual(input.jobs.map((job) => job.kind));
	await complete(workers[ZERO]!.bead, resultSchema.parse({ ...clean, findings: [finding] }));
	const observed = await view(fixture, ["show", started.id], services);
	expect(observed.active).toHaveLength(started.active.length);
	const partial = await view(fixture, ["collect", started.id], services);
	expect(partial.status).toBe("active");
	for (const worker of workers.slice(ONE)) {
		// eslint-disable-next-line no-await-in-loop -- Native closures precede collection of each scripted worker.
		await complete(worker.bead, clean);
	}
	const finished = await view(fixture, ["collect", started.id], services);
	expect(finished).toMatchObject({
		status: "done",
		active: [],
		output: {
			standards: { verdict: "findings", findings: [{ problem: "Usage is absent" }] },
			spec: { verdict: "clear", findings: [] },
			coverage: { unmatchedFiles: [] },
		},
	});
	expect(finished.created).toEqual(started.created);
	expect(await view(fixture, ["show", started.id], services)).toEqual(finished);
	expect(await record(fixture, started.id)).toMatchObject({ status: "closed" });
});

test("unmatched files finish as incomplete coverage, not approval or automatic repair", async () => {
	await installWorkflow();
	const inputFile = join(fixture.root, "unmatched.json");
	await Bun.write(inputFile, JSON.stringify(reviewInput(["theme.css"])));
	const run = await startNamed("review", { ...fixture.options, inputFile }, fixture.services);
	expect(run).toMatchObject({
		status: "done",
		active: [],
		output: {
			coverage: { unmatchedFiles: ["theme.css"] },
			standards: { verdict: "incomplete" },
			spec: { verdict: "not_requested" },
		},
	});
	expect(run.created).toHaveLength(ZERO);
});

// --- Private helpers ---

function scriptedBees() {
	const submitted: string[] = [];
	const services: Services = {
		...fixture.services,
		execute: (argv, cwd) => {
			if (argv[ZERO] === "bee") {
				submitted.push(argv[TWO]!);
				return Promise.resolve(
					JSON.stringify({ ok: true, request: { id: `scripted-${submitted.length}` } }),
				);
			}
			return fixture.services.execute(argv, cwd);
		},
	};
	return { submitted, services };
}

async function submitFile(file: string, services: Services) {
	const output: string[] = [];
	const code = await runSubmission(
		[
			"--files",
			file,
			"--owner",
			fixture.options.owner,
			"--actor",
			fixture.options.actor,
			"--db",
			fixture.options.db,
			"--json",
		],
		{
			...services,
			start: async (input, options) => {
				const inputFile = join(fixture.root, "submitted-input.json");
				await Bun.write(inputFile, JSON.stringify(input));
				return startNamed("review", { ...options, inputFile }, services);
			},
			stdout: (value) => {
				output.push(value);
			},
		},
	);
	expect(code).toBe(ZERO);
	expect(output).toHaveLength(ONE);
	expect(JSON.parse(output[ZERO]!)).toMatchObject({ ok: true, kind: "review_started" });
	return runViewSchema.parse(JSON.parse(output[ZERO]!));
}

async function dirtyWorktree(): Promise<void> {
	await initialCommit();
	await write("staged.md", "new\n");
	await git("add", "staged.md");
	await write("README.md", "edited\n");
	await write("untracked space.md", "untracked\n");
	await write("ignored/secret.md", "ignored\n");
}

async function reviewHistory(): Promise<string> {
	const first = await initialCommit();
	await git("mv", "README.md", "renamed.ts");
	await git("rm", "unchanged.md");
	await commit("rename and delete");
	await write("sixth.md", "latest change\n");
	await commit("next change");
	return first;
}

function reviewInput(files: string[], spec?: string): ReviewInput {
	const scope = { kind: "files" as const, files };
	return { scope, jobs: selectReviews(scope, catalogue, spec) };
}

async function complete(id: string, result: typeof clean): Promise<void> {
	await tracker(
		fixture.options,
		["update", id, "--notes", JSON.stringify(result), "--actor", fixture.options.actor],
		fixture.services,
	);
	await close(fixture, id);
}

async function installWorkflow(): Promise<void> {
	await mkdir(join(fixture.options.repo, ".workflows"));
	await cp(workflowDirectory, join(fixture.options.repo, ".workflows/review"), { recursive: true });
	await write(".agents/skills/code-review/concerns.toml", catalogue);
}

async function write(path: string, contents: string): Promise<void> {
	await Bun.write(join(fixture.options.repo, path), contents);
}

function git(...args: string[]) {
	return fixture.services.execute(["git", ...args], fixture.options.repo);
}

async function commit(message: string): Promise<string> {
	await git("add", ".");
	await git("-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", message);
	const head = await git("rev-parse", "HEAD");
	return head.trim();
}

async function initialCommit(): Promise<string> {
	await git("config", "user.email", "fixture@example.test");
	await git("config", "user.name", "Review fixture");
	await write(".gitignore", ".beads/\nnode_modules/\nignored/\n");
	await write("README.md", "initial\n");
	await write("unchanged.md", "unchanged\n");
	return commit("initial");
}
