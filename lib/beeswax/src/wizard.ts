import { BeeswaxError, EXIT } from "./errors.ts";
import type { SetupFlags, SetupHook, SetupOptions, TrackerMode } from "./setup.ts";
import { confirm, intro, isCancel, multiselect, outro, select, text } from "@clack/prompts";
import type { CANCEL_SYMBOL } from "@clack/prompts";
import type { OnboardingConfig } from "./onboarding.ts";
import type { OnboardingFlags } from "./config.ts";
import { selectHookConfig } from "./config.ts";

const EMPTY = 0;

/** Clack owns the terminal; returned options use exactly the CLI's deterministic setup path. */
// eslint-disable-next-line max-statements -- Keep this ordered CLI operation and its result together.
export async function setupWizard(flags: SetupFlags, defaults: SetupOptions): Promise<SetupFlags> {
	intro("Set up this repository with Beeswax");
	const hooks =
		flags.hooks ??
		take(
			await select<SetupHook>({
				message: "Git hook setup",
				initialValue: defaults.hooks,
				options: [
					{ value: "husky", label: "Husky", hint: "bundled runner, no app dependency" },
					{
						value: "hk",
						label: "hk",
						hint: "hk >=2.8.1, Git >=2.54, application-owned Pkl",
					},
					{ value: "git", label: "Git hooks directly" },
					{ value: "none", label: "Install validation only; skip framework bootstrap" },
					{
						value: "manual",
						label: "Manual integration guidance",
						hint: "print instructions without changing this repository",
					},
				],
			}),
		);
	if (hooks === "manual") {
		outro("Printing manual integration guidance; no setup changes");
		return { ...flags, hooks };
	}
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
					{ value: "none", label: "Skip tracker operations; continue repository setup" },
				],
			}),
		);
	const selected: SetupFlags = { ...flags, hooks, tracker };
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
	if (hooks !== "hk") {
		const hookConfig = selectHookConfig(defaults.config, hooks);
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
	}
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
	Object.assign(selected, await onboardingWizard(flags, defaults.config.onboarding));
	selected.installWorkflowSkill =
		flags.installWorkflowSkill ??
		take(
			await confirm({
				message:
					"Install the optional hive workflow skill? Requires Node >=22.20.0, npm/npx and network.",
				initialValue: false,
			}),
		);
	outro("Applying repository setup");
	return selected;
}

/** Choose only repository-local harness adapters; no personal settings are written. */
export async function onboardingWizard(
	flags: OnboardingFlags,
	current: OnboardingConfig | undefined,
): Promise<OnboardingFlags> {
	if (flags.harness !== undefined) {
		return flags;
	}
	const harnesses = await multiselect({
		message: "Harnesses to receive Hive conventions in this repository",
		initialValues: current?.harnesses ?? [],
		required: false,
		options: [
			{ value: "claude", label: "Claude Code" },
			{ value: "codex", label: "Codex" },
			{ value: "pi", label: "Pi" },
		],
	});
	if (isCancel(harnesses)) {
		throw new BeeswaxError("cancelled", "Onboarding cancelled before making changes.", {
			exitCode: EXIT.cancelled,
		});
	}
	let harness: string[] = harnesses;
	if (harness.length === EMPTY) {
		harness = ["none"];
	}
	return { ...flags, harness };
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
