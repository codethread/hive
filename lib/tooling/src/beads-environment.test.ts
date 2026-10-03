import { expect, test } from "bun:test";
import { parseEnvironment, renderCodexConfig, renderMiseConfig } from "./beads-environment.ts";
import { parse } from "smol-toml";

const environment = { BEADS_DB: "/repo/.worktrees/tracker--state/.beads/beads.db" };
const miseDirectiveKey = "_";

test("projects only the selected database", () => {
	expect(parseEnvironment({ ...environment, HIVE_BR_BIN: "/bin/br", PATH: "/bin" })).toEqual(
		environment,
	);
});

test.each([
	{ key: "env", name: "mise", render: renderMiseConfig },
	{ key: "shell_environment_policy", name: "codex", render: renderCodexConfig },
])("writes minimal $name configuration", ({ render, key }) => {
	const output = parse(render("", environment));
	if (key === "env") {
		expect(output).toEqual({ env: environment });
	} else {
		expect(output).toEqual({ shell_environment_policy: { set: environment } });
	}
});

test("mise setup retires the generated wrapper path while preserving unrelated settings", () => {
	const input = `
[env]
HIVE_BR_BIN = "/bin/br"
KEEP = "yes"
[env._]
path = ["/repo/.worktrees/tracker--state/scripts/beads/bin", "/custom/bin"]
[settings]
activate_aggressive = true
quiet = true
`;
	expect(parse(renderMiseConfig(input, environment))).toEqual({
		env: { ...environment, KEEP: "yes", [miseDirectiveKey]: { path: ["/custom/bin"] } },
		settings: { quiet: true },
	});
});

test("Codex setup restores the original shell directory and removes generated interception", () => {
	const input = `
model = "test-model"
allow_login_shell = false
[shell_environment_policy]
inherit = "all"
[shell_environment_policy.set]
HIVE_BR_BIN = "/bin/br"
HIVE_CODEX_USER_ZDOTDIR = "/user/shell"
ZDOTDIR = "/repo/.worktrees/tracker--state/scripts/beads/codex-shell"
PATH = "/repo/.worktrees/tracker--state/scripts/beads/bin:/bin"
KEEP = "yes"
`;
	expect(parse(renderCodexConfig(input, environment))).toEqual({
		model: "test-model",
		shell_environment_policy: {
			inherit: "all",
			set: { ...environment, KEEP: "yes", ZDOTDIR: "/user/shell" },
		},
	});
});

test("Codex setup preserves shell settings it did not generate", () => {
	const input = `
allow_login_shell = false
[shell_environment_policy.set]
PATH = "/custom/bin"
ZDOTDIR = "/custom/shell"
`;
	expect(parse(renderCodexConfig(input, environment))).toEqual({
		allow_login_shell: false,
		shell_environment_policy: {
			set: { ...environment, PATH: "/custom/bin", ZDOTDIR: "/custom/shell" },
		},
	});
});
