/* eslint-disable require-await -- In-memory IO implements the production promise contract. */
import { expect, test } from "bun:test";
import {
	installWorkflowSkill,
	planWorkflowSkill,
	preflightWorkflowSkill,
} from "../src/workflow-skill.ts";
import { BeeswaxError } from "../src/errors.ts";
import type { WorkflowSkillPlan } from "../src/workflow-skill.ts";
import type { WorkspaceIO } from "../src/services.ts";

const FIRST = 0;
const root = "/repo";
const onboarding = { harnesses: ["claude", "codex", "pi"], include: [], exclude: [] } as const;
const plan: WorkflowSkillPlan = {
	agents: [
		{ name: "claude-code", label: "Claude Code" },
		{ name: "codex", label: "Codex" },
		{ name: "pi", label: "Pi" },
	],
	paths: [".agents/skills/hive", ".claude/skills/hive"],
};

const installed = [
	{
		name: "hive",
		status: "installed",
		scope: "project",
		agents: ["Claude Code", "Codex", "Pi"],
		path: "/repo/.agents/skills/hive",
	},
];

test("workflow skill installation is explicit and requires harness targets", () => {
	expect(planWorkflowSkill(false)).toBeUndefined();
	expect(() => planWorkflowSkill(true)).toThrow(BeeswaxError);
	expect(
		planWorkflowSkill(true, {
			...onboarding,
			harnesses: [...onboarding.harnesses],
			include: [],
			exclude: [],
		}),
	).toEqual(plan);
});

test("destination preflight rejects existing skill entries #test-626", async () => {
	const io = skillDependencies();
	io.list = async () => ["hive"];
	const failure = await preflightWorkflowSkill(root, plan, io).catch((error: unknown) => error);
	expect(failure).toBeInstanceOf(BeeswaxError);
	expect(failure).toMatchObject({
		reason: "workflow_skill_exists",
		context: { paths: ["/repo/.agents/skills/hive", "/repo/.claude/skills/hive"] },
	});
});

test("installer requests one project skill for explicit agents and reports destinations #test-609", async () => {
	const io = skillDependencies();
	const calls: { argv: readonly string[]; cwd: string }[] = [];
	io.list = async () => ["hive"];
	io.exec = async (argv, cwd) => {
		calls.push({ argv, cwd });
		return { exitCode: 0, stdout: JSON.stringify(installed), stderr: "upstream progress" };
	};
	expect(await installWorkflowSkill(root, plan, io)).toEqual({
		source: "https://github.com/codethread/hive/tree/main/lib/beeswax/skills/hive",
		skill: "hive",
		agents: ["claude-code", "codex", "pi"],
		paths: ["/repo/.agents/skills/hive", "/repo/.claude/skills/hive"],
	});
	expect(calls).toEqual([
		{
			cwd: root,
			argv: [
				"npx",
				"--yes",
				"skills@1.7.2",
				"add",
				"https://github.com/codethread/hive/tree/main/lib/beeswax/skills/hive",
				"--skill",
				"hive",
				"--agent",
				"claude-code",
				"codex",
				"pi",
				"--yes",
				"--json",
			],
		},
	]);
});

test.each([
	{ exitCode: 1, stdout: "[]", reason: "workflow_skill_failed" },
	{ exitCode: 0, stdout: "bad json", reason: "workflow_skill_invalid_result" },
	{ exitCode: 0, stdout: JSON.stringify(installed), reason: "workflow_skill_invalid_result" },
	{
		exitCode: 0,
		stdout: JSON.stringify([{ ...installed[FIRST], agents: ["Codex"] }]),
		reason: "workflow_skill_invalid_result",
	},
	{
		exitCode: 0,
		stdout: JSON.stringify([{ ...installed[FIRST], scope: "global" }]),
		reason: "workflow_skill_invalid_result",
	},
])(
	"installer failure retains child evidence and observed partial destinations: $reason $stdout",
	async ({ exitCode, stdout, reason }) => {
		const io = skillDependencies();
		io.list = async (path) => {
			if (path.includes(".agents")) {
				return ["hive"];
			}
			return [];
		};
		io.exec = async () => ({ exitCode, stdout, stderr: "diagnostic" });
		const failure = await installWorkflowSkill(root, plan, io).catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(BeeswaxError);
		expect(failure).toMatchObject({
			reason,
			context: {
				installer: { exitCode, stdout, stderr: "diagnostic", effects: "unknown" },
				paths: ["/repo/.agents/skills/hive"],
			},
		});
	},
);

test("missing npx returns command context without claiming rollback", async () => {
	const io = skillDependencies();
	io.exec = async () => {
		throw new Error("spawn ENOENT");
	};
	const failure = await installWorkflowSkill(root, plan, io).catch((error: unknown) => error);
	expect(failure).toMatchObject({
		reason: "workflow_skill_failed",
		context: { installer: { command: expect.arrayContaining(["npx"]), effects: "unknown" } },
	});
});

test("failed destination inspection retains the completed child result", async () => {
	const io = skillDependencies();
	io.exec = async () => ({
		exitCode: 0,
		stdout: JSON.stringify(installed),
		stderr: "progress",
	});
	io.list = async () => {
		throw new Error("EACCES");
	};
	const failure = await installWorkflowSkill(root, plan, io).catch((error: unknown) => error);
	expect(failure).toMatchObject({
		reason: "workflow_skill_failed",
		context: {
			installer: {
				exitCode: 0,
				stdout: JSON.stringify(installed),
				stderr: "progress",
				effects: "unknown",
			},
			expectedPaths: ["/repo/.agents/skills/hive", "/repo/.claude/skills/hive"],
		},
	});
});

function skillDependencies(): Pick<WorkspaceIO, "exec" | "list"> {
	return {
		exec: () => {
			throw new Error("Unexpected installer execution");
		},
		list: () => Promise.resolve([]),
	};
}
