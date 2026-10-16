import { afterAll, beforeAll, expect, test } from "bun:test";
// eslint-disable-next-line import/no-nodejs-modules -- Own the isolated CLI working directory.
import { mkdtemp, rm } from "node:fs/promises";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve temporary fixture paths.
import { join } from "node:path";
import { runBeeCli } from "./bee-cli.ts";
import { runCli } from "./cli.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Use the OS temporary root outside Git.
import { tmpdir } from "node:os";

const SUCCESS = 0;
const USAGE_ERROR = 2;
const COMMANDS = [
	{
		command: "bee",
		name: "delegation",
		resource: "references/execution.md",
		files: ["SKILL.md", "references/execution.md"],
	},
	{
		command: "colony",
		name: "operations",
		resource: "references/recovery.md",
		files: ["SKILL.md", "references/configuration.md", "references/recovery.md"],
	},
];
let directory = "";

beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), "colony-skills-"));
});
afterAll(async () => {
	await rm(directory, { recursive: true, force: true });
});

test.each(COMMANDS)(
	"$command discovers only its bundled metadata without repository services",
	async ({ command, name, files }) => {
		const listed = await source(command, ["skills", "list", "--json"]);
		expect(listed).toMatchObject({ code: SUCCESS, stderr: "" });
		expect(JSON.parse(listed.stdout)).toEqual({
			ok: true,
			kind: "skills_list",
			skills: [{ name, description: expect.any(String), files }],
		});
		expect(await invoke(command, ["skills", "--json"])).toEqual(listed);
		const text = await invoke(command, ["skills"]);
		expect(text).toMatchObject({ code: SUCCESS, stderr: "" });
		expect(text.stdout).toStartWith(`${name}\t`);
	},
);

test.each(COMMANDS)(
	"$command returns the same Markdown body through get and SKILL.md",
	async ({ command, name, resource }) => {
		const instructions = await source(command, ["skills", "get", name]);
		expect(instructions).toMatchObject({ code: SUCCESS, stderr: "" });
		expect(instructions.stdout).not.toStartWith("---");
		expect(instructions.stdout).toContain(`${command} skills file ${name} ${resource}`);
		const json = await invoke(command, ["skills", "get", name, "--json"]);
		const body = await invoke(command, ["skills", "file", name, "SKILL.md", "--json"]);
		expect(json).toEqual(body);
		expect(body).toMatchObject({ code: SUCCESS, stderr: "" });
		expect(JSON.parse(body.stdout)).toEqual({
			ok: true,
			kind: "skills_get",
			name,
			path: "SKILL.md",
			content: instructions.stdout.trimEnd(),
		});
	},
);

test.each(COMMANDS)(
	"$command loads a supporting resource independently as text or JSON",
	async ({ command, name, resource }) => {
		const file = await source(command, ["skills", "file", name, resource, "--json"]);
		expect(file).toMatchObject({ code: SUCCESS, stderr: "" });
		expect(JSON.parse(file.stdout)).toEqual({
			ok: true,
			kind: "skills_get",
			name,
			path: resource,
			content: expect.stringContaining("# "),
		});
		const text = await invoke(command, ["skills", "file", name, resource]);
		expect(text).toMatchObject({ code: SUCCESS, stderr: "" });
		expect(text.stdout.trimEnd()).toBe(JSON.parse(file.stdout).content.trimEnd());
	},
);

test.each(
	COMMANDS.flatMap(({ command, name }) => [
		{ command, args: ["get", "missing"] },
		{ command, args: ["get"] },
		{ command, args: ["file", name] },
		{ command, args: ["file", name, "missing.md"] },
		{ command, args: ["file", name, "../SKILL.md"] },
		{ command, args: ["unknown"] },
	]),
)(
	"$command rejects invalid skill requests with one JSON error: $args",
	async ({ command, args }) => {
		const result = await invoke(command, ["skills", ...args, "--json"]);
		expect(result).toMatchObject({ code: USAGE_ERROR, stderr: "" });
		expect(JSON.parse(result.stdout)).toMatchObject({
			ok: false,
			kind: "error",
			reason: "usage",
			message: expect.any(String),
		});
	},
);

test.each(COMMANDS)("$command sends text skill errors to stderr", async ({ command }) => {
	const result = await source(command, ["skills", "get", "missing"]);
	expect(result).toMatchObject({ code: USAGE_ERROR, stdout: "" });
	expect(result.stderr).toStartWith(`${command}: `);
});

// Repeated assertions use CLI interfaces; source() checks isolated source-entrypoint processes.
async function invoke(command: string, args: string[]) {
	let stdout = "";
	let stderr = "";
	const deps = {
		ack: unexpected,
		add: unexpected,
		assess: unexpected,
		assessments: unexpected,
		attachWorkflow: unexpected,
		config: unexpected,
		dispatchStage: unexpected,
		events: unexpected,
		explain: unexpected,
		finish: unexpected,
		init: unexpected,
		inspect: unexpected,
		kinds: unexpected,
		launch: unexpected,
		list: unexpected,
		remove: unexpected,
		report: unexpected,
		responseGet: unexpected,
		responseHistory: unexpected,
		responsePublish: unexpected,
		responseSearch: unexpected,
		result: unexpected,
		retry: unexpected,
		restart: unexpected,
		run: unexpected,
		serve: unexpected,
		setup: unexpected,
		sleep: unexpected,
		spawn: unexpected,
		status: unexpected,
		stop: unexpected,
		wake: unexpected,
		stdout: (text: string) => {
			stdout += text;
		},
		stderr: (text: string) => {
			stderr += text;
		},
	};
	if (command === "bee") {
		const code = await runBeeCli(args, deps);
		return { code, stdout, stderr };
	}
	const code = await runCli(args, deps);
	return { code, stdout, stderr };
}

function unexpected(): never {
	throw new Error("Skill commands must not use repository services");
}

async function source(command: string, args: string[]) {
	const entry = new URL(`../bin/${command}.ts`, import.meta.url).pathname;
	const child = Bun.spawn([process.execPath, entry, ...args], {
		cwd: directory,
		env: { HOME: directory, PATH: directory },
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
