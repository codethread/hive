/* eslint-disable require-await -- In-memory WorkspaceIO implements captured asynchronous commands. */
import type { ProcessResult, WorkspaceIO } from "../src/services.ts";
import { expect, test } from "bun:test";
import { installHk, preflightHk, preflightHkCheckout } from "../src/hk.ts";
import { BeeswaxError } from "../src/errors.ts";
import { hookSection } from "../src/hooks.ts";

const root = "/repo";
const common = "/repo/.git";
// eslint-disable-next-line no-template-curly-in-string -- Literal hk shell syntax.
const guard = 'test "${HK:-1}" = "0" || ';
const FIRST = 0;
const SINGLE = 1;
interface Setting {
	/** Configuration scope reported by Git. */
	scope: string;
	/** Git's canonical configuration key. */
	key: string;
	/** Raw configuration value. */
	value: string;
	/** Explicit include-file origin for ownership rejection cases. */
	origin?: string;
}

function registration(event = "pre-commit", launcher = "hk"): Setting[] {
	return [
		{
			scope: "local",
			key: `hook.hk-${event}.command`,
			value: `${guard}${launcher} run ${event} --from-hook`,
		},
		{ scope: "local", key: `hook.hk-${event}.event`, value: event },
	];
}

// eslint-disable-next-line max-statements -- One small native provider fake; no processes or project checks execute.
function hkFixture() {
	const files = new Map<string, string>();
	const unexpected = async (): Promise<never> => {
		throw new Error("Unexpected hk test effect");
	};
	const deps: WorkspaceIO = {
		read: async (path) => files.get(path) ?? "",
		exists: async (path) => files.has(path),
		write: unexpected,
		remove: unexpected,
		chmod: unexpected,
		command: unexpected,
		list: unexpected,
		exec: unexpected,
	};
	const fx = { files, deps };
	const calls: { argv: string[]; cwd: string }[] = [];
	const state = {
		settings: [] as Setting[],
		branch: "main",
		top: root,
		prefix: "",
		gitVersion: "git version 2.54.0",
		hkVersion: "hk 2.8.1",
		validation: JSON.stringify({ path: "/repo/hk.pkl", valid: true, warnings: [] }),
		installEvents: ["pre-commit"],
		installer: { exitCode: 0, stdout: "", stderr: "" } as ProcessResult,
		configFailure: false,
		rawConfig: "",
		missingHk: false,
		damageValidator: false,
		nonexecutable: false,
		hiddenNative: false,
	};
	fx.files.set("/repo/hk.pkl", "project-owned Pkl, never parsed or rewritten");
	fx.deps.list = async (path) =>
		[...fx.files.keys()]
			.filter((file) => file.startsWith(`${path}/`))
			.map((file) => file.slice(path.length + SINGLE));
	// eslint-disable-next-line max-statements -- Dispatch known read commands and one installer effect.
	fx.deps.exec = async (argv, cwd) => {
		calls.push({ argv: [...argv], cwd });
		const command = argv.join(" ");
		let stdout = "";
		switch (command) {
			case "git --version": {
				stdout = state.gitVersion;
				break;
			}
			case "hk --version": {
				if (state.missingHk) {
					throw new Error("spawn hk ENOENT");
				}
				stdout = state.hkVersion;
				break;
			}
			case "git rev-parse --show-toplevel": {
				stdout = state.top;
				break;
			}
			case "git rev-parse --show-prefix": {
				stdout = state.prefix;
				break;
			}
			case "git branch --show-current": {
				stdout = state.branch;
				break;
			}
			case "git rev-parse --path-format=absolute --git-common-dir": {
				stdout = common;
				break;
			}
			case "hk validate --json": {
				stdout = state.validation;
				break;
			}
			case "git config --null --show-scope --show-origin --list": {
				if (state.configFailure) {
					return { exitCode: 3, stdout: "", stderr: "cannot read Git configuration" };
				}
				stdout =
					state.rawConfig ||
					state.settings
						.map(
							({ scope, key, value, origin = `file:${common}/config` }) =>
								`${scope}\0${origin}\0${key}\n${value}\0`,
						)
						.join("");
				break;
			}
			case "hk install":
			case "hk install --mise": {
				if (state.installer.exitCode !== FIRST) {
					return state.installer;
				}
				let launcher = 'PATH="$PATH":/opt/hk/bin hk';
				if (argv.includes("--mise")) {
					launcher = "mise x -- hk";
				}
				state.settings = state.settings.filter(({ key }) => !key.startsWith("hook.hk-"));
				state.settings.push(
					...state.installEvents.flatMap((event) => registration(event, launcher)),
				);
				if (state.damageValidator) {
					fx.files.set(`${common}/hooks/pre-merge-commit`, "#!/bin/sh\n");
				}
				return state.installer;
			}
			default: {
				if (command.startsWith("git hook list -z --show-scope ")) {
					const event = argv.at(-SINGLE)!;
					const routes = state.settings
						.filter(({ key, value }) => key.endsWith(".event") && value === event)
						.filter(() => !state.hiddenNative)
						.map(({ scope, key }) => `${scope}\t${key.slice("hook.".length, -".event".length)}`);
					if (!state.nonexecutable && fx.files.has(`${common}/hooks/${event}`)) {
						routes.push("hook from hookdir");
					}
					stdout = `${routes.join("\0")}\0`;
					break;
				}
				throw new Error(`Unexpected hk test command: ${command}`);
			}
		}
		return { exitCode: 0, stdout, stderr: "" };
	};
	return { ...fx, state, calls };
}

function addValidators(files: Map<string, string>): void {
	for (const event of ["pre-commit", "pre-merge-commit"]) {
		files.set(
			`${common}/hooks/${event}`,
			`#!/bin/sh\n# application header\n${hookSection}\n# application footer\n`,
		);
	}
}

test.each([
	{ git: "git version 2.53.9", hk: "hk 2.8.1" },
	{ git: "git version 2.54.0", hk: "hk 2.8.0" },
	{ git: "git version 2.54.0", hk: "hk 2.8.1-rc.1" },
	{ git: "unknown", hk: "hk 2.8.1" },
])("unsupported binaries $git / $hk provide manual integration guidance", async ({ git, hk }) => {
	const fx = hkFixture();
	fx.state.gitVersion = git;
	fx.state.hkVersion = hk;
	const failure = await preflightHk(root, fx.deps).catch((error: unknown) => error);
	expect(failure).toBeInstanceOf(BeeswaxError);
	expect(failure).toMatchObject({ context: { nextCommand: "beeswax setup --hooks manual" } });
});

test("application setup refuses a subdirectory or a missing hk binary", async () => {
	const fx = hkFixture();
	fx.state.prefix = "sub/";
	await expect(preflightHk(root, fx.deps)).rejects.toBeInstanceOf(BeeswaxError);
	fx.state.prefix = "";
	fx.state.missingHk = true;
	await expect(preflightHk(root, fx.deps)).rejects.toBeInstanceOf(BeeswaxError);
});

test("tracker checkout inspection needs neither hk nor Pkl nor existing validator targets", async () => {
	const fx = hkFixture();
	fx.state.branch = "tracker/state";
	fx.state.missingHk = true;
	fx.files.clear();
	await preflightHkCheckout(root, fx.deps);
	expect(fx.calls.every(({ argv }) => argv[FIRST] === "git")).toBe(true);
	await expect(preflightHk(root, fx.deps)).rejects.toBeInstanceOf(BeeswaxError);
});

test.each([
	{ launcher: "hk" },
	{ launcher: 'PATH="$PATH":/opt/hk/bin hk' },
	{ launcher: "PATH=\"$PATH\":'/opt/hk bin' hk" },
	{ launcher: String.raw`PATH="$PATH":'/opt/hk'\''s bin' hk` },
	{ launcher: "mise x -- hk" },
])("recognizes bounded native launcher $launcher without executing it", async ({ launcher }) => {
	const fx = hkFixture();
	fx.state.settings.push(...registration("pre-commit", launcher));
	await preflightHk(root, fx.deps);
	expect(fx.calls.some(({ argv }) => argv.includes("run") || argv.includes("install"))).toBe(false);
});

test.each([{ scope: "system" }, { scope: "global" }, { scope: "worktree" }, { scope: "command" }])(
	"rejects $scope hk ownership without changing files or registrations",
	async ({ scope }) => {
		const fx = hkFixture();
		fx.state.settings.push(
			...registration().map((entry) => {
				entry.scope = scope;
				return entry;
			}),
		);
		const before = new Map(fx.files);
		await expect(preflightHk(root, fx.deps)).rejects.toBeInstanceOf(BeeswaxError);
		expect(fx.files).toEqual(before);
		expect(fx.calls.some(({ argv }) => argv.includes("install"))).toBe(false);
	},
);

test.each([
	{ key: "core.hookspath", value: "custom", scope: "local" },
	{ key: "core.hookspath", value: "", scope: "worktree" },
	{ key: "hook.pre-commit.enabled", value: "false", scope: "global" },
	{ key: "hook.pre-merge-commit.enabled", value: "0", scope: "local" },
	{ key: "hook.hk-pre-commit.enabled", value: "false", scope: "local" },
	{ key: "hook.pre-merge-commit.jobs", value: "2", scope: "local" },
	{ key: "hook.jobs", value: "-1", scope: "global" },
	{ key: "hook.other.command", value: "hk run pre-commit", scope: "local" },
	{ key: "hook.other.command", value: "/opt/bin/hk run pre-commit", scope: "global" },
])("unsafe effective $key=$value from $scope refuses installation", async (setting) => {
	const fx = hkFixture();
	fx.state.settings.push(setting);
	if (setting.key.endsWith(".command")) {
		fx.state.settings.push({ scope: "local", key: "hook.other.event", value: "pre-commit" });
	}
	await expect(preflightHk(root, fx.deps)).rejects.toBeInstanceOf(BeeswaxError);
	expect(fx.calls.some(({ argv }) => argv.includes("install"))).toBe(false);
});

test("effective event override restores serial merge dispatch and preserves unrelated disabled policy", async () => {
	const fx = hkFixture();
	fx.state.settings.push(
		{ scope: "global", key: "hook.jobs", value: "8" },
		{ scope: "global", key: "hook.pre-commit.enabled", value: "false" },
		{ scope: "local", key: "hook.pre-merge-commit.jobs", value: "1" },
		{ scope: "local", key: "hook.pre-commit.enabled", value: "true" },
		{ scope: "local", key: "hook.unrelated.enabled", value: "false" },
	);
	await preflightHk(root, fx.deps);
});

test.each([
	{ description: "altered command", settings: registration("pre-commit", "hk; echo unsafe") },
	{ description: "duplicate command", settings: [...registration(), registration()[FIRST]!] },
	{ description: "duplicate event", settings: [...registration(), registration()[SINGLE]!] },
	{
		description: "crossed event",
		settings: [registration()[FIRST]!, { ...registration()[SINGLE]!, value: "pre-push" }],
	},
	{ description: "incomplete entry", settings: [registration()[FIRST]!] },
	{ description: "unknown event", settings: registration("custom-event") },
	{
		description: "mixed launchers",
		settings: [...registration(), ...registration("pre-push", "mise x -- hk")],
	},
	{
		description: "shell substitution",
		settings: registration("pre-commit", 'PATH="$PATH":$(echo /opt) hk'),
	},
	{
		description: "extra argument",
		settings: [
			{
				scope: "local",
				key: "hook.hk-pre-commit.command",
				value: `${guard}hk run pre-commit --from-hook --staged`,
			},
			registration()[SINGLE]!,
		],
	},
])("rejects $description native registrations", async ({ settings }) => {
	const fx = hkFixture();
	fx.state.settings = [...settings];
	await expect(preflightHk(root, fx.deps)).rejects.toBeInstanceOf(BeeswaxError);
});

test("legacy shims in any common hook file refuse before hk scans and removes them", async () => {
	const fx = hkFixture();
	fx.files.set(
		`${common}/hooks/pre-push`,
		`#!/bin/sh\n${guard}exec hk run pre-push --from-hook "$@"`,
	);
	const before = new Map(fx.files);
	await expect(preflightHk(root, fx.deps)).rejects.toBeInstanceOf(BeeswaxError);
	expect(fx.files).toEqual(before);
});

test("unknown shell ownership and edited Beeswax sections require migration without writes", async () => {
	const fx = hkFixture();
	fx.files.set(`${common}/hooks/pre-commit`, "#!/bin/sh\ncustom-check\n");
	await expect(preflightHk(root, fx.deps)).rejects.toBeInstanceOf(BeeswaxError);
	fx.files.set(`${common}/hooks/pre-commit`, hookSection.replace("hooks validate", "hooks custom"));
	await expect(preflightHk(root, fx.deps)).rejects.toBeInstanceOf(BeeswaxError);
});

test.each([
	{ path: "/hk.pkl", valid: true, warnings: [] },
	{ path: "/repo/sub/hk.pkl", valid: true, warnings: [] },
	{ path: "/repo/hk.pkl", valid: false, warnings: [] },
	{ config_path: "/repo/hk.pkl", valid: true, warnings: [] },
])("rejects invalid validation response or ancestor policy: $path", async (validation) => {
	const fx = hkFixture();
	fx.state.validation = JSON.stringify(validation);
	await expect(preflightHk(root, fx.deps)).rejects.toBeInstanceOf(BeeswaxError);
});

test.each(["hk.local.pkl", ".config/hk.local.pkl", "hk.pkl", ".config/hk.pkl"])(
	"accepts the effective root-local policy %s without reading Pkl",
	async (path) => {
		const fx = hkFixture();
		fx.state.validation = JSON.stringify({
			path: `/repo/${path}`,
			valid: true,
			warnings: ["project-owned warning"],
		});
		await preflightHk(root, fx.deps);
	},
);

test.each([
	{ state: "fresh", existing: [] },
	{ state: "existing native", existing: registration("pre-commit", 'PATH="$PATH":/opt/hk/bin hk') },
])("$state installation preserves Pkl, unrelated settings and validators", async ({ existing }) => {
	const fx = hkFixture();
	const unrelated = { scope: "local", key: "hook.lint.command", value: "cargo fmt --check" };
	fx.state.settings.push(...existing, unrelated, {
		scope: "global",
		key: "user.name",
		value: "Operator",
	});
	addValidators(fx.files);
	const before = new Map(fx.files);
	await installHk(root, fx.deps);
	expect(fx.files).toEqual(before);
	expect(fx.state.settings).toContainEqual(unrelated);
	expect(fx.state.settings.filter(({ key }) => key.endsWith(".event"))).toEqual([
		{ scope: "local", key: "hook.hk-pre-commit.event", value: "pre-commit" },
	]);
	expect(fx.calls.filter(({ argv }) => argv[FIRST] === "hk" && argv[SINGLE] === "install")).toEqual(
		[{ argv: ["hk", "install"], cwd: root }],
	);
});

test("reinstallation retains the existing explicit mise launcher", async () => {
	const fx = hkFixture();
	fx.state.settings.push(...registration("pre-commit", "mise x -- hk"));
	addValidators(fx.files);
	await installHk(root, fx.deps);
	expect(fx.calls).toContainEqual({ argv: ["hk", "install", "--mise"], cwd: root });
	expect(fx.state.settings).toContainEqual(registration("pre-commit", "mise x -- hk")[FIRST]!);
});

test("failing native children retain captured diagnostics without policy rewrites", async () => {
	const fx = hkFixture();
	addValidators(fx.files);
	const before = new Map(fx.files);
	fx.state.installer = {
		exitCode: 7,
		stdout: "partial native output",
		stderr: "installer diagnostic",
	};
	const failure = await installHk(root, fx.deps).catch((error: unknown) => error);
	expect(failure).toBeInstanceOf(BeeswaxError);
	expect(failure).toMatchObject({
		context: {
			exitCode: 7,
			stdout: "partial native output",
			stderr: "installer diagnostic",
			hkInstallAttempted: true,
			hkInstallCompleted: false,
		},
	});
	expect(fx.files).toEqual(before);
	fx.state.configFailure = true;
	await expect(preflightHk(root, fx.deps)).rejects.toMatchObject({
		context: { stderr: "cannot read Git configuration" },
	});
});

test.each([
	{
		description: "empty native installation",
		installEvents: [],
		damage: false,
		nonexecutable: false,
		hidden: false,
	},
	{
		description: "changed validator",
		installEvents: ["pre-commit"],
		damage: true,
		nonexecutable: false,
		hidden: false,
	},
	{
		description: "nonexecutable validator",
		installEvents: ["pre-commit"],
		damage: false,
		nonexecutable: true,
		hidden: false,
	},
	{
		description: "missing native dispatch",
		installEvents: ["pre-commit"],
		damage: false,
		nonexecutable: false,
		hidden: true,
	},
])(
	"post-install $description fails without pretending rollback",
	async ({ installEvents, damage, nonexecutable, hidden }) => {
		const fx = hkFixture();
		addValidators(fx.files);
		Object.assign(fx.state, {
			installEvents: [...installEvents],
			damageValidator: damage,
			nonexecutable,
			hiddenNative: hidden,
			installer: { exitCode: 0, stdout: "native install completed", stderr: "native warning" },
		});
		const policy = fx.files.get("/repo/hk.pkl");
		const failure = await installHk(root, fx.deps).catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(BeeswaxError);
		expect(failure).toMatchObject({
			context: {
				hkInstallCompleted: true,
				hkInstallResult: { stdout: "native install completed", stderr: "native warning" },
			},
		});
		expect(fx.files.get("/repo/hk.pkl")).toBe(policy);
		expect(fx.calls.filter(({ argv }) => argv.includes("install"))).toHaveLength(SINGLE);
	},
);

test("linked application policy resolves against Git's physical root and shares common validators", async () => {
	const fx = hkFixture();
	fx.state.top = "/physical/app";
	fx.state.validation = JSON.stringify({
		path: "/physical/app/.config/hk.pkl",
		valid: true,
		warnings: [],
	});
	fx.state.installEvents = ["pre-push"];
	addValidators(fx.files);
	await installHk("/linked/app", fx.deps);
	expect(fx.calls.every(({ cwd }) => cwd === "/linked/app")).toBe(true);
	expect(fx.state.settings).toContainEqual(registration("pre-push")[SINGLE]!);
});

test("inactive and overridden unrelated hk commands are not duplicate dispatch", async () => {
	const fx = hkFixture();
	fx.state.settings.push(
		{ scope: "local", key: "hook.dormant.command", value: "hk run pre-commit" },
		{ scope: "global", key: "hook.lint.command", value: "hk run pre-commit" },
		{ scope: "local", key: "hook.lint.command", value: "cargo fmt --check" },
		{ scope: "local", key: "hook.lint.event", value: "pre-commit" },
		{ scope: "local", key: "hook.reset.command", value: "hk run pre-commit" },
		{ scope: "local", key: "hook.reset.event", value: "pre-commit" },
		{ scope: "local", key: "hook.reset.event", value: "" },
	);
	await preflightHk(root, fx.deps);
});

test("scoped configuration distinguishes implicit booleans and rejects malformed native framing", async () => {
	const fx = hkFixture();
	fx.state.rawConfig = "local\0file:/config\0hook.pre-commit.enabled\0";
	await preflightHk(root, fx.deps);
	fx.state.rawConfig = "local\0file:/config\0hook.pre-commit.enabled\n\0";
	await expect(preflightHk(root, fx.deps)).rejects.toBeInstanceOf(BeeswaxError);
	fx.state.rawConfig = "local\0file:/config\0hook.pre-commit.enabled\ntrue";
	await expect(preflightHk(root, fx.deps)).rejects.toBeInstanceOf(BeeswaxError);
});

test("invalid hk JSON retains its actual output rather than pretending a policy was validated", async () => {
	const fx = hkFixture();
	fx.state.validation = "not JSON";
	const failure = await preflightHk(root, fx.deps).catch((error: unknown) => error);
	expect(failure).toBeInstanceOf(BeeswaxError);
	expect(failure).toMatchObject({ context: { stdout: "not JSON" } });
});

test("local-scope include-file hk entries are not owned by the common Git config installer", async () => {
	const fx = hkFixture();
	fx.state.settings.push(
		...registration().map((entry) => {
			entry.origin = "file:/repo/hooks.inc";
			return entry;
		}),
	);
	await expect(preflightHk(root, fx.deps)).rejects.toBeInstanceOf(BeeswaxError);
	expect(fx.calls.some(({ argv }) => argv.includes("install"))).toBe(false);
});

test("ordinary relative local-config origins remain recognizable", async () => {
	const fx = hkFixture();
	fx.state.settings.push(
		...registration().map((entry) => {
			entry.origin = "file:.git/config";
			return entry;
		}),
	);
	await preflightHk(root, fx.deps);
});
