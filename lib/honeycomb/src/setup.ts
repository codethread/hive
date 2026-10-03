import { ConfigError, EXIT_CODES, UnsafeOperationError } from "./errors.ts";
import type { CopiedFile, PostCreateScriptSpec } from "./domain/worktree.ts";
import type { CopyEntry, WorktreeLocation } from "./domain/config.ts";
import type { GitRunner, WorkspaceFiles } from "./services.ts";
import {
	NESTED_WORKTREE_DIR,
	generatePostCreateScript,
	resolveCopySource,
	sessionNameForWorktreePath,
} from "./domain/worktree.ts";
// oxlint-disable-next-line import/no-nodejs-modules -- Workspace setup is the filesystem IO boundary.
import {
	access,
	cp,
	lstat,
	mkdir,
	readFile,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
// oxlint-disable-next-line import/no-nodejs-modules -- Workspace paths are resolved at this IO boundary.
import { dirname, join, resolve } from "node:path";
// oxlint-disable-next-line import/no-nodejs-modules -- These operations implement the existing synchronous WorkspaceFiles contract.
import { existsSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
// oxlint-disable-next-line import/no-nodejs-modules -- Setup uses the user's home and temporary directory.
import { homedir, tmpdir } from "node:os";

interface CopyPlan {
	/** Absolute destination in the new checkout. */
	destination: string;
	/** Materialized source; symlink mode uses its real path. */
	source: string;
	/** Destination spelling used in Git's exclude fence. */
	to: string;
	/** Asset kind selected during preflight. */
	type: CopiedFile["type"];
}

interface CopySetup {
	/** Copy requests in configured replacement order. */
	entries: CopyEntry[];
	/** Git boundary used to reject tracked destinations. */
	git: GitRunner;
	/** Canonical checkout anchoring relative sources. */
	root: string;
	/** Checkout receiving the configured assets. */
	target: string;
}

const writePostCreateScript = (spec: PostCreateScriptSpec): string => {
	const session = sessionNameForWorktreePath(spec.created);
	// oxlint-disable-next-line node/no-sync -- WorkspaceFiles returns the completed script path synchronously.
	const sessionDir = mkdtempSync(join(tmpdir(), `${session}.wktree.`));
	const scriptPath = resolve(sessionDir, "post-create.sh");
	// oxlint-disable-next-line node/no-sync -- The synchronous script contract requires the executable to exist on return.
	writeFileSync(scriptPath, generatePostCreateScript(spec), { mode: 0o755 });
	return scriptPath;
};

const pathExists = async (path: string): Promise<boolean> => {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
};

const lstatExists = async (path: string): Promise<boolean> => {
	try {
		await lstat(path);
		return true;
	} catch {
		return false;
	}
};

const copyType = (
	stat: Awaited<ReturnType<typeof lstat>>,
	entry: CopyEntry,
): CopiedFile["type"] => {
	if (!stat.isFile() && !stat.isDirectory()) {
		throw new ConfigError(`copy source is not a regular file or directory: ${entry.from}`);
	}
	if (stat.isDirectory()) {
		return "directory";
	}
	return "file";
};

const copySource = async (
	root: string,
	entry: CopyEntry,
): Promise<Pick<CopyPlan, "source" | "type">> => {
	const source = resolveCopySource(root, entry.from, homedir());
	if (!(await pathExists(source))) {
		throw new ConfigError(`copy source does not exist: ${entry.from}`);
	}
	const stat = await lstat(source);
	if (entry.mode === "symlink") {
		return { source: await realpath(source), type: "symlink" };
	}
	return { source, type: copyType(stat, entry) };
};

const assertAncestorUntracked = async (
	git: GitRunner,
	target: string,
	ancestor: string,
): Promise<void> => {
	const directory = await git.runRaw(["-C", target, "ls-tree", "-d", "HEAD", "--", ancestor]);
	if (directory.stdout.trim() !== "") {
		return;
	}
	const file = await git.runRaw(["-C", target, "ls-files", "--error-unmatch", "--", ancestor]);
	if (file.exitCode === EXIT_CODES.SUCCESS) {
		throw new UnsafeOperationError(`copy destination has tracked git ancestor: ${ancestor}`);
	}
};

const assertDestinationUntracked = async (
	git: GitRunner,
	target: string,
	path: string,
): Promise<void> => {
	const tracked = await git.runRaw(["-C", target, "ls-files", "--", path]);
	if (tracked.stdout.trim() !== "") {
		throw new UnsafeOperationError(`copy destination is tracked by git: ${path}`);
	}
	const parts = path.split("/");
	parts.pop();
	const prefix: string[] = [];
	for (const part of parts) {
		prefix.push(part);
		// oxlint-disable-next-line eslint/no-await-in-loop -- Check ancestors in order and stop at the first unsafe destination.
		await assertAncestorUntracked(git, target, prefix.join("/"));
	}
};

const planCopyEntry = async (options: CopySetup, entry: CopyEntry): Promise<CopyPlan[]> => {
	const source = await copySource(options.root, entry);
	const plans: CopyPlan[] = [];
	for (const to of entry.to) {
		// oxlint-disable-next-line eslint/no-await-in-loop -- Preserve deterministic preflight failure order before any filesystem mutations.
		await assertDestinationUntracked(options.git, options.target, to);
		plans.push({ ...source, destination: resolve(options.target, to), to });
	}
	return plans;
};

const materializeCopy = async (plan: CopyPlan): Promise<void> => {
	await mkdir(dirname(plan.destination), { recursive: true });
	if (await lstatExists(plan.destination)) {
		await rm(plan.destination, { force: true, recursive: true });
	}
	if (plan.type === "symlink") {
		await symlink(plan.source, plan.destination);
		return;
	}
	await cp(plan.source, plan.destination, { recursive: plan.type === "directory" });
};

const removeExcludeFence = (current: string, name: string): string => {
	const escapedName = name.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
	const pattern = new RegExp(
		`(?:^|\\n)# ${escapedName}-start\\n[\\s\\S]*?\\n# ${escapedName}-end\\n?`,
		"gu",
	);
	return current.replaceAll(pattern, (match) => {
		if (match.startsWith("\n")) {
			return "\n";
		}
		return "";
	});
};

const EMPTY_PATH_COUNT = 0;

const updateExcludeFence = (current: string, name: string, paths: string[]): string => {
	const withoutFence = removeExcludeFence(current, name);
	const uniquePaths = [...new Set(paths)].toSorted();
	if (uniquePaths.length === EMPTY_PATH_COUNT) {
		return withoutFence;
	}
	let separator = "";
	if (withoutFence !== "" && !withoutFence.endsWith("\n")) {
		separator = "\n";
	}
	return `${withoutFence}${separator}# ${name}-start\n${uniquePaths.join("\n")}\n# ${name}-end\n`;
};

const readExclude = async (path: string): Promise<string> => {
	if (await pathExists(path)) {
		return readFile(path, "utf8");
	}
	return "";
};

const resolveExclude = async (git: GitRunner, root: string): Promise<string> => {
	const result = await git.run(["-C", root, "rev-parse", "--git-path", "info/exclude"]);
	const path = resolve(root, result.stdout.trim());
	if (await pathExists(path)) {
		return realpath(path);
	}
	return path;
};

const writeExcludeFence = async (
	git: GitRunner,
	root: string,
	fence: { name: string; paths: string[] },
): Promise<void> => {
	const path = await resolveExclude(git, root);
	await mkdir(dirname(path), { recursive: true });
	const current = await readExclude(path);
	await writeFile(path, updateExcludeFence(current, fence.name, fence.paths));
};

const runCopySetup = async (options: CopySetup): Promise<CopiedFile[]> => {
	const plans: CopyPlan[] = [];
	for (const entry of options.entries) {
		// oxlint-disable-next-line eslint/no-await-in-loop -- All preflight checks finish in configuration order before replacing assets.
		const entryPlans = await planCopyEntry(options, entry);
		plans.push(...entryPlans);
	}
	for (const plan of plans) {
		// oxlint-disable-next-line eslint/no-await-in-loop -- Destinations may overlap; preserve configured replacement order and first failure.
		await materializeCopy(plan);
	}
	await writeExcludeFence(options.git, options.root, {
		name: "wktree",
		paths: plans.map((plan) => plan.to),
	});
	return plans.map((plan) => ({ from: plan.source, to: plan.to, type: plan.type }));
};

export class LiveWorkspaceFiles implements WorkspaceFiles {
	private readonly git: GitRunner;
	constructor(git: GitRunner) {
		this.git = git;
	}
	normalizePath = (path: string): string => {
		// oxlint-disable-next-line node/no-sync -- Canonical path matching is a synchronous injected service contract.
		if (existsSync(path)) {
			// oxlint-disable-next-line node/no-sync -- Preserve synchronous canonicalization for config and worktree selectors.
			return realpathSync(path);
		}
		return path;
	};
	// oxlint-disable-next-line node/no-sync -- WorkspaceFiles.exists is a synchronous observation contract.
	exists = (path: string): boolean => existsSync(path);
	prepareParent = async (root: string, path: string, location: WorktreeLocation): Promise<void> => {
		if (location === "nested") {
			await writeExcludeFence(this.git, root, {
				name: "wktree-location",
				paths: [`/${NESTED_WORKTREE_DIR}/`, "/.wktree/"],
			});
			await mkdir(dirname(path), { recursive: true });
		}
	};
	copy = (root: string, target: string, entries: CopyEntry[]): Promise<CopiedFile[]> =>
		runCopySetup({ entries, git: this.git, root, target });
	writePostCreateScript = (spec: PostCreateScriptSpec): string => writePostCreateScript(spec);
}
