// Exercise skill routes in process; retain one executable check with an isolated environment.
/* eslint-disable import/no-nodejs-modules */
// Keep the executable in the changed-test dependency graph.
// eslint-disable-next-line import/no-unassigned-import
import "../../bin/busybee.ts";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { captureCli } from "./support.ts";
import { createServices } from "../../src/native.ts";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SUCCESS = 0;
const skillNames = ["workflow-execution", "workflow-authoring"];
const directory = "/busybee-skills-outside-repository";

test("skills lists discovery metadata without instruction bodies #test-254", async () => {
	const listed = await invokeSkills(["list", "--json"]);
	expect(listed).toMatchObject({ code: 0, stderr: "" });
	const document = JSON.parse(listed.stdout);
	expect(document).toEqual({
		ok: true,
		kind: "skills_list",
		skills: skillNames.map((name) => ({
			name,
			description: expect.any(String),
			files: ["SKILL.md"],
		})),
	});
	expect(await invokeSkills(["--json"])).toEqual(listed);
	const text = await invokeSkills([]);
	expect(text).toMatchObject({ code: 0, stderr: "" });
	expect(text.stdout).toBe(
		document.skills
			.map(
				({ name, description }: { name: string; description: string }) =>
					`${name}\t${description}\n`,
			)
			.join(""),
	);
});

test.each(skillNames)("skills retrieves %s through get and file routes #test-255", async (name) => {
	const text = await invokeSkills(["get", name]);
	expect(text).toMatchObject({ code: 0, stderr: "" });
	expect(text.stdout.startsWith("---")).toBe(false);
	const json = await invokeSkills(["get", name, "--json"]);
	expect(JSON.parse(json.stdout)).toEqual({
		ok: true,
		kind: "skills_get",
		name,
		path: "SKILL.md",
		content: text.stdout.trimEnd(),
	});
	expect(await invokeSkills(["file", name, "SKILL.md"])).toEqual(text);
	expect(await invokeSkills(["file", name, "SKILL.md", "--json"])).toEqual(json);
});

test.each([
	{ args: ["get", "missing"] },
	{ args: ["get"] },
	{ args: ["file", "workflow-execution"] },
	{ args: ["file", "workflow-execution", "missing.md"] },
	{ args: ["file", "workflow-execution", "../SKILL.md"] },
	{ args: ["unknown"] },
])("skills rejects invalid requests through the CLI: %j #test-256", async ({ args }) => {
	const result = await invokeSkills([...args, "--json"]);
	expect(result.code).not.toBe(SUCCESS);
	expect(result.stderr).toBe("");
	expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, kind: "error", reason: "usage" });
	const text = await invokeSkills(args);
	expect(text.code).toBe(result.code);
	expect(text.stdout).toBe("");
	expect(text.stderr).not.toBe("");
});

test("the executable reads workflow-execution with an empty PATH and isolated home #test-253", async () => {
	const name = "workflow-execution";
	const home = await mkdtemp(join(tmpdir(), "busybee-skills-"));
	const proc = Bun.spawn(
		[
			process.execPath,
			new URL("../../bin/busybee.ts", import.meta.url).pathname,
			"skills",
			"get",
			name,
			"--json",
		],
		{
			cwd: home,
			env: { HOME: home, PATH: "", XDG_CONFIG_HOME: home },
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	try {
		const [stdout, stderr, code] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
		expect(JSON.parse(stdout)).toMatchObject({
			ok: true,
			kind: "skills_get",
			name,
		});
	} finally {
		proc.kill();
		await rm(home, { force: true, recursive: true });
	}
});

function invokeSkills(args: readonly string[]) {
	return captureCli(["skills", ...args], { ...createServices(), actor: undefined, cwd: directory });
}
