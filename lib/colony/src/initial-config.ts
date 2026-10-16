import { z } from "zod";

const NONEMPTY = 1;
const fields = {
	/** Directory used only for canonical repository discovery. */
	repo: z.string().min(NONEMPTY),
	/** Human accountable for generated worker requests. */
	owner: z.string().min(NONEMPTY),
	/** Model used by the default worker. Both selects Codex as the default. */
	model: z.string().min(NONEMPTY),
	/** Explicit native permission mode; this does not change hook trust. */
	permissionMode: z.enum(["restricted", "unrestricted"]),
};
const formulas = {
	codex: {
		headless: ["exec", "--json"],
		argv: [
			"-m",
			"{{model}}",
			"-c",
			'model_reasoning_effort="{{effort}}"',
			"-c",
			'shell_environment_policy.inherit="all"',
			"{{#if system_prompt}}-c{{/if}}",
			"{{#if system_prompt}}developer_instructions={{json system_prompt}}{{/if}}",
			"--",
			"{{prompt}}",
		],
	},
	claude: {
		headless: ["--print", "--output-format", "stream-json", "--verbose"],
		argv: [
			"--model",
			"{{model}}",
			"--effort",
			"{{effort}}",
			"{{#if system_prompt}}--append-system-prompt{{/if}}",
			"{{system_prompt}}",
			"--",
			"{{prompt}}",
		],
	},
};
const permissions = {
	codex: {
		restricted: ["--sandbox", "workspace-write"],
		unrestricted: ["--dangerously-bypass-approvals-and-sandbox"],
	},
	claude: {
		restricted: ["--permission-mode", "default"],
		unrestricted: ["--dangerously-skip-permissions"],
	},
};

export const initOptionsSchema = z.discriminatedUnion("harness", [
	z.strictObject({ ...fields, harness: z.literal("codex") }),
	z.strictObject({ ...fields, harness: z.literal("claude") }),
	z.strictObject({
		...fields,
		harness: z.literal("both"),
		/** Claude's model when the default worker uses Codex. */
		claudeModel: z.string().min(NONEMPTY),
	}),
]);

export type InitOptions = z.infer<typeof initOptionsSchema>;

/** Render portable initial kinds and formulas without reading machine configuration. */
export function initialConfig(options: InitOptions): string {
	const header = `owner = ${JSON.stringify(options.owner)}
humans = [${JSON.stringify(options.owner)}]
ranking = "bv-pagerank"
max_retries = 3
retry_delay_ms = 250

[limits]
colony = 4
kind = 2
worktree = 2
`;
	if (options.harness === "both") {
		return (
			header +
			workerKind("worker", "codex", options.model) +
			workerKind("claude-worker", "claude", options.claudeModel) +
			formula("codex", options.permissionMode) +
			formula("claude", options.permissionMode)
		);
	}
	return (
		header +
		workerKind("worker", options.harness, options.model) +
		formula(options.harness, options.permissionMode)
	);
}

// --- Private functions ---
function workerKind(name: string, harness: "codex" | "claude", model: string): string {
	return `
[kinds.${name}]
description = "mutation-scope: mutating; Implement the linked task beads and verify their outcomes."
harness = ${JSON.stringify(harness)}
model = ${JSON.stringify(model)}
effort = "low"
system_prompt = "Implement the assigned changes and verify acceptance with the repository's required checks."
`;
}

function formula(harness: "codex" | "claude", permissionMode: "restricted" | "unrestricted") {
	const native = formulas[harness];
	const headless = [...native.headless, ...permissions[harness][permissionMode]];
	return `
[formulas.${harness}]
executable = ${JSON.stringify(harness)}
headless = ${JSON.stringify(headless)}
argv = ${JSON.stringify(native.argv)}
`;
}
