import { expect, test } from "bun:test";
import { parseEnvironment, renderCodexConfig, renderMiseConfig } from "./environment.ts";
import { parse } from "smol-toml";

const environment = { BEADS_DB: "/repo/.worktrees/tracker--state/.beads/beads.db" };

test("projects only the selected database #test-452", () => {
	expect(parseEnvironment({ ...environment, EXTRA: "ignored", PATH: "/bin" })).toEqual(environment);
});

test.each([
	{ key: "env", name: "mise", render: renderMiseConfig },
	{ key: "shell_environment_policy", name: "codex", render: renderCodexConfig },
])("writes minimal $name configuration #test-462", ({ render, key }) => {
	const output = parse(render("", environment));
	if (key === "env") {
		expect(output).toEqual({ env: environment });
	} else {
		expect(output).toEqual({ shell_environment_policy: { set: environment } });
	}
});

test("Codex setup preserves shell settings it did not generate #test-508", () => {
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
