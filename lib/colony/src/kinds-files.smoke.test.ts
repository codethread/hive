import { expect, test } from "bun:test";
// eslint-disable-next-line import/no-nodejs-modules -- Own a disposable configuration-only repository.
import { mkdtemp, rm } from "node:fs/promises";
import { execute } from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve fixture paths.
import { join } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Isolate the real CLI fixture.
import { tmpdir } from "node:os";

const BEE = new URL("../bin/bee.ts", import.meta.url).pathname;
const SUCCESS = 0;
const FIRST = 0;
const SINGLE_WARNING = 1;
const POLICY = `owner = "ct"
humans = ["ct"]
[formulas]
[kinds.worker]
description = "Central worker."
allow = ["reviewer"]
harness = "codex"
model = "central-model"
effort = "low"
prompt = "Private central prompt."
`;

test(
	"kind discovery uses merged selectors and warns on stderr for humans, only in JSON for machines",
	// eslint-disable-next-line max-statements -- One owned filesystem/CLI fixture verifies both output modes without a tracker.
	async () => {
		const repo = await mkdtemp(join(tmpdir(), "bee-kind-files-"));
		const env = { ...process.env, BEADS_DB: undefined, BR_AGENT_NAME: "worker" };
		const run = async (args: string[]) => {
			const child = Bun.spawn([process.execPath, BEE, "kinds", "--repo", repo, ...args], {
				cwd: repo,
				env,
				stderr: "pipe",
				stdout: "pipe",
			});
			const [stdout, stderr, code] = await Promise.all([
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
				child.exited,
			]);
			expect(code).toBe(SUCCESS);
			return { stderr, stdout };
		};
		try {
			await execute(["git", "init"], repo, env);
			await Bun.write(join(repo, ".hive", "bees.toml"), POLICY);
			await Bun.write(
				join(repo, ".hive", "bees", "arbitrary", "bee.toml"),
				'name="reviewer"\ndescription="Review changes."\nharness="codex"\nmodel="file-model"\neffort="high"\nallow=["worker"]\n',
			);
			await Bun.write(
				join(repo, ".hive", "bees", "arbitrary", "prompt.md"),
				"Private file prompt.\n",
			);
			await Bun.write(
				join(repo, ".hive", "bees", "shadow", "bee.toml"),
				'name="worker"\ndescription="Shadowed worker."\nharness="pi"\nmodel="shadowed-model"\neffort="high"\nhidden=true\ndeny=["missing-shadowed-selector"]\n',
			);
			await Bun.write(
				join(repo, ".hive", "bees", "shadow", "prompt.md"),
				"Private shadowed prompt.",
			);
			const machine = await run(["--json"]);
			const result = JSON.parse(machine.stdout);
			expect(machine.stderr).toBe("");
			expect(result.kinds).toEqual([{ description: "Review changes.", name: "reviewer" }]);
			expect(result.warnings).toHaveLength(SINGLE_WARNING);
			expect(result.warnings[FIRST]).toContain("overrides bee kind worker");
			expect(machine.stdout).not.toContain("Private");
			const human = await run([]);
			expect(human.stdout).toBe("reviewer: Review changes.\n");
			expect(human.stderr).toBe(`Warning: ${result.warnings.join("\nWarning: ")}\n`);
			const detailed = await run(["--all", "--verbose", "--json"]);
			const full = JSON.parse(detailed.stdout);
			expect(detailed.stderr).toBe("");
			expect(full.warnings).toEqual(result.warnings);
			expect(full.kinds).toMatchObject([
				{
					configuration: {
						hidden: false,
						model: "central-model",
						prompt: "Private central prompt.",
					},
					name: "worker",
				},
				{
					configuration: { model: "file-model", prompt: "Private file prompt.\n" },
					name: "reviewer",
				},
			]);
			const schemaResult = await run(["--schema"]);
			const schema = JSON.parse(schemaResult.stdout);
			expect(schema.schema.anyOf[FIRST].properties.warnings).toMatchObject({
				items: { type: "string" },
				type: "array",
			});
		} finally {
			await rm(repo, { force: true, recursive: true });
		}
	},
);
