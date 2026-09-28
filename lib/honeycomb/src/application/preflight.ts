import type { TreesConfig } from "../domain/config.ts";
import { PreRemoteCheckError } from "../errors.ts";
import type { Deps } from "../services.ts";

export const runPreRemoteCheck = async (
	deps: Pick<Deps, "config" | "hooks">,
	options: {
		config: TreesConfig;
		root: string;
		operation: string;
	},
): Promise<void> => {
	const { config, root, operation } = options;
	const preRemoteCheck = deps.config.explain(config, root).preRemoteCheck;
	if (!preRemoteCheck.value) return;
	const result = await deps.hooks.runCommand(preRemoteCheck.value, root, {});
	if (result.exitCode === 0) return;
	throw new PreRemoteCheckError(operation, preRemoteCheck.source, result.stderr.join("\n"));
};
