import type { BvService } from "@hive/shared/bv";
import type { RepositoryEndpoint } from "@hive/shared";

interface RankingInput {
	/** Injected graph ranking reader. */
	bv: Pick<BvService, "readPageRanks">;
	/** Canonical repository and selected live tracker. */
	repository: RepositoryEndpoint;
	/** Neutral execution directory for ranking. */
	state: string;
}

/** Require a score for every linked task before scheduling candidates. */
export async function pageRanks(
	{ bv, repository, state }: RankingInput,
	taskIds: string[],
): Promise<Record<string, number>> {
	const scores = await bv.readPageRanks({ cwd: state, sqlitePath: repository.beadsDb });
	for (const id of taskIds) {
		if (scores[id] === undefined) {
			throw new Error(`BV ranking has no PageRank for linked task ${id}`);
		}
	}
	return scores;
}
