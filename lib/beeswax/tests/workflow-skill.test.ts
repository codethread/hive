/* eslint-disable require-await -- In-memory IO implements the production promise contract. */
import { expect, test } from "bun:test";
import {
	installWorkflowSkill,
	planWorkflowSkill,
	preflightWorkflowSkill,
} from "../src/workflow-skill.ts";
import { BeeswaxError } from "../src/errors.ts";
import { fixture } from "./support.ts";

const EMPTY = 0;
const root = "/repo";
const onboarding = { harnesses: ["claude", "codex", "pi"], include: [], exclude: [] } as const;
const plan = planWorkflowSkill(true, {
	...onboarding,
	harnesses: [...onboarding.harnesses],
	include: [],
	exclude: [],
});
if (!plan) {
	throw new Error("Missing requested skill plan");
}
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
	expect(plan.agents.map((agent) => agent.name)).toEqual(["claude-code", "codex", "pi"]);
});

test("destination preflight detects directory and symlink entries without treating them as files", async () => {
	const fx = fixture();
	fx.deps.list = async () => ["hive"];
	const failure = await preflightWorkflowSkill(root, plan, fx.deps).catch(
		(error: unknown) => error,
	);
	expect(failure).toBeInstanceOf(BeeswaxError);
	expect(failure).toMatchObject({
		reason: "workflow_skill_exists",
		context: { paths: ["/repo/.agents/skills/hive", "/repo/.claude/skills/hive"] },
	});
	expect(fx.files.size).toBe(EMPTY);
});

test("installer curates one project skill with explicit agents and captures child streams", async () => {
	const fx = fixture();
	const calls: { argv: readonly string[]; cwd: string }[] = [];
	fx.deps.list = async () => ["hive"];
	fx.deps.exec = async (argv, cwd) => {
		calls.push({ argv, cwd });
		return { exitCode: 0, stdout: JSON.stringify(installed), stderr: "upstream progress" };
	};
	expect(await installWorkflowSkill(root, plan, fx.deps)).toEqual({
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
	expect(fx.output).toEqual([]);
	expect(fx.errors).toEqual([]);
});

test.each([
	{ exitCode: 1, stdout: "[]", reason: "workflow_skill_failed" },
	{ exitCode: 0, stdout: "bad json", reason: "workflow_skill_invalid_result" },
	{ exitCode: 0, stdout: JSON.stringify(installed), reason: "workflow_skill_invalid_result" },
	{
		exitCode: 0,
		stdout: JSON.stringify([{ ...installed[EMPTY], agents: ["Codex"] }]),
		reason: "workflow_skill_invalid_result",
	},
	{
		exitCode: 0,
		stdout: JSON.stringify([{ ...installed[EMPTY], scope: "global" }]),
		reason: "workflow_skill_invalid_result",
	},
])(
	"installer failure retains child evidence and observed partial destinations: $reason $stdout",
	async ({ exitCode, stdout, reason }) => {
		const fx = fixture();
		fx.deps.list = async (path) => {
			if (path.includes(".agents")) {
				return ["hive"];
			}
			return [];
		};
		fx.deps.exec = async () => ({ exitCode, stdout, stderr: "diagnostic" });
		const failure = await installWorkflowSkill(root, plan, fx.deps).catch(
			(error: unknown) => error,
		);
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
	const fx = fixture();
	fx.deps.exec = async () => {
		throw new Error("spawn ENOENT");
	};
	const failure = await installWorkflowSkill(root, plan, fx.deps).catch((error: unknown) => error);
	expect(failure).toMatchObject({
		reason: "workflow_skill_failed",
		context: { installer: { command: expect.arrayContaining(["npx"]), effects: "unknown" } },
	});
});

test("failed destination inspection retains the completed child result", async () => {
	const fx = fixture();
	fx.deps.exec = async () => ({
		exitCode: 0,
		stdout: JSON.stringify(installed),
		stderr: "progress",
	});
	fx.deps.list = async () => {
		throw new Error("EACCES");
	};
	const failure = await installWorkflowSkill(root, plan, fx.deps).catch((error: unknown) => error);
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
