import { expect, test } from "bun:test";
import { runCli, useTmpHome } from "./lifecycle-helpers.ts";
import { EXIT_CODES } from "../../src/errors.ts";

const tmp = useTmpHome("honeycomb-skills-");

test("skills lists bundled metadata outside a repository", async () => {
	const result = await runCli(["skills", "list", "--json"], tmp.dir);
	expect(result).toMatchObject({ exitCode: EXIT_CODES.SUCCESS, stderr: "" });
	expect(JSON.parse(result.stdout)).toMatchObject({
		ok: true,
		kind: "skills_list",
		skills: [
			{
				name: "git-workflow",
				description: "Use when creating, locating or cleaning up Git worktrees.",
				files: ["SKILL.md", "references/pooled-slots.md"],
			},
		],
	});
	const defaultList = await runCli(["skills", "--json"], tmp.dir);
	expect(defaultList).toEqual(result);
});

test("skills retrieves instructions and referenced resources as text or JSON", async () => {
	const instructions = await runCli(["skills", "get", "git-workflow"], tmp.dir);
	expect(instructions).toMatchObject({ exitCode: EXIT_CODES.SUCCESS, stderr: "" });
	expect(
		instructions.stdout.startsWith("Use Honeycomb instead of raw `git worktree` commands"),
	).toBe(true);
	const jsonInstructions = await runCli(["skills", "get", "git-workflow", "--json"], tmp.dir);
	expect(jsonInstructions).toMatchObject({ exitCode: EXIT_CODES.SUCCESS, stderr: "" });
	expect(JSON.parse(jsonInstructions.stdout)).toMatchObject({
		ok: true,
		kind: "skills_get",
		name: "git-workflow",
		path: "SKILL.md",
		content: instructions.stdout.trimEnd(),
	});
	expect(instructions.stdout).toContain(
		"honeycomb skills file git-workflow references/pooled-slots.md",
	);
	const resource = await runCli(
		["skills", "file", "git-workflow", "references/pooled-slots.md", "--json"],
		tmp.dir,
	);
	expect(resource).toMatchObject({ exitCode: EXIT_CODES.SUCCESS, stderr: "" });
	expect(JSON.parse(resource.stdout)).toMatchObject({
		ok: true,
		kind: "skills_get",
		name: "git-workflow",
		path: "references/pooled-slots.md",
		content: expect.stringContaining("# Pooled slots"),
	});
});

test.each([
	{ args: ["get", "missing"] },
	{ args: ["file", "git-workflow", "missing.md"] },
	{ args: ["file", "git-workflow", "../SKILL.md"] },
	{ args: ["get"] },
	{ args: ["unknown"] },
])("skills rejects invalid requests with one JSON error document: %j", async ({ args }) => {
	const result = await runCli(["skills", ...args, "--json"], tmp.dir);
	expect(result).toMatchObject({ exitCode: EXIT_CODES.USAGE, stderr: "" });
	expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, kind: "error", reason: "usage" });
});
