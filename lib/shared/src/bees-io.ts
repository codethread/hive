import { CommandError } from "@hive/beads";
// eslint-disable-next-line import/no-nodejs-modules -- Canonical endpoint resolution is a filesystem boundary.
import { resolve } from "node:path";

const SUCCESS = 0;
const FIRST = 0;

export interface RepositoryEndpoint {
	/** Canonical worktree, independent of execution cwd. */
	root: string;
	/** Absolute selected tracker database. */
	beadsDb: string;
}
/** Canonical discovery delegates to the repository's existing worktree tool. */
export async function resolveRepository(
	directory: string,
	database: string,
): Promise<RepositoryEndpoint> {
	const root = await canonicalRoot(directory);
	return { beadsDb: resolve(database), root };
}
export async function canonicalRoot(directory: string): Promise<string> {
	const output = await execute(
		["honeycomb", "--cwd", resolve(directory), "root"],
		process.cwd(),
		process.env,
	);
	return output.trim();
}
export function execute(argv: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<string> {
	return executeNamed(argv[FIRST]!, argv, { cwd, env });
}

// --- Private functions ---
async function executeNamed(
	command: string,
	argv: string[],
	options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<string> {
	const child = Bun.spawn(argv, { ...options, stderr: "pipe", stdout: "pipe" });
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (code !== SUCCESS) {
		throw new CommandError(command, { code, stderr, stdout });
	}
	return stdout;
}
