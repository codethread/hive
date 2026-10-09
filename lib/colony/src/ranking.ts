import type { RepositoryEndpoint } from "@hive/shared";
import { execute } from "@hive/shared";
import { z } from "zod";

const ZERO = 0;
const ONE = 1;
// BV accepts only a positive map limit; use its portable signed-integer maximum.
const INSIGHTS_MAP_LIMIT = "2147483647";
const sourceSchema = z.object({
	errors: z.literal(ZERO),
	read_errors: z.literal(ZERO),
	skipped: z.literal(ZERO),
	source_kind: z.literal("sqlite"),
	source_path: z.string(),
	stale: z.literal(false),
	status: z.literal("loaded"),
	valid: z.number().int(),
	visible: z.number().int().nonnegative(),
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

/** Rank the complete graph from this colony's selected database through BV's read-only reader. */
// eslint-disable-next-line max-statements -- Native execution, authority validation and required scores form one I/O boundary.
export async function pageRanks(
	repository: RepositoryEndpoint,
	state: string,
	taskIds: string[],
): Promise<Record<string, number>> {
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
					repository.beadsDb,
					"--format",
					"json",
				],
				state,
				{ ...process.env, BV_INSIGHTS_MAP_LIMIT: INSIGHTS_MAP_LIMIT },
			),
		),
	);
	const [source] = insights.source_authority.sources;
	if (source!.source_path !== repository.beadsDb) {
		throw new Error("BV ranking did not read the selected tracker database");
	}
	const scores = insights.full_stats.pagerank;
	if (Object.keys(scores).length !== source!.visible) {
		throw new Error("BV ranking did not return scores for the complete visible graph");
	}
	for (const id of taskIds) {
		if (scores[id] === undefined) {
			throw new Error(`BV ranking has no PageRank for linked task ${id}`);
		}
	}
	return scores;
}
