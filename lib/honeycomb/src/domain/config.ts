import { isAbsolute, resolve } from "node:path";

export type AddPolicy = "origin_default" | "fresh_canonical";
export type WorktreeLocation = "sibling" | "nested";
export type FinishStrategy = "ff_only" | "rebase_ff" | "squash" | "merge_commit";
export type CopyMode = "copy" | "symlink";

export interface FinishPolicy {
	/** Whether finishing is permitted. */
	enabled: boolean;
	/** How the branch is integrated into the canonical checkout. */
	strategy: FinishStrategy;
	/** Push the integrated branch before cleanup. */
	push: boolean;
	/** Remove the finished checkout after successful integration. */
	removeWorktree: boolean;
	/** Delete its branch after the checkout is removed. */
	deleteBranch: boolean;
}

export interface PolicyTables {
	/** Overrides the inherited add policy when present. */
	add?: { policy: AddPolicy };
	/** Fields omitted from this patch inherit their previous values. */
	finish?: Partial<FinishPolicy>;
}

export interface CopyEntry {
	/** Source path, relative to the canonical root or absolute. */
	from: string;
	/** Normalized destinations relative to the created checkout. */
	to: string[];
	/** Materialization mode after project defaults are applied. */
	mode: CopyMode;
}

export interface ProjectConfig extends PolicyTables {
	/** Display name, defaulting to the configured root's basename. */
	name: string | null;
	/** Expanded configured path, retained for source attribution. */
	root: string;
	/** Exact-project bootstrap command, or null to inherit from rules. */
	command: string | null;
	/** Overrides inherited placement when specified. */
	worktreeLocation?: WorktreeLocation;
	/** Overrides the inherited pre-remote hook when specified. */
	preRemoteCheck?: string | null;
	/** Number of fixed slots, or null for ordinary worktrees. */
	poolSize: number | null;
	/** Default materialization mode for this project's copy entries. */
	copyModeDefault: CopyMode;
	/** Files to materialize before running the bootstrap command. */
	copy: CopyEntry[];
}

export interface PolicyRule extends PolicyTables {
	/** Expanded glob matched against canonical repository paths. */
	rootGlob: string;
	/** Bootstrap command contributed by this rule, if any. */
	command: string | null;
	/** Overrides placement from earlier matching layers. */
	worktreeLocation?: WorktreeLocation;
	/** Pre-remote hook contributed by this rule, if any. */
	preRemoteCheck?: string | null;
}

export interface TreesConfig {
	/** Exact-root configuration entries. */
	projects: ProjectConfig[];
	/** Rules in precedence order, with later matches winning. */
	rules: PolicyRule[];
	/** Policy patches applied over the built-in defaults. */
	defaults: PolicyTables;
	/** Global preference for newly created worktrees. */
	worktreeLocation: WorktreeLocation;
}

export interface ConfigPathContext {
	/** Home directory used for leading tilde expansion. */
	home: string;
	/** Base directory for relative paths in the configuration. */
	cwd: string;
	/** Resolve an existing path for matching without replacing its configured spelling. */
	normalizePath: (path: string) => string;
}

export interface ResolvedConfigString {
	/** Selected value, or null when no layer supplies one. */
	value: string | null;
	/** Project or rule that supplied the value. */
	source: string | null;
}

export interface PolicyExplanation {
	/** Canonicalized repository path used for rule matching. */
	canonicalRoot: string;
	/** Matching rules in precedence order. */
	matchedRules: PolicyRule[];
	/** Matching exact project, if configured. */
	project: ProjectConfig | undefined;
	/** Effective add policy after every layer is applied. */
	addPolicy: AddPolicy;
	/** Effective finish policy after every layer is applied. */
	finishPolicy: FinishPolicy;
	/** Effective location for new worktrees. */
	worktreeLocation: WorktreeLocation;
	/** Effective bootstrap command and its source. */
	command: { command: string | null; source: string | null };
	/** Effective pre-remote hook and its source. */
	preRemoteCheck: ResolvedConfigString;
}

export const BUILTIN_ADD_POLICY: AddPolicy = "origin_default";
export const BUILTIN_FINISH_POLICY: FinishPolicy = {
	enabled: true,
	strategy: "ff_only",
	push: false,
	removeWorktree: false,
	deleteBranch: false,
};

export const expandConfigPath = (path: string, context: ConfigPathContext): string => {
	if (path === "~") return context.home;
	if (path.startsWith("~/")) return resolve(context.home, path.slice(2));
	return isAbsolute(path) ? resolve(path) : resolve(context.cwd, path);
};

export const expandConfigGlob = (glob: string, context: ConfigPathContext): string =>
	isAbsolute(glob) ? glob : expandConfigPath(glob, context);

const identityPath = (path: string): string => path;

export const findProjectForRoot = (
	config: TreesConfig,
	root: string,
	normalizePath = identityPath,
): ProjectConfig | undefined => {
	const comparableRoot = normalizePath(root);
	return config.projects.find((candidate) => normalizePath(candidate.root) === comparableRoot);
};

const resolveEffectiveStringField = (
	config: TreesConfig,
	canonicalRoot: string,
	field: "command" | "preRemoteCheck",
	normalizePath: (path: string) => string,
): ResolvedConfigString => {
	const root = normalizePath(canonicalRoot);
	const project = findProjectForRoot(config, root, normalizePath);
	let value: string | null = null;
	let source: string | null = null;
	for (const rule of config.rules) {
		if (rule[field] && rootGlobMatches(rule.rootGlob, root)) {
			value = rule[field];
			source = `rule:${rule.rootGlob}`;
		}
	}
	if (project?.[field]) {
		value = project[field];
		source = `project:${project.root}`;
	}
	return { value, source };
};

export const resolveEffectiveCommand = (
	config: TreesConfig,
	canonicalRoot: string,
	normalizePath = identityPath,
): PolicyExplanation["command"] => {
	const resolved = resolveEffectiveStringField(config, canonicalRoot, "command", normalizePath);
	return { command: resolved.value, source: resolved.source };
};

export const resolvePreRemoteCheck = (
	config: TreesConfig,
	canonicalRoot: string,
	normalizePath = identityPath,
): ResolvedConfigString =>
	resolveEffectiveStringField(config, canonicalRoot, "preRemoteCheck", normalizePath);

export const explainPolicy = (
	config: TreesConfig,
	canonicalRoot: string,
	normalizePath = identityPath,
): PolicyExplanation => {
	const root = normalizePath(canonicalRoot);
	const matchedRules = config.rules.filter((rule) => rootGlobMatches(rule.rootGlob, root));
	const project = findProjectForRoot(config, root, normalizePath);
	let addPolicy = config.defaults.add?.policy ?? BUILTIN_ADD_POLICY;
	let finishPolicy = { ...BUILTIN_FINISH_POLICY, ...config.defaults.finish };
	let worktreeLocation = config.worktreeLocation;
	for (const rule of matchedRules) {
		if (rule.add?.policy) addPolicy = rule.add.policy;
		Object.assign(finishPolicy, rule.finish);
		if (rule.worktreeLocation) worktreeLocation = rule.worktreeLocation;
	}
	if (project?.add?.policy) addPolicy = project.add.policy;
	if (project?.finish) finishPolicy = { ...finishPolicy, ...project.finish };
	if (project?.worktreeLocation) worktreeLocation = project.worktreeLocation;
	return {
		canonicalRoot: root,
		matchedRules,
		project,
		addPolicy,
		finishPolicy,
		worktreeLocation,
		command: resolveEffectiveCommand(config, root, normalizePath),
		preRemoteCheck: resolvePreRemoteCheck(config, root, normalizePath),
	};
};

export const rootGlobMatches = (glob: string, path: string): boolean =>
	matchGlobSegments(glob.split("/"), path.split("/"));

const matchGlobSegments = (pattern: string[], path: string[]): boolean => {
	if (pattern.length === 0) return path.length === 0;
	const [head, ...tail] = pattern;
	if (head === "**") {
		return (
			matchGlobSegments(tail, path) ||
			(path.length > 0 && matchGlobSegments(pattern, path.slice(1)))
		);
	}
	if (path.length === 0) return false;
	return globSegmentMatches(head ?? "", path[0] ?? "") && matchGlobSegments(tail, path.slice(1));
};

const globSegmentMatches = (pattern: string, value: string): boolean => {
	const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
	return new RegExp(`^${escaped}$`).test(value);
};
