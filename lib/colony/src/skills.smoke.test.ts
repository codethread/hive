import { afterAll, beforeAll, expect, test } from "bun:test";
// eslint-disable-next-line import/no-nodejs-modules -- Own the isolated CLI working directory.
import { mkdtemp, rm } from "node:fs/promises";
import { Command } from "commander";
import { createBundledSkills } from "./bundled-skills.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve temporary fixture paths.
import { join } from "node:path";
import { registerSkills } from "./skills.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Use the OS temporary root outside Git.
import { tmpdir } from "node:os";

const SUCCESS = 0;
const COMMANDS = [
	{
		command: "bee" as const,
		name: "delegation",
		resource: "references/execution.md",
		files: ["SKILL.md", "references/execution.md"],
	},
	{
		command: "colony" as const,
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
	"$command Bun source entry lists bundled metadata without repository services #test-270",
	async ({ command, name, files }) => {
		const listed = await source(command, ["skills", "list", "--json"]);
		expect(listed).toMatchObject({ code: SUCCESS, stderr: "" });
		expect(JSON.parse(listed.stdout)).toEqual({
			ok: true,
			kind: "skills_list",
			skills: [{ name, description: expect.any(String), files }],
		});
	},
);

test.each(COMMANDS)(
	"$command registered get returns bundled Markdown without frontmatter in-process #test-271",
	async ({ command, name, resource }) => {
		const instructions = await bundled(command, ["skills", "get", name]);
		expect(instructions).not.toStartWith("---");
		expect(instructions).toContain(`${command} skills file ${name} ${resource}`);
	},
);

test.each(COMMANDS)(
	"$command registered file returns a bundled supporting resource as JSON in-process #test-272",
	async ({ command, name, resource }) => {
		const file = await bundled(command, ["skills", "file", name, resource, "--json"]);
		expect(JSON.parse(file)).toEqual({
			ok: true,
			kind: "skills_get",
			name,
			path: resource,
			content: expect.stringContaining("# "),
		});
	},
);

async function bundled(command: "bee" | "colony", args: string[]) {
	let stdout = "";
	const program = new Command().name(command).option("--json").exitOverride();
	registerSkills(program, command, {
		loadSkills: () => Promise.resolve(createBundledSkills(command)),
		stdout: (text) => {
			stdout += text;
		},
	});
	await program.parseAsync(args, { from: "user" });
	return stdout;
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
