// eslint-disable-next-line import/no-nodejs-modules -- Ranking owns a disposable canonical JSONL snapshot.
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { Database } from "bun:sqlite";
import type { RepositoryEndpoint } from "@hive/shared";
import { execute } from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- BV consumes a private snapshot directory.
import { join } from "node:path";
import { z } from "zod";

const ZERO = 0;
const ONE = 1;
const exportSchema = z.object({
	errors: z.array(z.unknown()).length(ZERO),
	exported_issues: z.number().int(),
	policy: z.literal("strict"),
	success_rate: z.literal(ONE),
});
const sourceSchema = z.object({
	errors: z.literal(ZERO),
	read_errors: z.literal(ZERO),
	skipped: z.literal(ZERO),
	source_kind: z.literal("jsonl_local"),
	source_path: z.string(),
	stale: z.literal(false),
	status: z.literal("loaded"),
	valid: z.number().int(),
});
const scoresSchema = z.record(z.string(), z.number().finite().nonnegative());
const pageRankStatusSchema = z.object({ state: z.literal("computed") });
const insightsSchema = z.object({
	full_stats: z.object({ pagerank: scoresSchema }),
	source_authority: z.object({
		errors: z.literal(ZERO),
		failed: z.literal(ZERO),
		read_errors: z.literal(ZERO),
		skipped: z.literal(ZERO),
		sources: z.array(sourceSchema).length(ONE),
		state: z.literal("complete"),
	}),
	status: z.object({ PageRank: pageRankStatusSchema }),
});

/** Rank only from a verified export of this colony's explicitly selected database. */
// eslint-disable-next-line max-statements -- Snapshot creation, authority verification and cleanup belong to one I/O boundary.
export async function pageRanks(
	repository: RepositoryEndpoint,
	state: string,
	taskIds: string[],
): Promise<Record<string, number>> {
	const directory = await mkdtemp(join(await realpath(state), "ranking-"));
	const snapshotDirectory = join(directory, "snapshot");
	const snapshot = join(snapshotDirectory, "issues.jsonl");
	const databaseDirectory = join(directory, ".beads");
	const snapshotDb = join(databaseDirectory, "beads.db");
	const env = {
		...process.env,
		BD_ACTOR: "colony",
		BEADS_DB: snapshotDb,
		BEADS_JSONL: snapshot,
	};
	try {
		await mkdir(snapshotDirectory);
		await mkdir(databaseDirectory);
		const database = new Database(repository.beadsDb, { readonly: true });
		try {
			await Bun.write(snapshotDb, database.serialize());
		} finally {
			database.close();
		}
		const exported = exportSchema.parse(
			JSON.parse(
				await execute(
					[
						"br",
						"sync",
						"--flush-only",
						"--no-auto-import",
						"--no-auto-flush",
						"--allow-external-jsonl",
						"--db",
						snapshotDb,
						"--actor",
						"colony",
						"--json",
					],
					directory,
					env,
				),
			),
		);
		const insights = insightsSchema.parse(
			JSON.parse(
				await execute(
					[
						"bv",
						"--robot-insights",
						"--force-full-analysis",
						"--robot-max-results",
						"100",
						"--db",
						snapshotDirectory,
						"--format",
						"json",
					],
					directory,
					env,
				),
			),
		);
		const [source] = insights.source_authority.sources;
		if (source!.source_path !== snapshot || source!.valid !== exported.exported_issues) {
			throw new Error("BV ranking did not read the complete selected tracker export");
		}
		const scores = insights.full_stats.pagerank;
		for (const id of taskIds) {
			if (scores[id] === undefined) {
				throw new Error(`BV ranking has no PageRank for linked task ${id}`);
			}
		}
		return scores;
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
}
