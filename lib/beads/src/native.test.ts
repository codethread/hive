import { expect, test } from "bun:test";
import { createNativeBeads } from "./native.ts";

test("native transport retains explicit selection and attribution independently of cwd", async () => {
	const calls: { argv: string[]; cwd: string; env: NodeJS.ProcessEnv }[] = [];
	const service = createNativeBeads({
		env: { BEADS_DB: "old", BD_ACTOR: "old", SENTINEL: "kept" },
		execute: (argv, cwd, env) => {
			calls.push({ argv, cwd, env });
			return Promise.resolve("{}");
		},
	});
	await service.sync.flush({ cwd: "/worktree", db: "/tracker/beads.db", actor: "worker" });
	expect(calls).toEqual([
		{
			argv: [
				"br",
				"sync",
				"--flush-only",
				"--json",
				"--db",
				"/tracker/beads.db",
				"--actor",
				"worker",
			],
			cwd: "/worktree",
			env: { BEADS_DB: "/tracker/beads.db", BD_ACTOR: "worker", SENTINEL: "kept" },
		},
	]);
});

test("native discovery preserves unspecified environment and parses its typed location", async () => {
	const service = createNativeBeads({
		env: { BEADS_DB: "/selected/beads.db", BD_ACTOR: "reader" },
		execute: (argv, cwd, env) => {
			expect(argv).toEqual(["br", "where", "--json"]);
			expect(cwd).toBe("/execution");
			expect(env).toEqual({ BEADS_DB: "/selected/beads.db", BD_ACTOR: "reader" });
			return Promise.resolve('{"database_path":"/selected/beads.db","beads_dir":"/selected"}');
		},
	});
	expect(await service.where({ cwd: "/execution" })).toEqual({
		database_path: "/selected/beads.db",
		beads_dir: "/selected",
	});
});

test("sync status disables auto effects before inspecting the selected tracker", async () => {
	const service = createNativeBeads({
		execute: (argv) => {
			expect(argv).toEqual([
				"br",
				"--no-auto-import",
				"--no-auto-flush",
				"sync",
				"--status",
				"--json",
			]);
			return Promise.resolve(
				'{"coverage_drift":false,"jsonl_exists":true,"jsonl_newer":false,"workspace_health":"healthy"}',
			);
		},
	});
	const status = await service.sync.status({ cwd: "/tracker" });
	expect(status.workspace_health).toBe("healthy");
});
