import { afterAll, beforeAll, describe, expect, test } from "bun:test";
// eslint-disable-next-line import/no-nodejs-modules -- Isolated directories exercise offline executable reads.
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { EXIT } from "../../src/queue.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve source, compiled executable and temporary home paths.
import { resolve } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Keep CLI fixtures outside any repository.
import { tmpdir } from "node:os";

const entrypoint = resolve(import.meta.dirname, "../../bin/qlock.ts");
const name = "command-queues";
const reference = "references/merge-queues.md";
let directory = "";
let cwd = "";
let binary = "";

beforeAll(async () => {
	directory = await mkdtemp(resolve(tmpdir(), "qlock-skills-"));
	cwd = resolve(directory, "empty-home");
	binary = resolve(directory, "qlock");
	await mkdir(cwd);
	const build = await capture([
		process.execPath,
		"build",
		entrypoint,
		"--compile",
		"--outfile",
		binary,
	]);
	expect(build.code).toBe(EXIT.success);
});

afterAll(async () => {
	await rm(directory, { recursive: true, force: true });
});

describe.each(["source", "standalone"])("%s bundled skills", (mode) => {
	test("bundles discovery metadata outside a repository #test-90", async () => {
		const listed = await captureSkills(mode, ["list", "--json"]);
		expect(listed).toMatchObject({ code: EXIT.success, stderr: "" });
		expect(JSON.parse(listed.stdout)).toEqual({
			ok: true,
			kind: "skills_list",
			skills: [{ name, description: expect.any(String), files: ["SKILL.md", reference] }],
		});
	});

	test("bundles instructions without frontmatter #test-91", async () => {
		const body = await captureSkills(mode, ["get", name]);
		expect(body).toMatchObject({ code: EXIT.success, stderr: "" });
		expect(body.stdout).not.toStartWith("---");
		expect(body.stdout).toContain(`qlock skills file ${name} ${reference}`);
	});

	test("bundles advertised supporting resources #test-92", async () => {
		const resource = await captureSkills(mode, ["file", name, reference]);
		expect(resource).toMatchObject({ code: EXIT.success, stderr: "" });
		expect(resource.stdout).toContain("# Merge queues");
	});
});

function captureSkills(mode: string, args: string[]) {
	if (mode === "source") {
		return capture([process.execPath, entrypoint, "skills", ...args]);
	}
	return capture([binary, "skills", ...args]);
}

async function capture(command: string[]) {
	const child = Bun.spawn(command, {
		cwd,
		env: { HOME: cwd, PATH: "", TMPDIR: directory },
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const [code, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { code, stdout, stderr };
}
