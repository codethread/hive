import type {
	CopyEntry,
	PolicyExplanation,
	TreesConfig,
	WorktreeLocation,
} from "./domain/config.ts";
import type { CopiedFile, PostCreateScriptSpec } from "./domain/worktree.ts";

export interface GitResult {
	/** Captured standard output. */
	stdout: string;
	/** Captured diagnostics. */
	stderr: string;
	/** Git's process exit status. */
	exitCode: number;
}

export interface GitRunner {
	/** Run Git, throwing when it exits unsuccessfully. */
	run(args: string[], opts?: { cwd?: string }): Promise<GitResult>;
	/** Run Git and let the caller interpret its exit status. */
	runRaw(args: string[], opts?: { cwd?: string }): Promise<GitResult>;
}

export interface ConfigService {
	/** Load and validate configuration at the command boundary. */
	read(): TreesConfig;
	/** Resolve policy after canonicalizing filesystem paths. */
	explain(config: TreesConfig, root: string): PolicyExplanation;
}

export interface WorkspaceFiles {
	/** Resolve existing paths through symlinks; preserve missing paths. */
	normalizePath(path: string): string;
	/** Check whether a filesystem target exists. */
	exists(path: string): boolean;
	/** Prepare the directory and ignore entry for a nested worktree. */
	prepareParent(root: string, path: string, location: WorktreeLocation): Promise<void>;
	/** Validate all destinations before replacing configured local assets. */
	copy(root: string, target: string, entries: CopyEntry[]): Promise<CopiedFile[]>;
	/** Write an executable bootstrap script and return its path. */
	writePostCreateScript(spec: PostCreateScriptSpec): string;
}

export interface HookResult {
	/** Lines captured from standard output. */
	stdout: string[];
	/** Lines captured from standard error. */
	stderr: string[];
	/** Bash's process exit status. */
	exitCode: number;
}

export interface HookRunner {
	/** Execute a bootstrap file, raising a hook failure on nonzero exit. */
	runInline(
		scriptPath: string,
		cwd: string,
		env: Record<string, string>,
		onLine: (stream: "stdout" | "stderr", line: string) => void,
	): Promise<void>;
	/** Execute a preflight command and capture its output. */
	runCommand(script: string, cwd: string, env: Record<string, string>): Promise<HookResult>;
}

export interface PickerItem {
	/** Stable identity returned by the picker. */
	key: string;
	/** Row shown to the user. */
	display: string;
	/** Shell preview associated with the row. */
	preview: string;
}

export interface PickerService {
	/** Select one of the supplied items. */
	pick(items: PickerItem[], header: string): Promise<PickerItem>;
	/** Ask whether the user accepts the described operation. */
	confirm(prompt: string): Promise<boolean>;
}

export interface ProgressReporter {
	/** Show the current operation. */
	banner(line: string): void;
	/** Forward a hook output line. */
	stream(stream: "stdout" | "stderr", line: string): void;
	/** Report a diagnostic. */
	error(msg: string): void;
}

export interface Deps {
	/** Git process boundary. */
	git: GitRunner;
	/** Configuration loading and canonical path matching. */
	config: ConfigService;
	/** Worktree setup and filesystem observations. */
	files: WorkspaceFiles;
	/** Bootstrap and preflight execution. */
	hooks: HookRunner;
	/** Interactive selection and confirmation. */
	picker: PickerService;
	/** Command diagnostics and hook output. */
	progress: ProgressReporter;
	/** Time source for human-readable commit ages. */
	clock: { now(): number };
	/** Whether the invoking wrapper is performing an internal rollback. */
	internalRollback: boolean;
}
