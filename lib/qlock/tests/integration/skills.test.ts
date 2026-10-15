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
	// Initialize the compiled runtime before timing individual command contracts.
	const initialized = await capture([binary, "--help"]);
	expect(initialized.code).toBe(EXIT.success);
});

afterAll(async () => {
	await rm(directory, { recursive: true, force: true });
});

describe.each(["source", "standalone"])("%s bundled skills", (mode) => {
	const run = (args: readonly string[]) => {
		let command = [binary];
		if (mode === "source") {
			command = [process.execPath, entrypoint];
		}
		return capture([...command, "skills", ...args]);
	};

	test("discovery defaults to metadata only outside a repository", async () => {
		const listed = await run(["list", "--json"]);
		expect(listed).toMatchObject({ code: EXIT.success, stderr: "" });
		const payload = JSON.parse(listed.stdout);
		const [skill] = payload.skills;
		expect(payload).toEqual({
			ok: true,
			kind: "skills_list",
			skills: [{ name, description: expect.any(String), files: ["SKILL.md", reference] }],
		});
		expect(await run(["--json"])).toEqual(listed);
		expect(await run([])).toEqual({
			code: EXIT.success,
			stdout: `${name}\t${skill.description}\n`,
			stderr: "",
		});
	});

	test("instructions omit frontmatter in text and JSON", async () => {
		const body = await run(["get", name]);
		expect(body).toMatchObject({ code: EXIT.success, stderr: "" });
		expect(body.stdout).not.toStartWith("---");
		expect(body.stdout).toContain(`qlock skills file ${name} ${reference}`);
		const json = await run(["get", name, "--json"]);
		expect(json).toMatchObject({ code: EXIT.success, stderr: "" });
		expect(JSON.parse(json.stdout)).toEqual({
			ok: true,
			kind: "skills_get",
			name,
			path: "SKILL.md",
			content: body.stdout.trimEnd(),
		});
		expect(await run(["file", name, "SKILL.md"])).toEqual(body);
	});

	test("supporting resources load independently as text and JSON", async () => {
		const resource = await run(["file", name, reference, "--json"]);
		expect(resource).toMatchObject({ code: EXIT.success, stderr: "" });
		expect(JSON.parse(resource.stdout)).toEqual({
			ok: true,
			kind: "skills_get",
			name,
			path: reference,
			content: expect.stringContaining("# Merge queues"),
		});
		const text = await run(["file", name, reference]);
		expect(text).toEqual({
			code: EXIT.success,
			stdout: `${JSON.parse(resource.stdout).content.trimEnd()}\n`,
			stderr: "",
		});
	});

	test.each([
		{ args: ["get", "missing", "--json"] },
		{ args: ["file", name, "missing.md", "--json"] },
		{ args: ["file", name, "../SKILL.md", "--json"] },
		{ args: ["get", "--json"] },
		{ args: ["file", name, "--json"] },
		{ args: ["unknown", "--json"] },
		{ args: ["--json", "get", "missing"] },
		{ args: ["get", "--json", "--bad", name] },
	])("invalid request emits one JSON error: $args", async ({ args }) => {
		const result = await run(args);
		expect(result).toMatchObject({ code: EXIT.usage, stderr: "" });
		expect(JSON.parse(result.stdout)).toMatchObject({
			ok: false,
			kind: "error",
			reason: "usage",
			message: expect.any(String),
		});
	});

	test("text failures use stderr", async () => {
		const result = await run(["get", "missing"]);
		expect(result).toMatchObject({ code: EXIT.usage, stdout: "" });
		expect(result.stderr).toContain("qlock:");
	});
});

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
