import { z } from "zod";

const nativeDiagnosticSchema = z.object({
	code: z.string(),
	context: z.object({ field: z.string().optional() }).nullish(),
	message: z.string(),
});
const nativeErrorSchema = z.object({ error: nativeDiagnosticSchema });
const dependencySchema = z.object({
	dependency_type: z.string(),
	id: z.string(),
	title: z.string().optional(),
	status: z.string().optional(),
	priority: z.number().int().optional(),
	issue_type: z.string().optional(),
});
export const beadCommentSchema = z.object({
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
/** Preserve command status so callers can distinguish native conflicts from other failures. */
export class CommandError extends Error {
	/** Native process exit code. */
	readonly code: number;
	/** Structured command output, when available. */
	readonly stdout: string;
	/** Parsed native diagnostic; exit codes alone group unrelated failures. */
	readonly nativeError: z.infer<typeof nativeDiagnosticSchema> | undefined;
	constructor(command: string, result: { code: number; stdout: string; stderr: string }) {
		const nativeError = parseNativeError(result.stdout);
		let diagnostic = result.stderr.trim();
		if (nativeError) {
			diagnostic = `${nativeError.code}: ${nativeError.message}`;
		}
		super(`${command} exited ${result.code}: ${diagnostic}`);
		this.name = "CommandError";
		this.code = result.code;
		this.stdout = result.stdout;
		this.nativeError = nativeError;
	}
}
function parseNativeError(stdout: string): z.infer<typeof nativeDiagnosticSchema> | undefined {
	try {
		return nativeErrorSchema.safeParse(JSON.parse(stdout)).data?.error;
	} catch {
		return undefined;
	}
}
