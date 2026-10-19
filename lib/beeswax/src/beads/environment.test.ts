import { expect, test } from "bun:test";
import { parseEnvironment, renderMiseConfig, resolveEnvironment } from "./environment.ts";
import { parse } from "smol-toml";

const environment = { BEADS_DB: "/repo/.worktrees/tracker--state/.beads/beads.db" };

test("projects only the selected database", () => {
	expect(parseEnvironment({ ...environment, EXTRA: "ignored", PATH: "/bin" })).toEqual(environment);
});

test("writes minimal Mise configuration", () => {
	expect(parse(renderMiseConfig("", environment))).toEqual({ env: environment });
});

test.each([
	{
		input: '"env.BEADS_DB" = "user-owned"\n',
		expected: `env.BEADS_DB = "${environment.BEADS_DB}"\n"env.BEADS_DB" = "user-owned"\n`,
	},
	{
		input:
			"# local user config\n[env] # keep\nBEADS_DB = '/old/.beads/beads.db' # endpoint\nOTHER = 'value'\n",
		expected: `# local user config\n[env] # keep\nBEADS_DB = "${environment.BEADS_DB}" # endpoint\nOTHER = 'value'\n`,
	},
	{
		input: "env = { OTHER = 'value', BEADS_DB = '/old/.beads/beads.db' } # keep\n",
		expected: `env = { OTHER = 'value', BEADS_DB = "${environment.BEADS_DB}" } # keep\n`,
	},
	{
		input: "# keep\nenv.OTHER = 'value'\n",
		expected: `env.BEADS_DB = "${environment.BEADS_DB}"\n# keep\nenv.OTHER = 'value'\n`,
	},
])("Mise endpoint edits preserve surrounding user bytes: $input", ({ input, expected }) => {
	const rendered = renderMiseConfig(input, environment);
	expect(rendered).toBe(expected);
	expect(parse(rendered)).toMatchObject({ env: environment });
	expect(renderMiseConfig(rendered, environment)).toBe(rendered);
});
test("inherited endpoint wins before Mise in another project's cwd", async () => {
	const command = () => {
		throw new Error("Mise must not replace an assignment");
	};
	expect(await resolveEnvironment("/another/project", command, environment.BEADS_DB)).toEqual(
		environment,
	);
});
