import { expect, test } from "bun:test";
import {
	explainPolicy,
	resolveEffectiveCommand,
	resolvePreRemoteCheck,
} from "../../src/domain/config.ts";
import { parseConfig as parseTomlConfig } from "../../src/config.ts";

const parseConfig = (toml: string) =>
	parseTomlConfig(toml, {
		cwd: "/work",
		home: "/home/test",
		normalizePath: (path) => path,
	});

test("resolves built-in policy defaults", () => {
	const policy = explainPolicy(parseConfig(""), "/tmp/repo");
	expect(policy.addPolicy).toBe("origin_default");
	expect(policy.finishPolicy).toEqual({
		deleteBranch: false,
		enabled: true,
		push: false,
		removeWorktree: false,
		strategy: "ff_only",
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
		push: false,
		removeWorktree: true,
		strategy: "squash",
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
	{
		// eslint-disable-next-line unicorn/no-null -- The default layer supplies no value or source.
		expected: { source: null, value: null },
		name: "default",
		root: "/tmp/repo",
		toml: "",
	},
	{
		expected: { source: "rule:/tmp/**", value: "echo first >&2" },
		name: "rule",
		root: "/tmp/other",
		toml: preRemoteConfig,
	},
	{
		expected: { source: "rule:/tmp/repo/**", value: "echo second >&2" },
		name: "later rule",
		root: "/tmp/repo/nested",
		toml: preRemoteConfig,
	},
	{
		expected: { source: "project:/tmp/repo", value: "echo project >&2" },
		name: "project",
		root: "/tmp/repo",
		toml: preRemoteConfig,
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
	const [project] = config.projects;
	expect(project?.command).toBeNull();
	expect(resolveEffectiveCommand(config, "/tmp/repo").command).toBe("echo inherited");
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
	const [project] = config.projects;
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
		deleteBranch: true,
		enabled: true,
		push: true,
		removeWorktree: true,
		strategy: "rebase_ff",
	});
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
		{ cwd: "/work", home: "/home", normalizePath },
	);
	const explanation = explainPolicy(config, "/real/repo", normalizePath);
	expect(explanation.project?.root).toBe("/home/link");
	expect(explanation.command).toEqual({ command: "echo inherited", source: "rule:/real/**" });
	expect(explanation.preRemoteCheck).toEqual({
		source: "project:/home/link",
		value: "echo check",
	});
});
