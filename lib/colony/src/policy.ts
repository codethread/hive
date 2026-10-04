import type { BeesConfig, PolicyChange, PolicyView, RepositoryEndpoint } from "@hive/shared";
import { parseBeesConfig, validateFormula } from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Canonical configuration is loaded only from its repository root.
import { join } from "node:path";
import { match } from "ts-pattern";

export type PolicySnapshot = Pick<
	BeesConfig,
	"formulas" | "limits" | "max_retries" | "ranking" | "retry_delay_ms"
>;
export interface ActivePolicy {
	/** Loaded configuration retained only for this live colony. */
	config: BeesConfig;
	/** Immutable revision actually applied by the actor. */
	revisionId: string;
}

/** Reload canonical recipes and policy together without restoring historical overrides. */
export async function loadPolicy(repository: RepositoryEndpoint): Promise<BeesConfig> {
	return parseBeesConfig(await Bun.file(join(repository.root, "bees.toml")).text());
}
/** Validate an explicit formula or complete limits replacement before mutating live state. */
export function updatePolicy(config: BeesConfig, change: PolicyChange): BeesConfig {
	return match(change)
		.with({ kind: "formula" }, ({ formula, name }) => {
			validateFormula(formula);
			return { ...config, formulas: { ...config.formulas, [name]: formula } };
		})
		.with({ kind: "limits" }, ({ limits }) => ({ ...config, limits }))
		.exhaustive();
}
/** Generic inspection deliberately excludes formula values and captured recipe defaults. */
export function policyView({ config, revisionId }: ActivePolicy): PolicyView {
	return {
		formulas: Object.keys(config.formulas).toSorted(),
		limits: config.limits,
		maxRetries: config.max_retries,
		ranking: config.ranking,
		retryDelayMs: config.retry_delay_ms,
		revisionId,
	};
}
/** The history snapshot contains scheduling/execution policy, never a recipe-default authority. */
export function policySnapshot(config: BeesConfig): PolicySnapshot {
	const { formulas, limits, max_retries, ranking, retry_delay_ms } = config;
	return { formulas, limits, max_retries, ranking, retry_delay_ms };
}
