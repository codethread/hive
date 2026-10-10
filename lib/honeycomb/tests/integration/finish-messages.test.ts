import { EXIT_CODES, UsageError, dispatch } from "../../src/index";
import { commitFile, createWorktree, deps, useOriginFixture, writeConfig } from "./support.ts";
import { expect, test } from "bun:test";
import { gitOut, gitText, useTmpHome } from "./lifecycle-helpers.ts";
// oxlint-disable-next-line import/no-nodejs-modules -- Integration fixtures exercise real filesystem IO.
import { join } from "node:path";
// oxlint-disable-next-line import/no-nodejs-modules -- Integration fixtures exercise real filesystem IO.
import { readFile } from "node:fs/promises";

const tmp = useTmpHome("honeycomb-finish-messages-test-");
const { initRepoWithOrigin } = useOriginFixture();

async function prepareFinish(branch: string, policy = "") {
	const { remote, root } = await initRepoWithOrigin(tmp.dir);
	writeConfig({ command: "echo ready", copyToml: policy, root, tmp: tmp.dir });
	const worktreePath = `${root}__${branch.replaceAll("/", "--")}`;
	await createWorktree({ branch, path: worktreePath, root });
	return { remote, root, worktreePath };
}

async function commitMessageLines(root: string): Promise<string[]> {
	const message = await gitText(root, "log", "-1", "--format=%B");
	return message
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
}

async function assertSquashCommit(options: {
	root: string;
	beforeHead: string;
	title: string;
	body: string | undefined;
}) {
	const { root, beforeHead, title, body } = options;
	const expected = [title];
	if (body !== undefined) {
		expected.push(body);
	}
	expected.push("Source branch: feature/squash-finish", "one", "two");
	expect(await commitMessageLines(root)).toEqual(expected);
	expect(await gitOut(root, "rev-list", "--count", `${beforeHead}..HEAD`)).toBe("1");
	expect(await readFile(join(root, "one.txt"), "utf8")).toBe("one\n");
	expect(await readFile(join(root, "two.txt"), "utf8")).toBe("two\n");
}

test("squash composes the caller message with branch provenance and source history", async () => {
	const { root, worktreePath } = await prepareFinish(
		"feature/squash-finish",
		'[project.finish]\nstrategy = "squash"\n',
	);
	await commitFile({ content: "one\n", message: "one", path: "one.txt", repo: worktreePath });
	await commitFile({ content: "two\n", message: "two", path: "two.txt", repo: worktreePath });
	const beforeHead = await gitOut(root, "rev-parse", "HEAD");

	const result = await dispatch(
		"finish",
		[
			"--cwd",
			worktreePath,
			"--title",
			"feat(squash): fold source history",
			"--body",
			"Agent-written integration body.",
			"--json",
		],
		deps,
	);

	expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
	expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({ strategy: "squash" });
	await assertSquashCommit({
		beforeHead,
		body: "Agent-written integration body.",
		root,
		title: "feat(squash): fold source history",
	});
});
test("squash finish requires --title before touching the target", async () => {
	const { root, worktreePath } = await prepareFinish(
		"feature/squash-no-title",
		'[project.finish]\nstrategy = "squash"\n',
	);
	await commitFile({
		content: "no title\n",
		message: "no title work",
		path: "no-title.txt",
		repo: worktreePath,
	});
	const targetHead = await gitOut(root, "rev-parse", "HEAD");
	const sourceHead = await gitOut(worktreePath, "rev-parse", "HEAD");

	const { failure, exitCode } = await dispatch("finish", ["--cwd", worktreePath, "--json"], deps);

	expect(failure).toBeInstanceOf(UsageError);
	expect(exitCode).toBe(EXIT_CODES.USAGE);
	expect(await gitOut(root, "rev-parse", "HEAD")).toBe(targetHead);
	expect(await gitOut(worktreePath, "rev-parse", "HEAD")).toBe(sourceHead);
});
test("rejects --title and --body outside the squash strategy", async () => {
	const { root, worktreePath } = await prepareFinish("feature/message-misuse");
	await commitFile({
		content: "misuse\n",
		message: "misuse work",
		path: "misuse.txt",
		repo: worktreePath,
	});
	const targetHead = await gitOut(root, "rev-parse", "HEAD");

	const titleResult = await dispatch(
		"finish",
		["--cwd", worktreePath, "--json", "--title", "nope"],
		deps,
	);
	expect(titleResult.failure).toBeInstanceOf(UsageError);
	const bodyResult = await dispatch(
		"finish",
		["--cwd", worktreePath, "--json", "--body", "nope"],
		deps,
	);
	expect(bodyResult.failure).toBeInstanceOf(UsageError);
	expect(await gitOut(root, "rev-parse", "HEAD")).toBe(targetHead);
});
