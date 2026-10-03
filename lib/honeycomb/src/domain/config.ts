// eslint-disable-next-line import/no-nodejs-modules -- Canonical project names fall back to the root basename.
import { basename } from "node:path";
import { rootGlobMatches } from "./paths.ts";

type AddPolicy = "origin_default" | "fresh_canonical";
type WorktreeLocation = "sibling" | "nested";
type FinishStrategy = "ff_only" | "rebase_ff" | "squash" | "merge_commit";
type CopyMode = "copy" | "symlink";

interface FinishPolicy {
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

interface PolicyTables {
	/** Overrides the inherited add policy when present. */
	add?: { policy: AddPolicy };
	/** Fields omitted from this patch inherit their previous values. */
	finish?: Partial<FinishPolicy>;
}

interface CopyEntry {
	/** Source path, relative to the canonical root or absolute. */
	from: string;
	/** Normalized destinations relative to the created checkout. */
	to: string[];
	/** Materialization mode after project defaults are applied. */
	mode: CopyMode;
}

interface ProjectConfig extends PolicyTables {
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

interface PolicyRule extends PolicyTables {
	/** Expanded glob matched against canonical repository paths. */
	rootGlob: string;
	/** Bootstrap command contributed by this rule, if any. */
	command: string | null;
	/** Overrides placement from earlier matching layers. */
	worktreeLocation?: WorktreeLocation;
	/** Pre-remote hook contributed by this rule, if any. */
	preRemoteCheck?: string | null;
}

interface TreesConfig {
	/** Exact-root configuration entries. */
	projects: ProjectConfig[];
	/** Rules in precedence order, with later matches winning. */
	rules: PolicyRule[];
	/** Policy patches applied over the built-in defaults. */
	defaults: PolicyTables;
	/** Global preference for newly created worktrees. */
	worktreeLocation: WorktreeLocation;
}

interface ConfigPathContext {
	/** Home directory used for leading tilde expansion. */
	home: string;
	/** Base directory for relative paths in the configuration. */
	cwd: string;
	/** Resolve an existing path for matching without replacing its configured spelling. */
	normalizePath: (path: string) => string;
}

interface ResolvedConfigString {
	/** Selected value, or null when no layer supplies one. */
	value: string | null;
	/** Project or rule that supplied the value. */
	source: string | null;
}

interface PolicyExplanation {
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

type FieldName = "command" | "preRemoteCheck";
type NormalizePath = (path: string) => string;

interface StringFieldRequest {
	config: TreesConfig;
	/** Canonicalized repository path used for matching. */
	canonicalRoot: string;
	field: FieldName;
	normalizePath: NormalizePath;
}

interface PolicyLayers {
	addPolicy: AddPolicy;
	finishPolicy: FinishPolicy;
	worktreeLocation: WorktreeLocation;
}

const BUILTIN_ADD_POLICY: AddPolicy = "origin_default";
const BUILTIN_FINISH_POLICY: FinishPolicy = {
	deleteBranch: false,
	enabled: true,
	push: false,
	removeWorktree: false,
	strategy: "ff_only",
};

const identityPath = (path: string): string => path;

const findProjectForRoot = (
	config: TreesConfig,
	root: string,
	normalizePath = identityPath,
): ProjectConfig | undefined => {
	const comparableRoot = normalizePath(root);
	return config.projects.find((candidate) => normalizePath(candidate.root) === comparableRoot);
};

const resolveRuleField = (
	rules: PolicyRule[],
	field: FieldName,
	root: string,
): ResolvedConfigString => {
	// oxlint-disable-next-line unicorn/no-null -- A rule value is explicitly absent until a match supplies one.
	let value: string | null = null;
	// oxlint-disable-next-line unicorn/no-null -- A rule source is explicitly absent until a match supplies one.
	let source: string | null = null;
	for (const rule of rules) {
		if (rule[field] && rootGlobMatches(rule.rootGlob, root)) {
			value = rule[field];
			source = `rule:${rule.rootGlob}`;
		}
	}
	return { source, value };
};

const resolveEffectiveStringField = (request: StringFieldRequest): ResolvedConfigString => {
	const { canonicalRoot, config, field, normalizePath } = request;
	const root = normalizePath(canonicalRoot);
	const project = findProjectForRoot(config, root, normalizePath);
	if (project?.[field]) {
		return { source: `project:${project.root}`, value: project[field] };
	}
	return resolveRuleField(config.rules, field, root);
};

const resolveEffectiveCommand = (
	config: TreesConfig,
	canonicalRoot: string,
	normalizePath = identityPath,
): PolicyExplanation["command"] => {
	const resolved = resolveEffectiveStringField({
		canonicalRoot,
		config,
		field: "command",
		normalizePath,
	});
	return { command: resolved.value, source: resolved.source };
};

const resolvePreRemoteCheck = (
	config: TreesConfig,
	canonicalRoot: string,
	normalizePath = identityPath,
): ResolvedConfigString =>
	resolveEffectiveStringField({
		canonicalRoot,
		config,
		field: "preRemoteCheck",
		normalizePath,
	});

const applyRulesToLayers = (layers: PolicyLayers, rules: PolicyRule[]): PolicyLayers => {
	let { addPolicy, worktreeLocation } = layers;
	const finishPolicy = { ...layers.finishPolicy };
	for (const rule of rules) {
		addPolicy = rule.add?.policy ?? addPolicy;
		Object.assign(finishPolicy, rule.finish);
		worktreeLocation = rule.worktreeLocation ?? worktreeLocation;
	}
	return { addPolicy, finishPolicy, worktreeLocation };
};

const applyProjectToLayers = (
	layers: PolicyLayers,
	project: ProjectConfig | undefined,
): PolicyLayers => {
	if (project === undefined) {
		return layers;
	}
	return {
		addPolicy: project.add?.policy ?? layers.addPolicy,
		finishPolicy: { ...layers.finishPolicy, ...project.finish },
		worktreeLocation: project.worktreeLocation ?? layers.worktreeLocation,
	};
};

const explainPolicy = (
	config: TreesConfig,
	canonicalRoot: string,
	normalizePath = identityPath,
): PolicyExplanation => {
	const root = normalizePath(canonicalRoot);
	const matchedRules = config.rules.filter((rule) => rootGlobMatches(rule.rootGlob, root));
	const project = findProjectForRoot(config, root, normalizePath);
	const { add: defaultAdd, finish: defaultFinish } = config.defaults;
	const layers = applyProjectToLayers(
		applyRulesToLayers(
			{
				addPolicy: defaultAdd?.policy ?? BUILTIN_ADD_POLICY,
				finishPolicy: { ...BUILTIN_FINISH_POLICY, ...defaultFinish },
				worktreeLocation: config.worktreeLocation,
			},
			matchedRules,
		),
		project,
	);
	return {
		addPolicy: layers.addPolicy,
		canonicalRoot: root,
		command: resolveEffectiveCommand(config, root, normalizePath),
		finishPolicy: layers.finishPolicy,
		matchedRules,
		preRemoteCheck: resolvePreRemoteCheck(config, root, normalizePath),
		project,
		worktreeLocation: layers.worktreeLocation,
	};
};

/** Project name for bootstrap scripts: the configured name, else the canonical root's basename. */
const projectNameFor = (project: ProjectConfig | undefined, root: string): string =>
	project?.name ?? basename(root);

export {
	BUILTIN_ADD_POLICY,
	BUILTIN_FINISH_POLICY,
	explainPolicy,
	findProjectForRoot,
	projectNameFor,
	resolveEffectiveCommand,
	resolvePreRemoteCheck,
	type AddPolicy,
	type ConfigPathContext,
	type CopyEntry,
	type CopyMode,
	type FinishPolicy,
	type FinishStrategy,
	type PolicyExplanation,
	type PolicyRule,
	type PolicyTables,
	type ProjectConfig,
	type ResolvedConfigString,
	type TreesConfig,
	type WorktreeLocation,
};
export { expandConfigGlob, expandConfigPath, rootGlobMatches } from "./paths.ts";
