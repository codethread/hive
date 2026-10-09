import { expect, test } from "bun:test";
// eslint-disable-next-line import/no-nodejs-modules -- Disposable real tracker fixtures and artifact verification.
import { mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { Database } from "bun:sqlite";
import { execute } from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Own fixture paths.
import { join } from "node:path";
import { pageRanks } from "./ranking.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Private OS temporary fixture root.
import { tmpdir } from "node:os";
import { z } from "zod";

const TASK_COUNT = 202;
const FIRST = 0;
const NEXT = 1;
const TIMEOUT = 30_000;
const createdSchema = z.object({ id: z.string() });

test(
	"BV reads the complete selected database, including closed nodes and unflushed dependencies",
	// eslint-disable-next-line max-statements -- Native graph and routing assertions share one disposable tracker.
	async () => {
		const fixture = await createTracker();
		const originalEnv = { ...process.env };
		try {
			const seed = await fixture.create("Ranked task");
			const ids = seedGraph(fixture.repository.beadsDb, seed);
			await fixture.tracker(["close", ids[FIRST]!]);
			await fixture.tracker(["sync", "--flush-only"]);
			const exported = await Bun.file(fixture.jsonl).text();
			const fresh = createdSchema.parse(
				JSON.parse(
					await fixture.tracker([
						"create",
						"Database-only ephemeral task",
						"--owner",
						"ct",
						"--ephemeral",
					]),
				),
			).id;
			await fixture.tracker(["dep", "add", fresh, ids[NEXT]!]);
			// Neither a competing endpoint nor a newer, stale export may replace the selected DB.
			process.env.BEADS_DB = join(fixture.root, "wrong.db");
			process.env.BEADS_DIR = join(fixture.root, "wrong-directory");
			process.env.BEADS_JSONL = fixture.jsonl;
			process.env.BV_INSIGHTS_MAP_LIMIT = "1";
			await Bun.write(fixture.jsonl, exported);
			const before = await trackerArtifacts(fixture.root);
			const scores = await pageRanks(fixture.repository, fixture.root, [fresh]);
			expect(Object.keys(scores).toSorted()).toEqual([...ids, fresh].toSorted());
			expect(scores[ids[NEXT]!]!).toBeGreaterThan(scores[ids[FIRST]!]!);
			await expect(
				pageRanks(fixture.repository, fixture.root, ["rank-missing"]),
			).rejects.toBeInstanceOf(Error);
			expect(await trackerArtifacts(fixture.root)).toEqual(before);
		} finally {
			process.env = originalEnv;
			await rm(fixture.root, { force: true, recursive: true });
		}
	},
	TIMEOUT,
);

test(
	"BV reads pending-sync operational state without changing source records or artifacts",
	// eslint-disable-next-line max-statements -- Keep native receipt and artifact observations within one fixture lifecycle.
	async () => {
		const fixture = await createTracker();
		try {
			const id = await fixture.create("Committed task");
			await fixture.tracker(["sync", "--flush-only"]);
			const database = new Database(fixture.repository.beadsDb);
			try {
				// The receipt is opaque to ranking; only native sync owns its validation/recovery.
				database
					.query("INSERT INTO metadata (key, value) VALUES (?, ?)")
					.run(
						"sync_merge_pending_v2",
						JSON.stringify({ phase: "database_committed", receipt_id: "ranking-sentinel" }),
					);
				const before = await trackerArtifacts(fixture.root);
				const metadata = database.query("SELECT * FROM metadata ORDER BY key").all();
				const scores = await pageRanks(fixture.repository, fixture.root, [id]);
				expect(scores[id]).toBeGreaterThan(FIRST);
				expect(database.query("SELECT * FROM metadata ORDER BY key").all()).toEqual(metadata);
				expect(await trackerArtifacts(fixture.root)).toEqual(before);
			} finally {
				database.close();
			}
		} finally {
			await rm(fixture.root, { force: true, recursive: true });
		}
	},
	TIMEOUT,
);

test.each(["missing", "corrupt", "invalid-row", "unreadable-dependencies"])(
	"BV fails visibly for %s source despite a valid JSONL export",
	// eslint-disable-next-line max-statements -- Each corruption case owns its setup and teardown.
	async (failure) => {
		const fixture = await createTracker();
		try {
			const id = await fixture.create("Source failure task");
			await fixture.tracker(["sync", "--flush-only"]);
			if (failure === "missing") {
				await rm(fixture.repository.beadsDb);
			} else if (failure === "corrupt") {
				await Bun.write(fixture.repository.beadsDb, "not a SQLite database");
			} else {
				const database = new Database(fixture.repository.beadsDb);
				try {
					if (failure === "invalid-row") {
						database.run("UPDATE issues SET created_at = 'invalid-date'");
					} else {
						database.run("ALTER TABLE dependencies RENAME COLUMN depends_on_id TO unavailable");
					}
				} finally {
					database.close();
				}
			}
			await expect(pageRanks(fixture.repository, fixture.root, [id])).rejects.toBeInstanceOf(Error);
		} finally {
			await rm(fixture.root, { force: true, recursive: true });
		}
	},
	TIMEOUT,
);

// ---------------------------------------------------------------------------

async function createTracker() {
	const temporary = await mkdtemp(join(tmpdir(), "colony-ranking-"));
	const root = await realpath(temporary);
	const repository = { beadsDb: join(root, ".beads", "beads.db"), root };
	const jsonl = join(root, ".beads", "issues.jsonl");
	const env = {
		...process.env,
		BD_ACTOR: "colony",
		BEADS_DB: repository.beadsDb,
		BEADS_JSONL: jsonl,
	};
	const tracker = (args: string[]) =>
		execute(
			[
				"br",
				...args,
				"--db",
				repository.beadsDb,
				"--actor",
				"colony",
				"--no-auto-flush",
				"--no-auto-import",
				"--json",
			],
			root,
			env,
		);
	await execute(["git", "init", "--quiet"], root, env);
	await tracker(["init", "--prefix", "rank"]);
	const create = async (title: string) =>
		createdSchema.parse(JSON.parse(await tracker(["create", "--title", title, "--owner", "ct"])))
			.id;
	return { root, repository, jsonl, tracker, create };
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
				// SQLite's shared-memory reader marks are coordination, not tracker data.
				artifacts[path] = Bun.hash(await Bun.file(path).arrayBuffer()).toString();
			}),
	);
	return artifacts;
}

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
