/* eslint-disable import/max-dependencies -- The native BV contract owns its disposable tracker and artifact checks. */
import { CommandError, createNativeBeads } from "@hive/beads";
import { expect, test } from "bun:test";
// eslint-disable-next-line import/no-nodejs-modules -- Own isolated native contract fixtures.
import { mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { Database } from "bun:sqlite";
import { createNativeBv } from "../../src/bv.ts";
import { execute } from "../../src/bees-io.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Fixture paths do not use the application's tracker.
import { join } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Disposable native contract directory.
import { tmpdir } from "node:os";

const TASK_COUNT = 202;
const NEXT = 1;

/* eslint-disable-next-line max-statements --
 * One native observation proves selected sources and read-only effects together.
 */
test("native BV separates live ranking from exported topology without repairing either source #test-659", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "hive-bv-contract-"));
	const root = await realpath(temporary);
	const sqlitePath = join(root, ".beads", "beads.db");
	const jsonlPath = join(root, ".beads", "issues.jsonl");
	const scope = {
		cwd: root,
		db: sqlitePath,
		actor: "bv-contract",
		noAutoImport: true,
		noAutoFlush: true,
	};
	const beads = createNativeBeads();
	const bv = createNativeBv({
		env: {
			...process.env,
			BEADS_DB: join(root, "wrong.db"),
			BEADS_DIR: join(root, "wrong-directory"),
			BEADS_JSONL: jsonlPath,
			BV_INSIGHTS_MAP_LIMIT: "1",
		},
	});
	try {
		await execute(["br", "init", "--prefix", "rank", "--db", sqlitePath], root, process.env);
		const seed = await beads.create(scope, { title: "Exported task", owner: "ct" });
		const ids = seedGraph(sqlitePath, seed.id);
		await beads.close(scope, seed.id);
		await beads.sync.flush(scope);
		const live = await beads.create(scope, { title: "Unflushed task", owner: "ct" });
		await beads.dep.add(scope, live.id, ids[NEXT]!, "blocks");
		const before = await trackerArtifacts(root);
		const scores = await bv.readPageRanks({ cwd: root, sqlitePath });
		const graph = await bv.readGraph({ cwd: root, jsonlPath });
		expect(Object.keys(scores).toSorted()).toEqual([...ids, live.id].toSorted());
		expect(scores[ids[NEXT]!]!).toBeGreaterThan(scores[seed.id]!);
		expect(graph.nodes.map(({ id }) => id).toSorted()).toEqual(ids.toSorted());
		expect(graph.nodes.find(({ id }) => id === seed.id)?.status).toBe("closed");
		expect(await trackerArtifacts(root)).toEqual(before);
		await Bun.write(sqlitePath, "corrupt selected database");
		const failure = await bv
			.readPageRanks({ cwd: root, sqlitePath })
			.catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(CommandError);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

// --- Private functions ---
function seedGraph(path: string, seed: string): string[] {
	const database = new Database(path);
	try {
		const ids = [seed];
		const insert = database.query(`
			INSERT INTO issues (id, title, status, priority, issue_type, created_at, updated_at)
			SELECT ?, title, status, priority, issue_type, created_at, updated_at FROM issues WHERE id = ?
		`);
		database.transaction(() => {
			for (let index = NEXT; index < TASK_COUNT; index += NEXT) {
				const id = `rank-fixture-${index}`;
				insert.run(id, seed);
				ids.push(id);
			}
		})();
		return ids;
	} finally {
		database.close();
	}
}

async function trackerArtifacts(root: string): Promise<Record<string, string>> {
	const directory = join(root, ".beads");
	const entries = await readdir(directory, { recursive: true, withFileTypes: true });
	const artifacts: Record<string, string> = {};
	await Promise.all(
		entries
			.filter((entry) => entry.isFile() && !entry.name.endsWith("-shm"))
			.map(async (entry) => {
				const path = join(entry.parentPath, entry.name);
				artifacts[path] = Bun.hash(await Bun.file(path).arrayBuffer()).toString();
			}),
	);
	return artifacts;
}
