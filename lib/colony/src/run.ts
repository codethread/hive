import { agentEnvironment, createIdentity } from "./identity.ts";
import { canonicalRoot, recipeSchema, renderFormula } from "@hive/shared";
import type { Invocation } from "@hive/shared";
import type { LoadedBeesConfig } from "./config.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Supply the host home at the native invocation boundary.
import { homedir } from "node:os";
import { loadBeesConfig } from "./config.ts";

export interface RunOptions {
	/** Override the kind's model. */
	model?: string;
	/** Override the kind's reasoning effort. */
	effort?: string;
	/** Select another named harness formula. */
	harness?: string;
	/** Replace the kind's initial user prompt. */
	prompt?: string;
	/** Replace the kind's role instructions. */
	systemPrompt?: string;
}
export interface RunRuntime {
	/** Working directory inherited from the invoking shell. */
	cwd: string;
	/** Home directory for native executable resolution. */
	home: string;
	/** Shell environment, with no tracker requirement. */
	env: NodeJS.ProcessEnv;
	/** Both stdin and stdout must refer to a terminal. */
	terminal: boolean;
	/** Discover canonical kind definitions and formulas from the shell directory. */
	loadConfig: (cwd: string) => Promise<LoadedBeesConfig>;
	/** Replace the foreground process with the rendered native invocation. */
	replace: (invocation: Invocation, env: NodeJS.ProcessEnv) => void;
	/** Show configuration discovery warnings before handing over the terminal. */
	warn: (message: string) => void;
}

/** A user-invoked harness launch, independent of Colony and Beads. */
// eslint-disable-next-line max-statements -- Validate once, prepare the invocation and hand off without introducing a managed lifecycle.
export async function runKind(
	kind: string,
	options: RunOptions,
	runtime: RunRuntime = liveRuntime(),
): Promise<void> {
	if (!runtime.terminal) {
		throw new Error("bee run requires a TTY on stdin and stdout; run it from your terminal");
	}
	const { config, warnings } = await runtime.loadConfig(runtime.cwd);
	const defaults = config.kinds[kind];
	if (!defaults) {
		throw new Error(`Unknown bee kind ${kind}`);
	}
	const recipe = recipeSchema.parse({
		cwd: runtime.cwd,
		effort: options.effort ?? defaults.effort,
		harness: options.harness ?? defaults.harness,
		kind,
		model: options.model ?? defaults.model,
		prompt: options.prompt ?? defaults.prompt,
		system_prompt: options.systemPrompt ?? defaults.system_prompt,
	});
	const formula = config.formulas[recipe.harness];
	if (!formula) {
		throw new Error(`No formula named ${recipe.harness}`);
	}
	const invocation = renderFormula(formula, recipe, "interactive", runtime.home);
	for (const warning of warnings) {
		runtime.warn(warning);
	}
	runtime.replace(invocation, {
		...runtime.env,
		...agentEnvironment(createIdentity(), recipe),
		HIVE_ASSESSMENT_ID: undefined,
		HIVE_ATTEMPT_ID: undefined,
		HIVE_ATTEMPT_NUMBER: undefined,
		HIVE_ATTEMPT_TOKEN: undefined,
		HIVE_COLONY_STATE: undefined,
		HIVE_DRONE_REVIEW_ID: undefined,
		HIVE_DRONE_TARGET_ATTEMPT_ID: undefined,
		HIVE_SPAWN_ID: undefined,
	});
}

// --- Private functions ---
function liveRuntime(): RunRuntime {
	return {
		cwd: process.cwd(),
		home: homedir(),
		env: process.env,
		terminal: Boolean(process.stdin.isTTY && process.stdout.isTTY),
		loadConfig: async (cwd) => loadBeesConfig(await canonicalRoot(cwd)),
		replace: replaceProcess,
		warn: (message) => process.stderr.write(`Warning: ${message}\n`),
	};
}
function replaceProcess(invocation: Invocation, env: NodeJS.ProcessEnv): void {
	const executable = Bun.which(invocation.executable);
	if (executable === null) {
		throw new Error(`Executable not found: ${invocation.executable}`);
	}
	if (process.execve === undefined) {
		throw new Error("bee run requires POSIX process.execve support");
	}
	process.execve(executable, [invocation.executable, ...invocation.argv], env);
}
