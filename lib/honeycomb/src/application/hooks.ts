import { EXIT_CODES, PreRemoteCheckError } from "../errors.ts";
import type { Deps } from "../services.ts";
import type { PostCreateScriptSpec } from "../domain/worktree.ts";
import type { TreesConfig } from "../domain/config.ts";

export const runPreRemoteCheck = async (
	deps: Pick<Deps, "config" | "hooks">,
	options: {
		config: TreesConfig;
		root: string;
		operation: string;
	},
): Promise<void> => {
	const { config, root, operation } = options;
	const { preRemoteCheck } = deps.config.explain(config, root);
	if (!preRemoteCheck.value) {
		return;
	}
	const result = await deps.hooks.runCommand(preRemoteCheck.value, root, {});
	if (result.exitCode === EXIT_CODES.SUCCESS) {
		return;
	}
	throw new PreRemoteCheckError(operation, preRemoteCheck.source, result.stderr.join("\n"));
};

export const runBootstrap = async (
	deps: Pick<Deps, "files" | "hooks" | "progress">,
	spec: PostCreateScriptSpec,
): Promise<void> => {
	const scriptPath = deps.files.writePostCreateScript(spec);
	await deps.hooks.runInline(scriptPath, {
		cwd: spec.created,
		env: {},
		onLine: (stream, line) => deps.progress.stream(stream, line),
	});
};
