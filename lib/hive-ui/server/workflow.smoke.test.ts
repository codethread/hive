/* eslint-disable import/no-nodejs-modules -- This test owns a disposable native tracker and real CLI process. */
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createNativeBeads } from "@hive/beads";
import { createWorkflowTools } from "./workflow.ts";
import { execute } from "@hive/shared";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Keep the native fixture and actual process proof measured together.
// eslint-disable-next-line max-statements
test("#test-200 real public inspection keeps failed lifecycle visible when the diagram source is absent", async () => {
	const root = await mkdtemp(join(tmpdir(), "hive-ui-lifecycle-"));
	const env = { ...process.env };
	delete env.BEADS_DB;
	delete env.BD_ACTOR;
	delete env.GIT_INDEX_FILE;
	try {
		const repo = join(root, "repo");
		await mkdir(repo);
		await execute(["git", "init", "--quiet", repo], root, env);
		const db = join(repo, ".beads/beads.db");
		await execute(["br", "init", "--db", db, "--prefix", "test", "--actor", "fixture"], repo, env);
		const config = Bun.file(join(repo, ".beads/config.yaml"));
		await Bun.write(
			config,
			`${await config.text()}\nsync.auto_flush: false\nsync.auto_import: false\n`,
		);
		const beads = createNativeBeads({ env });
		const scope = { cwd: repo, db, actor: "fixture", noAutoImport: true, noAutoFlush: true };
		const run = await beads.create(scope, { title: "Unavailable authored graph", owner: "ct" });
		const checkpoint = await beads.create(scope, {
			title: "Retained checkpoint",
			labels: ["system", "busybee-checkpoint"],
			description: JSON.stringify({
				formatVersion: 1,
				id: run.id,
				hash: "retained-source",
				definition: { kind: "source", source: join(root, "absent.ts") },
				active: [],
				created: [],
				history: [],
				visits: {},
				snapshot: { status: "active", value: "work", context: {}, children: {} },
			}),
		});
		await beads.dep.add(scope, run.id, checkpoint.id, "related");
		await beads.close(scope, run.id, {
			reason: JSON.stringify({
				kind: "busybee-lifecycle",
				formatVersion: 1,
				scope: "run",
				runId: run.id,
				outcome: "failed",
				reason: "Retained failure",
			}),
		});
		const before = await beads.showMany(scope, [run.id, checkpoint.id]);
		const entry = new URL("../../busybee/bin/busybee.ts", import.meta.url).pathname;
		const tools = createWorkflowTools((argv, cwd) =>
			execute([process.execPath, entry, ...argv.slice(1)], cwd, env),
		);
		const endpoint = {
			id: "fixture",
			name: "Fixture",
			root: repo,
			beadsDb: db,
			statuses: ["closed"],
		};
		const view = await tools.preview(endpoint, run.id);
		expect(view).toMatchObject({
			nativeStatus: "closed",
			lifecycle: { kind: "terminal", fact: { outcome: "failed" } },
			resolution: { kind: "unresolved" },
			diagram: { kind: "unavailable" },
		});
		const { diagram: _diagram, ...native } = view;
		expect(await tools.lifecycle(endpoint, run.id)).toEqual(native);
		expect(await beads.showMany(scope, [run.id, checkpoint.id])).toEqual(before);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
