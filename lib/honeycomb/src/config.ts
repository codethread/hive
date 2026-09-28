import { basename, normalize } from "node:path";
import { TOML } from "bun";
import { z } from "zod";
import {
	expandConfigPath,
	expandConfigGlob,
	type ConfigPathContext,
	type CopyEntry,
	type PolicyTables,
	type TreesConfig,
} from "./domain/config.ts";
import { ConfigError } from "./errors.ts";
import { createConfigSchema, type RawConfig } from "./schemas.ts";

export {
	BUILTIN_ADD_POLICY,
	BUILTIN_FINISH_POLICY,
	explainPolicy,
	findProjectForRoot,
	resolveEffectiveCommand,
	resolvePreRemoteCheck,
} from "./domain/config.ts";

export const parseConfig = (toml: string, context: ConfigPathContext): TreesConfig => {
	let raw: unknown;
	try {
		raw = TOML.parse(toml);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new ConfigError(`Invalid TOML in honeycomb.toml: ${message}`);
	}

	const result = createConfigSchema(context).safeParse(raw);
	if (!result.success) {
		throw new ConfigError(`Invalid honeycomb.toml:\n${z.prettifyError(result.error)}`);
	}
	return projectConfig(result.data, context);
};

const projectPolicies = (raw: RawConfig["defaults"]): PolicyTables => ({
	...(raw.add === undefined ? {} : { add: raw.add }),
	...(raw.finish === undefined
		? {}
		: {
				finish: {
					...(raw.finish.enabled === undefined ? {} : { enabled: raw.finish.enabled }),
					...(raw.finish.strategy === undefined ? {} : { strategy: raw.finish.strategy }),
					...(raw.finish.push === undefined ? {} : { push: raw.finish.push }),
					...(raw.finish.remove_worktree === undefined
						? {}
						: { removeWorktree: raw.finish.remove_worktree }),
					...(raw.finish.delete_branch === undefined
						? {}
						: { deleteBranch: raw.finish.delete_branch }),
				},
			}),
});

const projectSetup = (raw: RawConfig["rule"][number] | RawConfig["project"][number]) => ({
	command: raw.command ?? null,
	...(raw.pre_remote_check === undefined ? {} : { preRemoteCheck: raw.pre_remote_check }),
	...(raw.worktree_location === undefined ? {} : { worktreeLocation: raw.worktree_location }),
});

const projectCopy = (raw: RawConfig["project"][number]): CopyEntry[] =>
	raw.copy.map((entry) => {
		const defaultMode = raw.copy_mode_default ?? "copy";
		if (typeof entry === "string") {
			const path = normalize(entry);
			return { from: path, to: [path], mode: defaultMode };
		}
		return {
			from: entry.from,
			to: (typeof entry.to === "string" ? [entry.to] : entry.to).map((path) => normalize(path)),
			mode: entry.mode ?? defaultMode,
		};
	});

const projectConfig = (raw: RawConfig, context: ConfigPathContext): TreesConfig => ({
	worktreeLocation: raw.worktree_location,
	defaults: projectPolicies(raw.defaults),
	rules: raw.rule.map((rule) => ({
		rootGlob: expandConfigGlob(rule.root_glob, context),
		...projectSetup(rule),
		...projectPolicies(rule),
	})),
	projects: raw.project.map((project) => {
		const root = expandConfigPath(project.root, context);
		return {
			name: project.name ?? basename(root),
			root,
			poolSize: project.pool_size ?? null,
			copyModeDefault: project.copy_mode_default ?? "copy",
			copy: projectCopy(project),
			...projectSetup(project),
			...projectPolicies(project),
		};
	}),
});
