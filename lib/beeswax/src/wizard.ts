import { BeeswaxError, EXIT } from "./errors.ts";
import type { SetupFlags, SetupOptions, TrackerMode } from "./setup.ts";
import { confirm, intro, isCancel, outro, select, text } from "@clack/prompts";
import type { CANCEL_SYMBOL } from "@clack/prompts";
import type { HookAdapter } from "./config.ts";
import { selectHookConfig } from "./config.ts";

/** Clack owns the terminal; returned options use exactly the CLI's deterministic setup path. */
// eslint-disable-next-line max-statements -- Keep this ordered CLI operation and its result together.
export async function setupWizard(flags: SetupFlags, defaults: SetupOptions): Promise<SetupFlags> {
	intro("Set up this repository with Beeswax");
	const tracker =
		flags.tracker ??
		take(
			await select<TrackerMode>({
				message: "Tracker setup",
				initialValue: defaults.tracker,
				options: [
					{ value: "init", label: "Initialize this repository's first tracker" },
					{ value: "bootstrap", label: "Bootstrap the published tracker/state branch" },
					{ value: "adopt", label: "Use an existing tracker database" },
					{ value: "none", label: "Configure Git hooks and merge driver only" },
				],
			}),
		);
	const selected: SetupFlags = { ...flags, tracker };
	if (selected.tracker === "init") {
		selected.prefix =
			flags.prefix ??
			take(
				await text({
					message: "Issue prefix",
					defaultValue: defaults.prefix,
					placeholder: defaults.prefix,
				}),
			);
		selected.owner =
			flags.owner ??
			take(
				await text({
					message: "Accountable human owner",
					defaultValue: defaults.owner,
					placeholder: defaults.owner,
				}),
			);
	}
	if (selected.tracker === "adopt") {
		selected.beadsDb =
			flags.beadsDb ??
			take(
				await text({
					message: "Existing tracker database",
					defaultValue: defaults.beadsDb,
					placeholder: defaults.beadsDb,
				}),
			);
	}
	selected.hooks =
		flags.hooks ??
		take(
			await select<HookAdapter>({
				message: "Git hook adapter",
				initialValue: defaults.hooks,
				options: [
					{ value: "husky", label: "Husky", hint: "default; bundled runner, no app dependency" },
					{ value: "git", label: "Git hooks directly" },
					{ value: "none", label: "Use configured hook paths without framework bootstrap" },
				],
			}),
		);
	const hookConfig = selectHookConfig(defaults.config, selected.hooks);
	selected.preCommit =
		flags.preCommit ??
		take(
			await text({
				message: "Commit hook file",
				defaultValue: hookConfig.hooks.pre_commit,
				placeholder: hookConfig.hooks.pre_commit,
			}),
		);
	selected.preMergeCommit =
		flags.preMergeCommit ??
		take(
			await text({
				message: "Merge hook file",
				defaultValue: hookConfig.hooks.pre_merge_commit,
				placeholder: hookConfig.hooks.pre_merge_commit,
			}),
		);
	if (selected.tracker !== "none") {
		selected.environment =
			flags.environment ??
			take(
				await select<"mise" | "none">({
					message: "Shell environment integration",
					initialValue: defaults.environment,
					options: [
						{ value: "none", label: "Use Beeswax environment output" },
						{ value: "mise", label: "Mise" },
					],
				}),
			);
		selected.codex =
			flags.codex ??
			take(
				await confirm({
					message: "Configure Codex's local tracker environment?",
					initialValue: defaults.codex,
				}),
			);
	}
	outro("Applying repository setup");
	return selected;
}

// --- Private functions ---

function take<Value extends string | boolean>(value: Value | typeof CANCEL_SYMBOL): Value {
	if (isCancel(value)) {
		throw new BeeswaxError("cancelled", "Setup cancelled before making changes.", {
			exitCode: EXIT.cancelled,
		});
	}
	return value;
}
