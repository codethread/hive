import { expect, test } from "bun:test";
import { parseConfig, parseRepositoryConfig } from "../../src/config.ts";
import { ConfigError } from "../../src/errors.ts";
import { explainPolicy } from "../../src/domain/config.ts";

const context = { cwd: "/work", home: "/home/test", normalizePath: (path: string) => path };
const root = "/repo";
const globalToml = `
worktree_location = "nested"
[defaults.finish]
strategy = "squash"
push = true
[[rule]]
root_glob = "/**"
command = "echo rule"
pre_remote_check = "echo check"
[rule.add]
policy = "fresh_canonical"
[rule.finish]
remove_worktree = true
[[project]]
root = "/repo"
name = "global-name"
command = "echo project"
pool_size = 2
copy_mode_default = "symlink"
copy = [".env"]
[project.finish]
delete_branch = true
`;
const globalConfig = parseConfig(globalToml, context);

function localConfig(toml: string, global = globalConfig) {
	return parseRepositoryConfig(toml, global, {
		canonicalRoot: root,
		normalizePath: context.normalizePath,
	});
}

test.each([
	{
		mode: "symlink",
		toml: 'copy = ["./.env", { from = "source", to = "./target", mode = "copy" }]',
	},
	{
		mode: "copy",
		toml: 'copy_mode_default = "copy"\ncopy = [".env", { from = "source", to = "target", mode = "copy" }]',
	},
])("local copy entries use effective $mode default and retain explicit modes", ({ mode, toml }) => {
	const policy = explainPolicy(localConfig(toml), root);
	expect(policy.project?.copy).toEqual([
		{ from: ".env", mode, to: [".env"] },
		{ from: "source", mode: "copy", to: ["target"] },
	]);
});

test("local pool and copy setup can inherit a global rule command without an exact project", () => {
	const global = parseConfig('[[rule]]\nroot_glob = "/repo"\ncommand = "echo rule"', context);
	const config = localConfig('pool_size = 1\ncopy = [".env"]', global);
	const policy = explainPolicy(config, root);
	expect(policy.globalProject).toBeUndefined();
	expect(policy.project).toMatchObject({ name: "repo", poolSize: 1, root });
	expect(policy.command).toEqual({ command: "echo rule", source: "rule:/repo" });
});

test("changing only the local copy default preserves the resolved inherited copy entries", () => {
	const policy = explainPolicy(localConfig('copy_mode_default = "copy"'), root);
	expect(policy.project).toMatchObject({
		copy: [{ from: ".env", mode: "symlink", to: [".env"] }],
		copyModeDefault: "copy",
	});
});

test("an empty local copy list and empty policy patches need no bootstrap command", () => {
	const policy = explainPolicy(localConfig("copy = []\n[finish]", parseConfig("", context)), root);
	expect(policy.project?.copy).toEqual([]);
	expect(policy.command.command).toBeNull();
	expect(policy.finishPolicy.push).toBe(false);
});

test("repository-local settings apply only to their canonical root", () => {
	const config = localConfig('command = "echo local"\nworktree_location = "sibling"');
	const policy = explainPolicy(config, "/other");
	expect(policy.local).toBeUndefined();
	expect(policy.project).toBeUndefined();
	expect(policy.command).toEqual({ command: "echo rule", source: "rule:/**" });
	expect(policy.worktreeLocation).toBe("nested");
});

test.each([
	'root = "/repo"',
	'root_glob = "/**"',
	"[defaults.finish]\npush = true",
	'[[rule]]\nroot_glob = "/**"',
	'[[project]]\nroot = "/repo"',
	'command = " "',
	'worktree_location = "invalid"',
	"pool_size = 0",
	'copy = ["../outside"]',
	'copy = [{ from = ".env", to = [] }]',
	"[finish]\nremoveWorktree = true",
	"[finish]\npush = 'yes'",
	"command =",
])("rejects malformed or forbidden repository config: %s", (toml) => {
	expect(() => localConfig(toml)).toThrow(ConfigError);
});

test.each(["pool_size = 1", 'copy_mode_default = "symlink"'])(
	"requires an effective command for local setup: %s",
	(toml) => {
		expect(() => localConfig(toml, parseConfig("", context))).toThrow(ConfigError);
	},
);
