// eslint-disable-next-line import/no-nodejs-modules -- Canonical endpoint resolution is a filesystem boundary.
import { resolve } from "node:path";
import { z } from "zod";

const SUCCESS = 0;
const ONE = 1;
const FIRST = 0;
const dependencySchema = z.object({ dependency_type: z.string(), id: z.string() });
const beadCommentSchema = z.object({
	author: z.string(),
	created_at: z.string(),
	id: z.number().int(),
	issue_id: z.string(),
	text: z.string(),
});

export const beadSchema = z.object({
	assignee: z.string().optional(),
	close_reason: z.string().optional(),
	closed_at: z.string().optional(),
	comments: z.array(beadCommentSchema).default([]),
	created_at: z.string(),
	dependencies: z.array(dependencySchema).default([]),
	dependents: z.array(dependencySchema).default([]),
	description: z.string().default(""),
	id: z.string(),
	labels: z.array(z.string()).default([]),
	owner: z.string().optional(),
	priority: z.number().int(),
	status: z.string(),
	updated_at: z.string(),
});
export type Bead = z.infer<typeof beadSchema>;
export type BeadComment = z.infer<typeof beadCommentSchema>;
export interface RepositoryEndpoint {
	/** Canonical worktree, independent of execution cwd. */
	root: string;
	/** Absolute selected tracker database. */
	beadsDb: string;
}

/** Preserve command status so callers can distinguish native conflicts from other failures. */
export class CommandError extends Error {
	/** Native process exit code. */
	readonly code: number;
	/** Structured command output, when available. */
	readonly stdout: string;
	constructor(command: string, result: { code: number; stdout: string; stderr: string }) {
		super(`${command} exited ${result.code}: ${result.stderr.trim()}`);
		this.name = "CommandError";
		this.code = result.code;
		this.stdout = result.stdout;
	}
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
export async function execute(
	argv: string[],
	cwd: string,
	env: NodeJS.ProcessEnv,
): Promise<string> {
	const child = Bun.spawn(argv, { cwd, env, stderr: "pipe", stdout: "pipe" });
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (code !== SUCCESS) {
		throw new CommandError(argv[FIRST]!, { code, stderr, stdout });
	}
	return stdout;
}
/** Every tracker operation explicitly selects its endpoint and actor. */
export async function beads(
	endpoint: RepositoryEndpoint,
	actor: string,
	args: string[],
): Promise<unknown> {
	return JSON.parse(
		await execute(
			["br", ...args, "--db", endpoint.beadsDb, "--actor", actor, "--json"],
			endpoint.root,
			{ ...process.env, BD_ACTOR: actor, BEADS_DB: endpoint.beadsDb },
		),
	);
}
export async function showBead(
	endpoint: RepositoryEndpoint,
	actor: string,
	id: string,
): Promise<Bead> {
	return z
		.array(beadSchema)
		.length(ONE)
		.parse(await beads(endpoint, actor, ["show", id]))[FIRST]!;
}
