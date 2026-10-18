import type { BeesConfig, PolicyChange, PolicyView, RepositoryEndpoint } from "@hive/shared";
import { loadBeesConfig } from "./config.ts";
import { match } from "ts-pattern";
import { validateFormula } from "@hive/shared";

export type PolicySnapshot = Pick<
	BeesConfig,
	| "auto_nurse"
	| "post_run_drone"
	| "formulas"
	| "inactivity_drone"
	| "limits"
	| "max_retries"
	| "ranking"
	| "retry_delay_ms"
>;
export interface ActivePolicy {
	/** Loaded configuration retained only for this live colony. */
	config: BeesConfig;
	/** Immutable revision actually applied by the actor. */
	revisionId: string;
}

/** Reload canonical recipes and policy together without restoring historical overrides. */
export async function loadPolicy(repository: RepositoryEndpoint): Promise<BeesConfig> {
	const { config } = await loadBeesConfig(repository.root);
	return config;
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
		autoNurse: config.auto_nurse,
		formulas: Object.keys(config.formulas).toSorted(),
		inactivityDrone: config.inactivity_drone,
		postRunDrone: config.post_run_drone,
		limits: config.limits,
		maxRetries: config.max_retries,
		ranking: config.ranking,
		retryDelayMs: config.retry_delay_ms,
		revisionId,
	};
}
/** The history snapshot contains scheduling/execution policy, never a recipe-default authority. */
export function policySnapshot(config: BeesConfig): PolicySnapshot {
	const {
		auto_nurse,
		post_run_drone,
		formulas,
		inactivity_drone,
		limits,
		max_retries,
		ranking,
		retry_delay_ms,
	} = config;
	return {
		auto_nurse,
		post_run_drone,
		formulas,
		inactivity_drone,
		limits,
		max_retries,
		ranking,
		retry_delay_ms,
	};
}
