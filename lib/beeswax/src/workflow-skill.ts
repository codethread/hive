import { BeeswaxError, EXIT, errorMessage } from "./errors.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Installer destinations belong to the selected checkout.
import { dirname, join } from "node:path";
import type { OnboardingConfig } from "./onboarding.ts";
import type { WorkspaceIO } from "./services.ts";
import { z } from "zod";

const source = "https://github.com/codethread/hive/tree/main/skills/hive";
const skill = "hive";
const EMPTY = 0;
const agents = {
	claude: { name: "claude-code", label: "Claude Code" },
	codex: { name: "codex", label: "Codex" },
	pi: { name: "pi", label: "Pi" },
} as const;
const installedSchema = z.object({
	name: z.literal(skill),
	status: z.literal("installed"),
	scope: z.literal("project"),
	agents: z.array(z.string()),
	path: z.string(),
});
const resultSchema = z.tuple([installedSchema]);

export interface WorkflowSkillPlan {
	/** Upstream agent names and display labels for the selected harnesses. */
	agents: (typeof agents)[keyof typeof agents][];
	/** Project destinations the installer may replace. */
	paths: string[];
}

/** Resolve targets for this invocation; installation is never saved in project configuration. */
export function planWorkflowSkill(
	requested: boolean,
	onboarding?: OnboardingConfig,
): WorkflowSkillPlan | undefined {
	if (!requested) {
		return undefined;
	}
	if (!onboarding) {
		throw new BeeswaxError(
			"needs_input",
			"Select at least one --harness to install the workflow skill.",
			{
				exitCode: EXIT.usage,
				context: { missingOptions: ["--harness"] },
			},
		);
	}
	const paths = [".agents/skills/hive"];
	if (onboarding.harnesses.includes("claude")) {
		paths.push(".claude/skills/hive");
	}
	return { agents: onboarding.harnesses.map((name) => agents[name]), paths };
}

/** Refuse any existing destination, including directories and dangling symlinks. */
export async function preflightWorkflowSkill(
	root: string,
	plan: WorkflowSkillPlan,
	io: Pick<WorkspaceIO, "list">,
): Promise<void> {
	const paths = await observedPaths(root, plan, io);
	if (paths.length > EMPTY) {
		throw new BeeswaxError(
			"workflow_skill_exists",
			"Existing workflow skill content requires manual review.",
			{
				context: {
					paths,
					nextAction:
						"Omit --install-workflow-skill to preserve it, or review a manual upstream replacement.",
				},
			},
		);
	}
}

/** Run the fixed upstream installer and preserve evidence of uncertain partial effects. */
// eslint-disable-next-line max-statements -- Keep invocation and its partial-effect evidence in one ordered operation.
export async function installWorkflowSkill(
	root: string,
	plan: WorkflowSkillPlan,
	io: Pick<WorkspaceIO, "exec" | "list">,
) {
	const command = [
		"npx",
		"--yes",
		"skills@1.7.2",
		"add",
		source,
		"--skill",
		skill,
		"--agent",
		...plan.agents.map((agent) => agent.name),
		"--yes",
		"--json",
	];
	const result = await io.exec(command, root).catch((error: unknown) => {
		throw new BeeswaxError("workflow_skill_failed", errorMessage(error), {
			context: {
				installer: { command, effects: "unknown" },
				expectedPaths: plan.paths.map((path) => join(root, path)),
			},
		});
	});
	const installer = { command, ...result, effects: "unknown" };
	const paths = await observedPaths(root, plan, io).catch((error: unknown) => {
		throw new BeeswaxError("workflow_skill_failed", errorMessage(error), {
			context: { installer, expectedPaths: plan.paths.map((path) => join(root, path)) },
		});
	});
	const context = { installer, paths };
	if (result.exitCode !== EXIT.success) {
		throw new BeeswaxError(
			"workflow_skill_failed",
			"Workflow skill installation failed; inspect partial effects before retrying.",
			{ context },
		);
	}
	const [record] = parseInstallationResult(result.stdout, context);
	if (
		record.agents.length !== plan.agents.length ||
		!plan.agents.every((agent) => record.agents.includes(agent.label)) ||
		paths.length !== plan.paths.length
	) {
		throw new BeeswaxError(
			"workflow_skill_invalid_result",
			"Installer did not confirm every requested destination and agent.",
			{ context },
		);
	}
	return { source, skill, agents: plan.agents.map((agent) => agent.name), paths };
}

// --- Private functions ---

function parseInstallationResult(stdout: string, context: Record<string, unknown>) {
	try {
		return resultSchema.parse(JSON.parse(stdout), { jitless: true });
	} catch (error) {
		throw new BeeswaxError("workflow_skill_invalid_result", errorMessage(error), { context });
	}
}

async function observedPaths(
	root: string,
	plan: WorkflowSkillPlan,
	io: Pick<WorkspaceIO, "list">,
): Promise<string[]> {
	const observed = await Promise.all(
		plan.paths.map(async (path) => {
			const absolute = join(root, path);
			const entries = await io.list(dirname(absolute));
			if (entries.includes(skill)) {
				return [absolute];
			}
			return [];
		}),
	);
	return observed.flat();
}
