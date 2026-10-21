import { EXIT, errorMessage } from "./errors.ts";
import type { SetupOptions } from "./setup.ts";
import type { WorkspaceIO } from "./services.ts";
import { z } from "zod";

const honeycombSchema = z.object({
	ok: z.literal(true),
	kind: z.literal("config_explain"),
	root: z.string(),
	worktree_location: z.string(),
	command: z.object({ source: z.string().nullable(), value: z.string().nullable() }),
	matched_rules: z.array(z.unknown()),
	project: z.unknown(),
	local_config: z.unknown().optional(),
	add: z.unknown(),
	finish: z.unknown(),
});

/** Report configured artifacts separately from deliberate activation and native verification. */
export async function setupReadiness(
	options: SetupOptions,
	database: string,
	io: Pick<WorkspaceIO, "exec">,
) {
	const honeycomb = await inspectHoneycomb(options.repo, io);
	let bee = ["bee", "setup", "--help"];
	let wake = ["colony", "wake", "--help"];
	if (database !== "") {
		bee = [
			"bee",
			"setup",
			"--repo",
			options.repo,
			"--beads-db",
			database,
			"--actor",
			options.actor,
			"--json",
		];
		wake = ["colony", "wake", "--repo", options.repo, "--beads-db", database];
	}
	return {
		configured: {
			database,
			hookAdapter: options.config.bootstrap.hooks,
			harnessAdapters: options.config.onboarding?.harnesses ?? [],
		},
		execution: "not_verified",
		honeycomb,
		next: [
			{
				area: "repository_policy",
				command: ["beeswax", "skills", "get", "repository-setup"],
				action:
					"Review repository task, claim and publication policy in AGENTS.md; " +
					"preserve the selected actor and database.",
			},
			{
				area: "worktrees",
				command: ["honeycomb", "--cwd", options.repo, "config", "explain", "--json"],
				action:
					"Review effective worktree location, bootstrap command and finish policy; " +
					"retain valid existing configuration.",
			},
			{
				area: "bee_bv",
				command: bee,
				action:
					"Install Bee's attention query in the selected tracker. " +
					"Verify Beeswax's _hive_ views with bv --robot-recipes in the application and permanent tracker checkouts.",
			},
			{
				area: "colony_configuration",
				command: ["colony", "skills", "file", "operations", "references/configuration.md"],
				action:
					"Choose harness, model and permission policy; initialize and inspect bee kinds before scheduling.",
			},
			{
				area: "workflow_dependencies",
				command: ["busybee", "init", "--help"],
				action:
					"Prepare the chosen workflow and its dependencies, preserving existing definitions; " +
					"verify input-schema in the execution checkout using the installed Busy Bee executable.",
			},
			{
				area: "activation",
				command: wake,
				action:
					"Deliberately register and wake this repository with its selected database after reviewing readiness.",
			},
			{
				area: "first_execution",
				command: ["bee", "spawn", "--help"],
				action:
					"Follow the configuration guide's first-execution check; " +
					"submission alone does not verify runtime readiness.",
			},
		],
	};
}

async function inspectHoneycomb(repository: string, io: Pick<WorkspaceIO, "exec">) {
	try {
		const result = await io.exec(
			["honeycomb", "--cwd", repository, "config", "explain", "--json"],
			repository,
		);
		if (result.exitCode !== EXIT.success) {
			return { status: "needs_action", ...result };
		}
		const effective = honeycombSchema.parse(JSON.parse(result.stdout));
		return { status: "review_effective_policy", effective };
	} catch (error) {
		return { status: "needs_action", message: errorMessage(error) };
	}
}
