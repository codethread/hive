/* eslint-disable no-await-in-loop -- Inspect every affected hook before the single native installation. */
import { BeeswaxError, EXIT, errorMessage } from "./errors.ts";
import type { ProcessResult, WorkspaceIO } from "./services.ts";
import { hookSection, updateHookSection } from "./hooks.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve checkout-local policy and common Git hook paths.
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";

const FIRST = 0;
const SINGLE = 1;
const PAIR = 2;
const TRIPLE = 3;
const requiredEvents = ["pre-commit", "pre-merge-commit"];
const policyPaths = ["hk.local.pkl", ".config/hk.local.pkl", "hk.pkl", ".config/hk.pkl"];
// eslint-disable-next-line no-template-curly-in-string -- Literal hk shell escape hatch, not JavaScript interpolation.
const guard = 'test "${HK:-1}" = "0" || ';
const minimumVersions = { git: "2.54.0", hk: "2.8.1" } as const;
const versionPatterns = {
	git: /^git version (?<version>\d+\.\d+(?:\.\d+)?)(?:[.\s]|$)/u,
	hk: /^hk (?<version>\d+\.\d+\.\d+)(?:\s|$)/u,
};
const validationSchema = z.object({
	path: z.string(),
	valid: z.literal(true),
});
const gitEvents = new Set([
	"applypatch-msg",
	"pre-applypatch",
	"post-applypatch",
	"pre-commit",
	"pre-merge-commit",
	"prepare-commit-msg",
	"commit-msg",
	"post-commit",
	"pre-rebase",
	"post-checkout",
	"post-merge",
	"pre-push",
	"pre-receive",
	"update",
	"proc-receive",
	"post-receive",
	"post-update",
	"reference-transaction",
	"push-to-checkout",
	"pre-auto-gc",
	"post-rewrite",
	"sendemail-validate",
	"fsmonitor-watchman",
	"p4-changelist",
	"p4-prepare-changelist",
	"p4-post-changelist",
	"p4-pre-submit",
	"post-index-change",
]);

type Launcher = "hk" | "mise";
interface GitSetting {
	/** Git's reported configuration scope, including inherited values. */
	scope: string;
	/** Git's reported source file or command origin. */
	origin: string;
	/** Canonical Git key (subsection spelling is significant). */
	key: string;
	/** Raw value; undefined represents an implicit boolean. */
	value: string | undefined;
}
interface HkRegistration {
	/** Native hk-owned Git event. */
	event: string;
	/** Recognized local launcher mode, retained on reinstall. */
	launcher: Launcher;
}
interface CheckoutInspection {
	/** Shared metadata location for both validator targets. */
	common: string;
	/** Repository-local, recognized native hk routes. */
	registrations: HkRegistration[];
}

/** Check application tools, local Pkl and hook ownership before setup or sync effects. */
export async function preflightHk(root: string, io: WorkspaceIO): Promise<void> {
	await inspectApplication(root, io);
}

/** Inspect checkout dispatch and ownership, including in the tracker, without invoking hk. */
export async function preflightHkCheckout(root: string, io: WorkspaceIO): Promise<void> {
	await inspectCheckout(root, io);
}

/**
 * Requires successful application preflight and installed current validators.
 * Rechecks checkout ownership before activation without repeating hk/Pkl checks; effects are not rolled back.
 */
// eslint-disable-next-line max-statements -- Snapshot validators, install once and verify native artifacts.
export async function installHk(root: string, io: WorkspaceIO): Promise<void> {
	const top = await applicationRoot(root, io);
	const before = await inspectCheckout(root, io, top);
	const validators = new Map<string, string>();
	for (const event of requiredEvents) {
		const path = join(before.common, "hooks", event);
		const contents = await io.read(path);
		if (!contents.includes(hookSection) || updateHookSection(contents) !== contents) {
			throw manual(
				`The current Beeswax validator must be installed at ${path} before hk installation.`,
			);
		}
		validators.set(path, contents);
	}
	const argv = ["hk", "install"];
	if (before.registrations.some(({ launcher }) => launcher === "mise")) {
		argv.push("--mise");
	}
	let installation: ProcessResult | undefined = undefined;
	try {
		installation = await captured(argv, root, io);
		await verifyInstallation({ root, before, validators }, io);
	} catch (error) {
		const context = {
			/** Invocation was attempted; even a failed installer may have changed files or config. */
			hkInstallAttempted: true,
			/** Installer returned exit code 0, not proof that subsequent verification passed. */
			hkInstallCompleted: installation !== undefined,
			/** Successful installer diagnostics retained when later verification fails. */
			hkInstallResult: installation,
		};
		if (error instanceof BeeswaxError) {
			throw new BeeswaxError(error.reason, error.message, {
				exitCode: error.exitCode,
				context: { ...error.context, ...context },
			});
		}
		throw manual(`hk installation or verification failed: ${errorMessage(error)}`, context);
	}
}

// --- Native CLI inspection and bounded ownership parsing ---

// eslint-disable-next-line max-statements -- Verify retained bytes and actual executable dispatch after installation.
async function verifyInstallation(
	options: { root: string; before: CheckoutInspection; validators: Map<string, string> },
	io: WorkspaceIO,
): Promise<void> {
	const { root, before, validators } = options;
	const after = await inspectCheckout(root, io);
	if (after.common !== before.common || after.registrations.length === FIRST) {
		throw manual(
			"hk install completed, but Git's common directory changed or no supported native hk registrations remain.",
		);
	}
	const expectedMode = before.registrations[FIRST]?.launcher;
	if (
		expectedMode !== undefined &&
		after.registrations.some(({ launcher }) => launcher !== expectedMode)
	) {
		throw manual("hk install changed the explicit native launcher mode.");
	}
	for (const [path, contents] of validators) {
		if (!(await io.exists(path)) || (await io.read(path)) !== contents) {
			throw manual(`hk install did not preserve the Beeswax validator at ${path}.`);
		}
	}
	for (const event of new Set([
		...requiredEvents,
		...after.registrations.map((entry) => entry.event),
	])) {
		const listed = await checked(["git", "hook", "list", "-z", "--show-scope", event], root, io);
		const routes = listed.split("\0").filter(Boolean);
		if (requiredEvents.includes(event) && !routes.includes("hook from hookdir")) {
			throw manual(`Git does not dispatch the executable common-directory validator for ${event}.`);
		}
		if (
			after.registrations.some((entry) => entry.event === event) &&
			routes.filter((route) => route === `local\thk-${event}`).length !== SINGLE
		) {
			throw manual(
				`Git does not dispatch exactly one enabled local native hk registration for ${event}.`,
			);
		}
	}
}

async function applicationRoot(root: string, io: WorkspaceIO): Promise<string> {
	const top = await checked(["git", "rev-parse", "--show-toplevel"], root, io);
	const prefix = await checked(["git", "rev-parse", "--show-prefix"], root, io);
	if (prefix.trim() !== "") {
		throw manual(`Run hk setup from the application checkout root ${top.trim()}, not ${root}.`);
	}
	const branch = await checked(["git", "branch", "--show-current"], root, io);
	if (branch.trim() === "tracker/state") {
		throw manual("Install hk from the intended application checkout, not tracker/state.");
	}
	return top.trim();
}

// eslint-disable-next-line max-statements -- Validate the application-local policy via hk's public JSON boundary.
async function inspectApplication(root: string, io: WorkspaceIO): Promise<CheckoutInspection> {
	const top = await applicationRoot(root, io);
	await requireVersion("hk", root, io);
	const inspection = await inspectCheckout(root, io, top);
	const output = await checked(["hk", "validate", "--json"], root, io);
	try {
		const validation = validationSchema.parse(JSON.parse(output), { jitless: true });
		if (
			!policyPaths.some(
				(path) => resolve(top.trim(), path) === resolve(top.trim(), validation.path),
			)
		) {
			throw manual(
				`Effective hk policy ${validation.path} is not an application-local hk Pkl file in ${root}.`,
			);
		}
	} catch (error) {
		if (error instanceof BeeswaxError) {
			throw error;
		}
		throw manual(`Cannot read hk validate --json: ${errorMessage(error)}`, { stdout: output });
	}
	return inspection;
}

// eslint-disable-next-line max-statements -- Inspect dispatch, shared ownership and all files hk's installer scans.
async function inspectCheckout(
	root: string,
	io: WorkspaceIO,
	physicalRoot?: string,
): Promise<CheckoutInspection> {
	await requireVersion("git", root, io);
	const settings = parseGitSettings(
		await checked(["git", "config", "--null", "--show-scope", "--show-origin", "--list"], root, io),
	);
	checkDispatch(settings);
	const commonPath = await checked(
		["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
		root,
		io,
	);
	const common = resolve(root, commonPath.trim());
	const top = physicalRoot ?? (await checked(["git", "rev-parse", "--show-toplevel"], root, io));
	const registrations = inspectRegistrations(settings, {
		root: top.trim(),
		config: join(common, "config"),
	});
	const hooks = join(common, "hooks");
	for (const name of await io.list(hooks)) {
		const path = join(hooks, name);
		const contents = await io.read(path);
		if (contents.includes(guard.slice(FIRST, -" || ".length)) && contents.includes("hk run")) {
			throw manual(
				`Legacy hk shim ${path} would be removed by hk install; agree a manual migration first.`,
			);
		}
	}
	for (const event of requiredEvents) {
		updateHookSection(await io.read(join(hooks, event)));
	}
	return { common, registrations };
}

// eslint-disable-next-line max-statements -- Decode scoped NUL triplets, distinguishing implicit and empty values.
function parseGitSettings(output: string): GitSetting[] {
	if (output === "") {
		return [];
	}
	const fields = output.split("\0");
	if (fields.pop() !== "" || fields.length % TRIPLE !== FIRST) {
		throw manual("Git returned malformed NUL-delimited scoped configuration.");
	}
	const settings: GitSetting[] = [];
	for (let index = FIRST; index < fields.length; index += TRIPLE) {
		const record = fields[index + PAIR]!;
		const separator = record.indexOf("\n");
		const setting: GitSetting = {
			scope: fields[index]!,
			origin: fields[index + SINGLE]!,
			key: record,
			value: undefined,
		};
		if (separator !== -SINGLE) {
			setting.key = record.slice(FIRST, separator);
			setting.value = record.slice(separator + SINGLE);
		}
		settings.push(setting);
	}
	return settings;
}

function effective(settings: GitSetting[], key: string): GitSetting | undefined {
	return settings.findLast((setting) => setting.key === key);
}

function enabled(setting: GitSetting | undefined): boolean {
	if (setting === undefined || setting.value === undefined) {
		return true;
	}
	const value = setting.value.trim().toLowerCase();
	if (
		["true", "yes", "on"].includes(value) ||
		(/^[+-]?\d+$/u.test(value) && Number(value) !== FIRST)
	) {
		return true;
	}
	if (["false", "no", "off", ""].includes(value) || Number(value) === FIRST) {
		return false;
	}
	throw manual(`Unsupported Git boolean ${setting.key}=${setting.value} from ${setting.origin}.`);
}

// eslint-disable-next-line max-statements -- Keep effective event and concurrency policy checks together.
function checkDispatch(settings: GitSetting[]): void {
	const hooksPath = effective(settings, "core.hookspath");
	if (hooksPath !== undefined) {
		throw manual(
			`Effective core.hooksPath from ${hooksPath.scope} ${hooksPath.origin} overrides the required common hooks.`,
		);
	}
	for (const event of requiredEvents) {
		if (!enabled(effective(settings, `hook.${event}.enabled`))) {
			throw manual(`Git disables required ${event} dispatch.`);
		}
	}
	const jobs =
		effective(settings, "hook.pre-merge-commit.jobs") ?? effective(settings, "hook.jobs");
	if (jobs !== undefined && (jobs.value === undefined || !/^\+?0*1$/u.test(jobs.value.trim()))) {
		throw manual(
			`Effective ${jobs.key}=${jobs.value} must be one for serial pre-merge-commit dispatch.`,
		);
	}
	for (const setting of settings) {
		if (
			/^hook\..*\.command$/u.test(setting.key) &&
			!setting.key.startsWith("hook.hk-") &&
			effective(settings, setting.key) === setting &&
			hasEvent(settings, setting.key.slice(FIRST, -".command".length)) &&
			/(?:^|[\s/'"])hk['"]?\s+(?:run|r|check|c|fix|f)(?:\s|$)/u.test(setting.value ?? "")
		) {
			throw manual(`Conflicting hk route ${setting.key} from ${setting.scope} ${setting.origin}.`);
		}
	}
}

function hasEvent(settings: GitSetting[], hook: string): boolean {
	const lastEvent = effective(settings, `${hook}.event`);
	return lastEvent !== undefined && lastEvent.value !== "";
}

// eslint-disable-next-line max-statements -- Verify all entries hk install removes, not just effective commands.
function inspectRegistrations(
	settings: GitSetting[],
	location: { root: string; config: string },
): HkRegistration[] {
	const groups = new Map<string, GitSetting[]>();
	for (const setting of settings.filter(({ key }) => key.startsWith("hook.hk-"))) {
		if (setting.scope !== "local") {
			throw manual(
				`External hk registration ${setting.key} from ${setting.scope} ${setting.origin}.`,
			);
		}
		if (
			!setting.origin.startsWith("file:") ||
			resolve(location.root, setting.origin.slice("file:".length)) !== location.config
		) {
			throw manual(
				`Local hk setting ${setting.key} comes from ${setting.origin}, not ${location.config}.`,
			);
		}
		const match = /^hook\.hk-(?<event>[a-z][a-z-]*)\.(?:command|event)$/u.exec(setting.key);
		if (!match?.groups) {
			throw manual(`Unrecognized local hk setting ${setting.key}; hk install would remove it.`);
		}
		const { event } = match.groups;
		const group = groups.get(event!) ?? [];
		group.push(setting);
		groups.set(event!, group);
	}
	const registrations: HkRegistration[] = [];
	for (const [event, group] of groups) {
		const commands = group.filter(({ key }) => key.endsWith(".command"));
		const events = group.filter(({ key }) => key.endsWith(".event"));
		if (
			!gitEvents.has(event) ||
			commands.length !== SINGLE ||
			events.length !== SINGLE ||
			events[FIRST]!.value !== event
		) {
			throw manual(`Duplicate, incomplete or conflicting native hk registration for ${event}.`);
		}
		if (!enabled(effective(settings, `hook.${event}.enabled`))) {
			throw manual(`Git disables the native hk event ${event}.`);
		}
		registrations.push({ event, launcher: parseLauncher(commands[FIRST]!.value ?? "", event) });
	}
	if (new Set(registrations.map(({ launcher }) => launcher)).size > SINGLE) {
		throw manual(
			"Native hk entries mix direct and mise launchers; agree the intended mode manually.",
		);
	}
	return registrations;
}

// eslint-disable-next-line max-statements -- Match bounded native launcher forms without evaluating shell.
function parseLauncher(command: string, event: string): Launcher {
	const suffix = ` run ${event} --from-hook`;
	if (!command.startsWith(guard) || !command.endsWith(suffix)) {
		throw manual(`Unrecognized native hk command for ${event}: ${command}`);
	}
	const launcher = command.slice(guard.length, -suffix.length);
	if (launcher === "mise x -- hk") {
		return "mise";
	}
	if (launcher === "hk") {
		return "hk";
	}
	const fallback = /^PATH="\$PATH":(?<path>.+) hk$/u.exec(launcher)?.groups?.path;
	if (fallback !== undefined) {
		let path = fallback;
		if (fallback.startsWith("'") && fallback.endsWith("'")) {
			path = fallback.slice(SINGLE, -SINGLE).replaceAll(String.raw`'\''`, "'");
		}
		let quoted = path;
		if (!/^[a-zA-Z0-9_@%+=:,./-]+$/u.test(path)) {
			quoted = `'${path.replaceAll("'", String.raw`'\''`)}'`;
		}
		if (isAbsolute(path) && quoted === fallback && !path.includes("\n")) {
			return "hk";
		}
	}
	throw manual(`Unrecognized native hk launcher for ${event}: ${launcher}`);
}

async function requireVersion(tool: "git" | "hk", root: string, io: WorkspaceIO): Promise<void> {
	const output = await checked([tool, "--version"], root, io);
	const minimum = minimumVersions[tool].split(".").map(Number);
	const match = versionPatterns[tool].exec(output.trim());
	const version = match?.groups?.version?.split(".").map(Number);
	const difference =
		version &&
		minimum.map((part, index) => (version[index] ?? FIRST) - part).find((part) => part !== FIRST);
	if (!version || (difference !== undefined && difference < FIRST)) {
		throw manual(
			`Native hk hooks require ${tool} >=${minimum.join(".")}; observed ${output.trim()}.`,
		);
	}
}

async function checked(argv: string[], root: string, io: WorkspaceIO): Promise<string> {
	const result = await captured(argv, root, io);
	return result.stdout;
}

async function captured(argv: string[], root: string, io: WorkspaceIO): Promise<ProcessResult> {
	try {
		const result = await io.exec(argv, root);
		if (result.exitCode !== EXIT.success) {
			throw manual(
				`${argv.join(" ")} failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`,
				{
					argv,
					root,
					...result,
				},
			);
		}
		return result;
	} catch (error) {
		if (error instanceof BeeswaxError) {
			throw error;
		}
		throw manual(`${argv.join(" ")} could not run: ${errorMessage(error)}`, { argv, root });
	}
}

function manual(message: string, context: Record<string, unknown> = {}): BeeswaxError {
	return new BeeswaxError(
		"hk_integration_required",
		`${message} Use beeswax setup --hooks manual for agent-guided integration.`,
		{
			context: { ...context, nextCommand: "beeswax setup --hooks manual" },
		},
	);
}
