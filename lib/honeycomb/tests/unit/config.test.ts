import { describe, expect, test } from "bun:test";
import { parseConfig as parseTomlConfig } from "../../src/config.ts";
import {
	explainPolicy,
	resolveEffectiveCommand,
	resolvePreRemoteCheck,
	type ProjectConfig,
} from "../../src/domain/config.ts";
import { ConfigError, EXIT_CODES } from "../../src/errors.ts";

const parseConfig = (toml: string) =>
	parseTomlConfig(toml, {
		home: "/home/test",
		cwd: "/work",
		normalizePath: (path) => path,
	});

describe("parseConfig", () => {
	const locationConfig = `worktree_location = "sibling"
[[rule]]
root_glob = "/tmp/**"
worktree_location = "nested"
[[project]]
root = "/tmp/repo"
worktree_location = "sibling"`;
	test.each([
		{ name: "built-in default", toml: "", root: "/repo", expected: "sibling" },
		{ name: "global default", toml: locationConfig, root: "/elsewhere", expected: "sibling" },
		{ name: "matching rule", toml: locationConfig, root: "/tmp/other", expected: "nested" },
		{ name: "project override", toml: locationConfig, root: "/tmp/repo", expected: "sibling" },
	])("resolves worktree location from $name", ({ toml, root, expected }) => {
		expect(explainPolicy(parseConfig(toml), root).worktreeLocation).toBe(expected);
	});
	test.each([
		'worktree_location = "elsewhere"',
		'[[rule]]\nroot_glob = "/tmp/**"\nworktree_location = "elsewhere"',
	])("rejects invalid worktree location: %s", (toml) => {
		expect(() => parseConfig(toml)).toThrow("worktree_location");
	});

	test.each<{ name: string; toml: string; expected: ProjectConfig[] }>([
		{
			name: "pooled home-relative project",
			toml: '[[project]]\nname = "app"\nroot = "~/work/app"\ncommand = "yarn install"\npool_size = 5',
			expected: [
				{
					name: "app",
					root: "/home/test/work/app",
					command: "yarn install",
					poolSize: 5,
					copyModeDefault: "copy",
					copy: [],
				},
			],
		},
		{
			name: "non-pooled cwd-relative project",
			toml: '[[project]]\nroot = "./relative/repo"\ncommand = "echo ready"',
			expected: [
				{
					name: "repo",
					root: "/work/relative/repo",
					command: "echo ready",
					poolSize: null,
					copyModeDefault: "copy",
					copy: [],
				},
			],
		},
		{
			name: "mixed projects",
			toml: '[[project]]\nroot = "/tmp/one"\ncommand = "echo one"\n[[project]]\nroot = "/tmp/two"\ncommand = "echo two"\npool_size = 2',
			expected: [
				{
					name: "one",
					root: "/tmp/one",
					command: "echo one",
					poolSize: null,
					copyModeDefault: "copy",
					copy: [],
				},
				{
					name: "two",
					root: "/tmp/two",
					command: "echo two",
					poolSize: 2,
					copyModeDefault: "copy",
					copy: [],
				},
			],
		},
	])("parses $name", ({ toml, expected }) => {
		expect(parseConfig(toml).projects).toEqual(expected);
	});

	test.each([
		{
			name: "string entry",
			extra: 'copy = [".env"]',
			mode: "copy",
			expected: [{ from: ".env", to: [".env"], mode: "copy" }],
		},
		{
			name: "single destination",
			extra: 'copy = [{ from = "source.env", to = "local.env" }]',
			mode: "copy",
			expected: [{ from: "source.env", to: ["local.env"], mode: "copy" }],
		},
		{
			name: "multiple destinations",
			extra: 'copy = [{ from = ".env", to = [".env.local", ".env.test"] }]',
			mode: "copy",
			expected: [{ from: ".env", to: [".env.local", ".env.test"], mode: "copy" }],
		},
		{
			name: "entry overrides project mode",
			extra:
				'copy_mode_default = "symlink"\ncopy = [".env", { from = "local.env", to = "local.env", mode = "copy" }]',
			mode: "symlink",
			expected: [
				{ from: ".env", to: [".env"], mode: "symlink" },
				{ from: "local.env", to: ["local.env"], mode: "copy" },
			],
		},
		{
			name: "normalized destinations",
			extra:
				'copy = ["./.env", { from = "~/shared/env", to = ["nested/../local.env", "./test.env"] }]',
			mode: "copy",
			expected: [
				{ from: ".env", to: [".env"], mode: "copy" },
				{ from: "~/shared/env", to: ["local.env", "test.env"], mode: "copy" },
			],
		},
	])("parses copy configuration: $name", ({ extra, mode, expected }) => {
		expect(
			parseConfig(`[[project]]\nroot = "/repo"\ncommand = "setup"\n${extra}`).projects[0],
		).toMatchObject({ copyModeDefault: mode, copy: expected });
	});

	test.each([
		{ name: "missing root", toml: '[[project]]\ncommand = "echo ok"', message: "root" },
		{
			name: "pool_size zero",
			toml: '[[project]]\nroot = "/tmp/repo"\ncommand = "x"\npool_size = 0',
			message: "pool_size",
		},
		{
			name: "pool_size negative",
			toml: '[[project]]\nroot = "/tmp/repo"\ncommand = "x"\npool_size = -1',
			message: "pool_size",
		},
		{
			name: "pool_size non-integer",
			toml: '[[project]]\nroot = "/tmp/repo"\ncommand = "x"\npool_size = 1.5',
			message: "pool_size",
		},
	])("throws ConfigError for $name", ({ toml, message }) => {
		expect(() => parseConfig(toml)).toThrow(
			expect.objectContaining({
				name: ConfigError.name,
				message: expect.stringContaining(message),
			}),
		);
	});

	test("rejects duplicate expanded roots", () => {
		expect(() =>
			parseConfig(`
[[project]]
root = "~/same"
command = "echo one"

[[project]]
root = "/home/test/same"
command = "echo two"
`),
		).toThrow(ConfigError);
	});

	test("resolves built-in policy defaults", () => {
		const policy = explainPolicy(parseConfig(""), "/tmp/repo");
		expect(policy.addPolicy).toBe("origin_default");
		expect(policy.finishPolicy).toEqual({
			enabled: true,
			strategy: "ff_only",
			push: false,
			removeWorktree: false,
			deleteBranch: false,
		});
	});

	test("matching rules apply in file order with later fields winning", () => {
		const config = parseConfig(`
[[rule]]
root_glob = "/tmp/**"
command = "echo first"
[rule.add]
policy = "fresh_canonical"
[rule.finish]
strategy = "squash"
push = true

[[rule]]
root_glob = "/tmp/repo"
command = "echo second"
[rule.finish]
push = false
remove_worktree = true
`);
		const policy = explainPolicy(config, "/tmp/repo");
		expect(policy.matchedRules.map((rule) => rule.rootGlob)).toEqual(["/tmp/**", "/tmp/repo"]);
		expect(policy.addPolicy).toBe("fresh_canonical");
		expect(policy.finishPolicy).toMatchObject({
			strategy: "squash",
			push: false,
			removeWorktree: true,
		});
		expect(resolveEffectiveCommand(config, "/tmp/repo")).toEqual({
			command: "echo second",
			source: "rule:/tmp/repo",
		});
	});

	test("exact project command overrides inherited rule command", () => {
		const config = parseConfig(`
[[rule]]
root_glob = "/tmp/**"
command = "echo rule"

[[project]]
root = "/tmp/repo"
command = "echo project"
`);
		expect(resolveEffectiveCommand(config, "/tmp/repo")).toEqual({
			command: "echo project",
			source: "project:/tmp/repo",
		});
	});

	const preRemoteConfig = `[[rule]]
root_glob = "/tmp/**"
pre_remote_check = "echo first >&2"
[[rule]]
root_glob = "/tmp/repo/**"
pre_remote_check = "echo second >&2"
[[project]]
root = "/tmp/repo"
pre_remote_check = "echo project >&2"`;
	test.each([
		{ name: "default", toml: "", root: "/tmp/repo", expected: { value: null, source: null } },
		{
			name: "rule",
			toml: preRemoteConfig,
			root: "/tmp/other",
			expected: { value: "echo first >&2", source: "rule:/tmp/**" },
		},
		{
			name: "later rule",
			toml: preRemoteConfig,
			root: "/tmp/repo/nested",
			expected: { value: "echo second >&2", source: "rule:/tmp/repo/**" },
		},
		{
			name: "project",
			toml: preRemoteConfig,
			root: "/tmp/repo",
			expected: { value: "echo project >&2", source: "project:/tmp/repo" },
		},
	])("resolves pre_remote_check from $name", ({ toml, root, expected }) => {
		expect(resolvePreRemoteCheck(parseConfig(toml), root)).toEqual(expected);
	});

	test("inherited rule command satisfies pooled and copy setup requirement", () => {
		const config = parseConfig(`
[[rule]]
root_glob = "/tmp/**"
command = "echo inherited"

[[project]]
root = "/tmp/repo"
pool_size = 1
copy = [".env"]
`);
		expect(config.projects[0]?.command).toBeNull();
		expect(resolveEffectiveCommand(config, "/tmp/repo").command).toBe("echo inherited");
	});

	test.each([
		{ name: "pool_size", extra: "pool_size = 1" },
		{ name: "copy", extra: 'copy = [".env"]' },
		{ name: "copy_mode_default", extra: 'copy_mode_default = "symlink"' },
	])("requires command when project uses $name", ({ extra }) => {
		expect(() =>
			parseConfig(`
[[project]]
root = "/tmp/repo"
${extra}
`),
		).toThrow(ConfigError);
	});

	test("exact project overrides matching rule and can omit command for policy only", () => {
		const config = parseConfig(`
[[rule]]
root_glob = "/tmp/**"
[rule.add]
policy = "fresh_canonical"
[rule.finish]
strategy = "squash"

[[project]]
name = "repo"
root = "/tmp/repo"
[project.add]
policy = "origin_default"
[project.finish]
enabled = false
`);
		const project = config.projects[0];
		expect(project?.command).toBeNull();
		const policy = explainPolicy(config, "/tmp/repo");
		expect(policy.project?.name).toBe("repo");
		expect(policy.addPolicy).toBe("origin_default");
		expect(policy.finishPolicy).toMatchObject({ enabled: false, strategy: "squash" });
	});

	test("finish policy merges field-by-field across defaults rules and project", () => {
		const policy = explainPolicy(
			parseConfig(`
[defaults.finish]
strategy = "rebase_ff"
push = true

[[rule]]
root_glob = "/tmp/**"
[rule.finish]
remove_worktree = true

[[project]]
root = "/tmp/repo"
[project.finish]
delete_branch = true
`),
			"/tmp/repo",
		);
		expect(policy.finishPolicy).toEqual({
			enabled: true,
			strategy: "rebase_ff",
			push: true,
			removeWorktree: true,
			deleteBranch: true,
		});
	});

	test.each([
		{ config: '[defaults.add]\npolicy = "bad"', message: "policy" },
		{ config: '[defaults.finish]\nstrategy = "bad"', message: "strategy" },
		{ config: '[defaults.finish]\npush = "yes"', message: "boolean" },
		{ config: '[[rule]]\nroot_glob = "~repo/*"', message: "root_glob" },
		{ config: 'defaults = "bad"', message: "defaults" },
		{ config: '[defaults.add]\npolciy = "fresh_canonical"', message: "Unrecognized key" },
		{ config: "[defaults.finish]\nremoveWorktree = true", message: "Unrecognized key" },
	])("invalid policy config fails loudly: $config", ({ config, message }) => {
		expect(() => parseConfig(config)).toThrow(
			expect.objectContaining({
				name: ConfigError.name,
				message: expect.stringContaining(message),
			}),
		);
	});
	test.each([
		{ toml: 'worktree_locaton = "nested"', field: "worktree_locaton" },
		{ toml: 'defaults = "invalid"', field: "defaults" },
		{ toml: '[defaults]\ncommand = "x"', field: "command" },
		{ toml: '[rule]\nroot_glob = "/repo"', field: "rule" },
		{ toml: '[[rule]]\nroot_glob = "/repo"\ncommmand = "x"', field: "commmand" },
		{ toml: 'project = ["/repo"]', field: "project" },
		{ toml: '[[project]]\nroot = "/repo"\npool_siz = 2', field: "pool_siz" },
		{ toml: '[[project]]\nroot = "/repo"\ncommand = "   "', field: "command" },
		{ toml: '[[project]]\nroot = "/repo"\ncopy = [{ from = "a", to = [] }]', field: "copy" },
		{
			toml: '[[project]]\nroot = "/repo"\ncopy = [{ from = "a", to = "b", modes = "copy" }]',
			field: "copy",
		},
		{ toml: '[[project]]\nroot = "/repo"\ncopy = ["a/../../outside"]', field: "copy" },
	])("reports invalid TOML shape at $field as a usage error", ({ toml, field }) => {
		expect(() => parseConfig(toml)).toThrow(
			expect.objectContaining({
				name: ConfigError.name,
				exitCode: EXIT_CODES.USAGE,
				message: expect.stringContaining(field),
			}),
		);
	});

	test("matches canonical roots while retaining configured project source paths", () => {
		const canonicalPaths = new Map([["/home/link", "/real/repo"]]);
		const normalizePath = (path: string) => canonicalPaths.get(path) ?? path;
		const config = parseTomlConfig(
			`
[[rule]]
root_glob = "/real/**"
command = "echo inherited"

[[project]]
root = "~/link"
pool_size = 1
pre_remote_check = "echo check"
`,
			{ home: "/home", cwd: "/work", normalizePath },
		);
		const explanation = explainPolicy(config, "/real/repo", normalizePath);
		expect(explanation.project?.root).toBe("/home/link");
		expect(explanation.command).toEqual({ command: "echo inherited", source: "rule:/real/**" });
		expect(explanation.preRemoteCheck).toEqual({
			value: "echo check",
			source: "project:/home/link",
		});
	});
});
