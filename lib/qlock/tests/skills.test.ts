/* eslint-disable no-magic-numbers */
import { expect, test } from "bun:test";
import { EXIT } from "../src/queue.ts";
import type { Skill } from "skills-handler";
import { cliFixture } from "./cli-fixture.ts";
import { createStaticProvider } from "skills-handler";
import { runCli } from "../src/cli.ts";

const name = "command-queues";
const reference = "references/merge-queues.md";
const skillFixture: Skill = {
	name,
	description: "Queue commands",
	body: "# Command queues",
	files: ["SKILL.md", reference],
};
const resourceFixture = "# Merge queues\n";

// Initialize Commander help before timing individual policy tests.
await runCli(["--help"], cliFixture().deps);

test("discovery defaults to metadata only #test-90", async () => {
	const listed = await run(["list", "--json"]);
	expect(listed).toMatchObject({ code: EXIT.success, stderr: "" });
	const payload = JSON.parse(listed.stdout);
	const [skill] = payload.skills;
	expect(payload).toEqual({
		ok: true,
		kind: "skills_list",
		skills: [{ name, description: skillFixture.description, files: ["SKILL.md", reference] }],
	});
	expect(await run(["--json"])).toEqual(listed);
	expect(await run([])).toEqual({
		code: EXIT.success,
		stdout: `${name}\t${skill.description}\n`,
		stderr: "",
	});
});

test("instructions render the provider body in text and JSON #test-91", async () => {
	const body = await run(["get", name]);
	expect(body).toMatchObject({ code: EXIT.success, stderr: "" });
	expect(body.stdout).toBe(`${skillFixture.body}\n`);

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

test("supporting resources load independently as text and JSON #test-92", async () => {
	const resource = await run(["file", name, reference, "--json"]);
	expect(resource).toMatchObject({ code: EXIT.success, stderr: "" });
	expect(JSON.parse(resource.stdout)).toEqual({
		ok: true,
		kind: "skills_get",
		name,
		path: reference,
		content: resourceFixture,
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
])("invalid request emits one JSON error: $args #test-93", async ({ args }) => {
	const result = await run(args);
	expect(result).toMatchObject({ code: EXIT.usage, stderr: "" });
	expect(JSON.parse(result.stdout)).toMatchObject({
		ok: false,
		kind: "error",
		reason: "usage",
		message: expect.any(String),
	});
});

test("text failures use stderr #test-94", async () => {
	const result = await run(["get", "missing"]);
	expect(result).toMatchObject({ code: EXIT.usage, stdout: "" });
	expect(result.stderr).toContain("qlock:");
});

async function run(args: readonly string[]) {
	const provider = createStaticProvider([skillFixture], {
		[name]: { [reference]: resourceFixture },
	});
	const harness = cliFixture(undefined, provider);
	const code = await runCli(["skills", ...args], harness.deps);
	expect(harness.opened).toBe(0);
	return { code, stdout: harness.out.join(""), stderr: harness.err.join("") };
}
