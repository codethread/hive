import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { CopyEntry, WorktreeLocation } from "./domain/config.ts";
import {
	type CopiedFile,
	type PostCreateScriptSpec,
	NESTED_WORKTREE_DIR,
	generatePostCreateScript,
	resolveCopySource,
	sessionNameForWorktreePath,
} from "./domain/worktree.ts";

import { ConfigError, UnsafeOperationError } from "./errors.ts";
import type { GitRunner, WorkspaceFiles } from "./services.ts";

const writePostCreateScript = (options: PostCreateScriptSpec): string => {
	const { projectName, command, root, created, pooled } = options;
	const session = sessionNameForWorktreePath(created);
	const sessionDir = mkdtempSync(join(tmpdir(), `${session}.wktree.`));
	const postCreateScriptPath = resolve(sessionDir, "post-create.sh");
	writeFileSync(
		postCreateScriptPath,
		generatePostCreateScript({
			projectName,
			root,
			created,
			command,
			pooled,
		}),
		{ mode: 0o755 },
	);
	return postCreateScriptPath;
};

const prepareWorktreeParent = async (
	git: GitRunner,
	root: string,
	worktreePath: string,
	location: WorktreeLocation,
): Promise<void> => {
	if (location !== "nested") return;
	await writeExcludeFence(git, root, "wktree-location", [`/${NESTED_WORKTREE_DIR}/`, "/.wktree/"]);
	mkdirSync(dirname(worktreePath), { recursive: true });
};

const lstatExists = (path: string): boolean => {
	try {
		lstatSync(path);
		return true;
	} catch {
		return false;
	}
};

const runCopySetup = async (options: {
	git: GitRunner;
	root: string;
	target: string;
	entries: CopyEntry[];
}): Promise<CopiedFile[]> => {
	const { git, root, target, entries } = options;
	const plans: Array<{
		source: string;
		to: string;
		destination: string;
		type: "file" | "directory" | "symlink";
	}> = [];
	for (const entry of entries) {
		const source = resolveCopySource(root, entry.from, homedir());
		if (!existsSync(source)) throw new ConfigError(`copy source does not exist: ${entry.from}`);
		const stat = lstatSync(source);
		const type = entry.mode === "symlink" ? "symlink" : stat.isDirectory() ? "directory" : "file";
		if (entry.mode === "copy" && !stat.isFile() && !stat.isDirectory()) {
			throw new ConfigError(`copy source is not a regular file or directory: ${entry.from}`);
		}
		const materializedSource = entry.mode === "symlink" ? realpathSync(source) : source;
		for (const to of entry.to) {
			await assertDestinationUntracked(git, target, to);
			plans.push({ source: materializedSource, to, destination: resolve(target, to), type });
		}
	}
	for (const plan of plans) {
		mkdirSync(dirname(plan.destination), { recursive: true });
		if (existsSync(plan.destination) || lstatExists(plan.destination))
			rmSync(plan.destination, { recursive: true, force: true });
		if (plan.type === "symlink") symlinkSync(plan.source, plan.destination);
		else cpSync(plan.source, plan.destination, { recursive: plan.type === "directory" });
	}
	await writeCopyExcludeBlock(
		git,
		root,
		plans.map((plan) => plan.to),
	);
	return plans.map((plan) => ({ from: plan.source, to: plan.to, type: plan.type }));
};

const assertDestinationUntracked = async (
	git: GitRunner,
	target: string,
	path: string,
): Promise<void> => {
	const tracked = await git.runRaw(["-C", target, "ls-files", "--", path]);
	const trackedPaths = tracked.stdout.trim().split("\n").filter(Boolean);
	if (trackedPaths.length > 0)
		throw new UnsafeOperationError(`copy destination is tracked by git: ${path}`);
	const parts = path.split("/");
	for (let length = 1; length < parts.length; length++) {
		const ancestor = parts.slice(0, length).join("/");
		const trackedDirectory = await git.runRaw([
			"-C",
			target,
			"ls-tree",
			"-d",
			"HEAD",
			"--",
			ancestor,
		]);
		if (trackedDirectory.stdout.trim() !== "") continue;
		const trackedFileAncestor = await git.runRaw([
			"-C",
			target,
			"ls-files",
			"--error-unmatch",
			"--",
			ancestor,
		]);
		if (trackedFileAncestor.exitCode === 0) {
			throw new UnsafeOperationError(`copy destination has tracked git ancestor: ${ancestor}`);
		}
	}
};

const writeCopyExcludeBlock = async (
	git: GitRunner,
	root: string,
	paths: string[],
): Promise<void> => {
	await writeExcludeFence(git, root, "wktree", paths);
};

const writeExcludeFence = async (
	git: GitRunner,
	root: string,
	name: string,
	paths: string[],
): Promise<void> => {
	const excludePathResult = await git.run(["-C", root, "rev-parse", "--git-path", "info/exclude"]);
	const gitPath = resolve(root, excludePathResult.stdout.trim());
	const excludePath = existsSync(gitPath) ? realpathSync(gitPath) : gitPath;
	mkdirSync(dirname(excludePath), { recursive: true });
	const current = existsSync(excludePath) ? readFileSync(excludePath, "utf8") : "";
	const start = `# ${name}-start`;
	const end = `# ${name}-end`;
	const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const fencePattern = new RegExp(
		`(?:^|\\n)# ${escapedName}-start\\n[\\s\\S]*?\\n# ${escapedName}-end\\n?`,
		"g",
	);
	const withoutFence = current.replace(fencePattern, (match) =>
		match.startsWith("\n") ? "\n" : "",
	);
	const uniquePaths = [...new Set(paths)].sort();
	const nextBlock = uniquePaths.length > 0 ? `${start}\n${uniquePaths.join("\n")}\n${end}\n` : "";
	const separator =
		withoutFence !== "" && !withoutFence.endsWith("\n") && nextBlock !== "" ? "\n" : "";
	writeFileSync(excludePath, `${withoutFence}${separator}${nextBlock}`);
};

export class LiveWorkspaceFiles implements WorkspaceFiles {
	private readonly git: GitRunner;
	constructor(git: GitRunner) {
		this.git = git;
	}
	normalizePath = (path: string): string => (existsSync(path) ? realpathSync(path) : path);
	exists = (path: string): boolean => existsSync(path);
	prepareParent = (root: string, path: string, location: WorktreeLocation): Promise<void> =>
		prepareWorktreeParent(this.git, root, path, location);
	copy = (root: string, target: string, entries: CopyEntry[]): Promise<CopiedFile[]> =>
		runCopySetup({ git: this.git, root, target, entries });
	writePostCreateScript = (spec: PostCreateScriptSpec): string => writePostCreateScript(spec);
}
