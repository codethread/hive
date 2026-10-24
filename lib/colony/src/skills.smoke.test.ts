import { afterAll, beforeAll, expect, test } from "bun:test";
// eslint-disable-next-line import/no-nodejs-modules -- Own the isolated CLI working directory.
import { mkdtemp, rm } from "node:fs/promises";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve temporary fixture paths.
import { join } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Use the OS temporary root outside Git.
import { tmpdir } from "node:os";

const SUCCESS = 0;
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
	"$command discovers only its bundled metadata without repository services #test-270",
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
	"$command get returns bundled Markdown without frontmatter #test-271",
	async ({ command, name, resource }) => {
		const instructions = await source(command, ["skills", "get", name]);
		expect(instructions).toMatchObject({ code: SUCCESS, stderr: "" });
		expect(instructions.stdout).not.toStartWith("---");
		expect(instructions.stdout).toContain(`${command} skills file ${name} ${resource}`);
	},
);

test.each(COMMANDS)(
	"$command returns a bundled supporting resource as JSON #test-272",
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
	},
);

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
