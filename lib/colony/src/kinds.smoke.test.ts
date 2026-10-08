import { expect, test } from "bun:test";
// eslint-disable-next-line import/no-nodejs-modules -- Own a disposable configuration-only repository.
import { mkdtemp, rm } from "node:fs/promises";
import { execute } from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve fixture configuration paths.
import { join } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Isolate the real CLI fixture.
import { tmpdir } from "node:os";

const BEE = new URL("../bin/bee.ts", import.meta.url).pathname;
const CONFIG = `owner = "ct"
humans = ["ct"]
[formulas.codex]
executable = "codex"
argv = ["{{prompt}}"]
[kinds.worker]
description = "Implement work."
deny = ["#self"]
harness = "codex"
model = "model"
effort = "low"
prompt = "Worker prompt."
[kinds.helper]
description = "Advise on work."
allow = ["internal"]
harness = "codex"
model = "model"
effort = "low"
prompt = "Helper prompt."
[kinds.internal]
description = "Internal checks."
hidden = true
harness = "codex"
model = "model"
effort = "low"
prompt = "Internal prompt."
`;
const TIMEOUT = 10_000;
const FIRST = 0;
const FAILURE = 1;

test(
	"kind CLI resolves caller precedence, detail and strict configuration without a tracker or daemon",
	// eslint-disable-next-line max-statements -- One owned fixture covers the real CLI/configuration contract.
	async () => {
		const repo = await mkdtemp(join(tmpdir(), "bee-kinds-"));
		const env = { ...process.env, BEADS_DB: undefined, BR_AGENT_NAME: "worker" };
		const run = (args: string[]) =>
			execute([process.execPath, BEE, "kinds", "--repo", repo, ...args], repo, env);
		try {
			const summarySchema = JSON.parse(await run(["--schema"]));
			expect(summarySchema).toMatchObject({ kind: "bee_kinds_schema", ok: true });
			expect(
				Object.keys(summarySchema.schema.anyOf[FIRST].properties.kinds.items.properties).toSorted(),
			).toEqual(["description", "name"]);
			const fullSchema = JSON.parse(await run(["--schema", "--verbose"]));
			expect(
				fullSchema.schema.anyOf[FIRST].properties.kinds.items.properties.configuration.anyOf[FIRST]
					.properties.prompt.type,
			).toBe("string");
			await execute(["git", "init"], repo, env);
			await Bun.write(join(repo, ".hive", "bees.toml"), CONFIG);
			expect(JSON.parse(await run(["--json"])).kinds).toEqual([
				{ description: "Advise on work.", name: "helper" },
			]);
			expect(await run([])).toBe("helper: Advise on work.\n");
			expect(JSON.parse(await run(["--as", "helper", "--json"])).kinds).toEqual([
				{ description: "Internal checks.", name: "internal" },
			]);
			const all = JSON.parse(await run(["--all", "--json"]));
			expect(all.kinds.map((kind: { name: string }) => kind.name)).toEqual([
				"worker",
				"helper",
				"internal",
			]);
			expect(JSON.stringify(all)).not.toContain("prompt");
			const full = JSON.parse(await run(["internal", "--verbose", "--json"]));
			expect(full.kinds[FIRST].configuration.prompt).toBe("Internal prompt.");
			const invalid = [
				CONFIG.replace('description = "Implement work."', ""),
				CONFIG.replace('description = "Implement work."', 'description = " "'),
				CONFIG.replace('deny = ["#self"]', 'deny = ["#self"]\nallow = ["helper"]'),
				CONFIG.replace('deny = ["#self"]', 'deny = ["missing"]'),
			];
			for (const contents of invalid) {
				// eslint-disable-next-line no-await-in-loop -- Each configuration must be observed before replacement.
				await Bun.write(join(repo, ".hive", "bees.toml"), contents);
				// eslint-disable-next-line no-await-in-loop -- Sequential mutations share this owned fixture.
				await expect(run(["--json"])).rejects.toBeInstanceOf(Error);
			}
			const child = Bun.spawn([process.execPath, BEE, "kinds", "--repo", repo, "--json"], {
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
			expect(code).toBe(FAILURE);
			expect(stderr).toBe("");
			expect(JSON.parse(stdout)).toMatchObject({
				kind: "error",
				ok: false,
				reason: "operation_failed",
			});
		} finally {
			await rm(repo, { force: true, recursive: true });
		}
	},
	TIMEOUT,
);
