import type {
	ConfigPathContext,
	CopyEntry,
	FinishPolicy,
	PolicyTables,
	TreesConfig,
	WorktreeLocation,
} from "./domain/config.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Config file paths normalize against the real filesystem.
import { basename, normalize } from "node:path";
import { expandConfigGlob, expandConfigPath } from "./domain/config.ts";
import { ConfigError } from "./errors.ts";
import type { RawConfig } from "./schemas.ts";
import { TOML } from "bun";
import { createConfigSchema } from "./schemas.ts";
import { z } from "zod";

type RuleRaw = RawConfig["rule"][number];
type ProjectRaw = RawConfig["project"][number];
type SetupRaw = RuleRaw | ProjectRaw;
type FinishRaw = NonNullable<RawConfig["defaults"]["finish"]>;

interface ProjectSetup {
	/** Bootstrap command, or null to inherit from rules. */
	command: string | null;
	/** Pre-remote hook override, when configured. */
	preRemoteCheck?: string;
	/** Worktree placement override, when configured. */
	worktreeLocation?: WorktreeLocation;
}

const errorMessage = (cause: unknown): string => {
	if (cause instanceof Error) {
		return cause.message;
	}
	return String(cause);
};

const parseToml = (toml: string): unknown => {
	try {
		return TOML.parse(toml);
	} catch (error) {
		throw new ConfigError(`Invalid TOML in honeycomb.toml: ${errorMessage(error)}`);
	}
};

const projectPolicies = (raw: RawConfig["defaults"]): PolicyTables => {
	const policies: PolicyTables = {};
	if (raw.add !== undefined) {
		policies.add = raw.add;
	}
	if (raw.finish !== undefined) {
		policies.finish = finishPolicy(raw.finish);
	}
	return policies;
};

const finishFlags = (raw: FinishRaw): Partial<FinishPolicy> => {
	const policy: Partial<FinishPolicy> = {};
	if (raw.enabled !== undefined) {
		policy.enabled = raw.enabled;
	}
	if (raw.push !== undefined) {
		policy.push = raw.push;
	}
	if (raw.remove_worktree !== undefined) {
		policy.removeWorktree = raw.remove_worktree;
	}
	if (raw.delete_branch !== undefined) {
		policy.deleteBranch = raw.delete_branch;
	}
	return policy;
};

const finishPolicy = (raw: FinishRaw): Partial<FinishPolicy> => {
	const policy = finishFlags(raw);
	if (raw.strategy !== undefined) {
		policy.strategy = raw.strategy;
	}
	return policy;
};

const projectSetup = (raw: SetupRaw): ProjectSetup => {
	// oxlint-disable-next-line unicorn/no-null -- ProjectConfig distinguishes an absent command from an inherited one.
	const setup: ProjectSetup = { command: raw.command ?? null };
	if (raw.pre_remote_check !== undefined) {
		setup.preRemoteCheck = raw.pre_remote_check;
	}
	if (raw.worktree_location !== undefined) {
		setup.worktreeLocation = raw.worktree_location;
	}
	return setup;
};

const toDestinations = (to: string | string[]): string[] => {
	if (typeof to === "string") {
		return [to];
	}
	return to;
};

const projectCopy = (raw: ProjectRaw): CopyEntry[] => {
	const defaultMode = raw.copy_mode_default ?? "copy";
	return raw.copy.map((entry) => {
		if (typeof entry === "string") {
			const path = normalize(entry);
			return { from: path, mode: defaultMode, to: [path] };
		}
		return {
			from: entry.from,
			mode: entry.mode ?? defaultMode,
			to: toDestinations(entry.to).map((path) => normalize(path)),
		};
	});
};

const buildProject = (
	project: ProjectRaw,
	context: ConfigPathContext,
): TreesConfig["projects"][number] => {
	const root = expandConfigPath(project.root, context);
	return {
		copy: projectCopy(project),
		copyModeDefault: project.copy_mode_default ?? "copy",
		name: project.name ?? basename(root),
		// oxlint-disable-next-line unicorn/no-null -- A project without fixed slots has no pool size.
		poolSize: project.pool_size ?? null,
		root,
		...projectSetup(project),
		...projectPolicies(project),
	};
};

const buildRule = (rule: RuleRaw, context: ConfigPathContext): TreesConfig["rules"][number] => ({
	rootGlob: expandConfigGlob(rule.root_glob, context),
	...projectSetup(rule),
	...projectPolicies(rule),
});

const projectConfig = (raw: RawConfig, context: ConfigPathContext): TreesConfig => ({
	defaults: projectPolicies(raw.defaults),
	projects: raw.project.map((project) => buildProject(project, context)),
	rules: raw.rule.map((rule) => buildRule(rule, context)),
	worktreeLocation: raw.worktree_location,
});

const parseConfig = (toml: string, context: ConfigPathContext): TreesConfig => {
	const raw = parseToml(toml);
	const result = createConfigSchema(context).safeParse(raw);
	if (!result.success) {
		throw new ConfigError(`Invalid honeycomb.toml:\n${z.prettifyError(result.error)}`);
	}
	return projectConfig(result.data, context);
};

export { parseConfig };
export {
	BUILTIN_ADD_POLICY,
	BUILTIN_FINISH_POLICY,
	explainPolicy,
	findProjectForRoot,
	resolveEffectiveCommand,
	resolvePreRemoteCheck,
} from "./domain/config.ts";
