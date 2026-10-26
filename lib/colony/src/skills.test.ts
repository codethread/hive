import type { Skill, SkillProvider } from "skills-handler";
import { expect, mock, test } from "bun:test";
import { reportFailure, runCli } from "./cli.ts";
import { Command } from "commander";
import { createStaticProvider } from "skills-handler";
import { registerSkills } from "./skills.ts";
import { runBeeCli } from "./bee-cli.ts";

const SUCCESS = 0;
const FAILURE = 1;
const USAGE_ERROR = 2;
const COMMANDS = ["bee", "colony"] as const;
const name = "example";
const reference = "references/usage.md";
const resource = "# Supporting instructions\nKeep this distinct from the body.\n\n";
const skill: Skill = {
	name,
	description: "Use the example skill",
	body: "# Example\nFollow these instructions.  \n\n",
	files: ["SKILL.md", reference],
};

test.each([...COMMANDS])(
	"%s lists metadata and defaults to text discovery #test-270",
	async (command) => {
		const provider = createStaticProvider([skill]);
		const listed = await invokeEntry(command, ["skills", "list", "--json"], provider);
		expect(listed).toMatchObject({ code: SUCCESS, stderr: "", loads: 1 });
		expect(JSON.parse(listed.stdout)).toEqual({
			ok: true,
			kind: "skills_list",
			skills: [{ name, description: skill.description, files: skill.files }],
		});
		expect(await invokeRegistered(command, ["skills", "--json"], provider)).toEqual(listed);
		expect(await invokeRegistered(command, ["skills"], provider)).toEqual({
			code: SUCCESS,
			stdout: `${name}\t${skill.description}\n`,
			stderr: "",
			loads: 1,
		});
	},
);

test.each([...COMMANDS])(
	"%s preserves the body in JSON and normalizes text endings #test-271",
	async (command) => {
		const provider = createStaticProvider([skill]);
		const getSkillFile = mock(provider.getSkillFile);
		const observed = { ...provider, getSkillFile };
		const json = await invokeRegistered(command, ["skills", "get", name, "--json"], observed);
		expect(json).toMatchObject({ code: SUCCESS, stderr: "", loads: 1 });
		expect(JSON.parse(json.stdout)).toEqual({
			ok: true,
			kind: "skills_get",
			name,
			path: "SKILL.md",
			content: skill.body,
		});
		expect(
			await invokeRegistered(command, ["skills", "file", name, "SKILL.md", "--json"], observed),
		).toEqual(json);
		expect(await invokeRegistered(command, ["skills", "get", name], observed)).toEqual({
			code: SUCCESS,
			stdout: `${skill.body.trimEnd()}\n`,
			stderr: "",
			loads: 1,
		});
		expect(getSkillFile.mock.calls).toEqual([]);
	},
);

test.each([...COMMANDS])(
	"%s reads the advertised resource as JSON or text #test-272",
	async (command) => {
		const provider = createStaticProvider([skill], { [name]: { [reference]: resource } });
		const getSkillFile = mock(provider.getSkillFile);
		const observed = { ...provider, getSkillFile };
		const json = await invokeRegistered(
			command,
			["skills", "file", name, reference, "--json"],
			observed,
		);
		expect(json).toMatchObject({ code: SUCCESS, stderr: "", loads: 1 });
		expect(JSON.parse(json.stdout)).toEqual({
			ok: true,
			kind: "skills_get",
			name,
			path: reference,
			content: resource,
		});
		expect(await invokeRegistered(command, ["skills", "file", name, reference], observed)).toEqual({
			code: SUCCESS,
			stdout: `${resource.trimEnd()}\n`,
			stderr: "",
			loads: 1,
		});
		expect(getSkillFile.mock.calls).toEqual([
			[name, reference],
			[name, reference],
		]);
	},
);

test.each(
	COMMANDS.flatMap((command) => [
		{ command, args: ["get", "missing"] },
		{ command, args: ["get"] },
		{ command, args: ["file", name] },
		{ command, args: ["file", name, "missing.md"] },
		{ command, args: ["file", name, "../SKILL.md"] },
		{ command, args: ["unknown"] },
		{ command, args: ["get", name, reference] },
	]),
)(
	"$command rejects invalid skill requests with one JSON error: $args #test-590",
	async ({ command, args }) => {
		const provider = createStaticProvider([skill]);
		const getSkillFile = mock(provider.getSkillFile);
		const result = await invokeRegistered(command, ["skills", ...args, "--json"], {
			...provider,
			getSkillFile,
		});
		expect(result).toMatchObject({ code: USAGE_ERROR, stderr: "", loads: 1 });
		expect(JSON.parse(result.stdout)).toMatchObject({
			ok: false,
			kind: "error",
			reason: "usage",
			message: expect.any(String),
		});
		expect(getSkillFile.mock.calls).toEqual([]);
	},
);

test.each([...COMMANDS])("%s sends text skill errors to stderr #test-273", async (command) => {
	const result = await invokeRegistered(
		command,
		["skills", "get", "missing"],
		createStaticProvider([skill]),
	);
	expect(result).toMatchObject({ code: USAGE_ERROR, stdout: "", loads: 1 });
	expect(result.stderr).toStartWith(`${command}: `);
});

test.each([...COMMANDS])("%s fails when an advertised resource is unavailable", async (command) => {
	const result = await invokeRegistered(
		command,
		["skills", "file", name, reference, "--json"],
		createStaticProvider([skill]),
	);
	expect(result).toMatchObject({ code: FAILURE, stderr: "", loads: 1 });
	expect(JSON.parse(result.stdout)).toMatchObject({
		ok: false,
		kind: "error",
		reason: "operation_failed",
	});
});

test.each([...COMMANDS])("%s version does not call the skills loader", async (command) => {
	const result = await invokeEntry(command, ["--version"], createStaticProvider([skill]));
	expect(result).toMatchObject({ code: SUCCESS, stderr: "", loads: 0 });
	expect(result.stdout).not.toBe("");
});

// Explicit list and version checks retain full CLI composition and lazy-loader wiring.
async function invokeEntry(command: "bee" | "colony", args: string[], provider: SkillProvider) {
	const loadSkills = mock(() => Promise.resolve(provider));
	const captured = { stdout: "", stderr: "" };
	const deps = {
		loadSkills,
		ack: unexpected,
		executionClearance: () => {
			throw new Error("Unexpected clearance");
		},
		add: unexpected,
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
			captured.stdout += text;
		},
		stderr: (text: string) => {
			captured.stderr += text;
		},
	};
	if (command === "bee") {
		const code = await runBeeCli(args, deps);
		return { code, ...captured, loads: loadSkills.mock.calls.length };
	}
	const code = await runCli(args, deps);
	return { code, ...captured, loads: loadSkills.mock.calls.length };
}

// Policy cases use a static provider with production command registration and error rendering.
async function invokeRegistered(
	command: "bee" | "colony",
	args: string[],
	provider: SkillProvider,
) {
	const loadSkills = mock(() => Promise.resolve(provider));
	const captured = { stdout: "", stderr: "" };
	const output = {
		command,
		stdout: (text: string) => {
			captured.stdout += text;
		},
		stderr: (text: string) => {
			captured.stderr += text;
		},
	};
	const program = new Command()
		.name(command)
		.option("--json")
		.configureOutput({ writeErr: () => {}, writeOut: output.stdout })
		.exitOverride();
	registerSkills(program, command, { loadSkills, stdout: output.stdout });
	let code = SUCCESS;
	try {
		await program.parseAsync(args, { from: "user" });
	} catch (error) {
		code = reportFailure(error, args.includes("--json"), output);
	}
	return { code, ...captured, loads: loadSkills.mock.calls.length };
}

function unexpected(): never {
	throw new Error("Skill commands must not use repository services");
}
