/* eslint-disable unicorn/no-null -- SQL optional filters and unfinished reports explicitly retain absence. */
import { assessmentSchema, assessmentSourceSchema } from "./postrun.ts";
import { Database } from "bun:sqlite";
import type { RepositoryEndpoint } from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Offline access selects the existing daemon store and private source bundle.
import { join } from "node:path";
import { z } from "zod";

const SUMMARY_LENGTH = 240;
const START = 0;
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;
export const assessmentLimitSchema = z.coerce
	.number()
	.int()
	.min(MIN_LIMIT)
	.max(MAX_LIMIT)
	.default(DEFAULT_LIMIT);
export interface AssessmentFilter {
	/** Canonical repository and selected tracker scope every query. */
	repository: RepositoryEndpoint;
	/** Exact source request; selecting it includes full validated report and source metadata. */
	request?: string | undefined;
	/** Bounded recent result count. */
	limit: number;
}
export type AssessmentsResult = Awaited<ReturnType<typeof readAssessments>>;

/** SELECT-only access: no migration, daemon wake, tracker refresh or database creation. */
export async function readAssessments(state: string, filter: AssessmentFilter) {
	const database = new Database(join(state, "colony.sqlite"), { readonly: true });
	try {
		const rows = z
			.array(z.object({ snapshot: z.string() }))
			.parse(
				database
					.query(
						"SELECT snapshot FROM assessments WHERE root = ? AND beads_db = ? AND (? IS NULL OR request_id = ?) ORDER BY rowid DESC LIMIT ?",
					)
					.all(
						filter.repository.root,
						filter.repository.beadsDb,
						filter.request ?? null,
						filter.request ?? null,
						filter.limit,
					),
			);
		const assessments = await Promise.all(
			// eslint-disable-next-line max-statements -- Project private rows without exposing execution tokens or transcript data.
			rows.map(async ({ snapshot }) => {
				const assessment = assessmentSchema.parse(JSON.parse(snapshot));
				let result = null;
				let source = null;
				let sourcePath = null;
				let summary = assessment.phase as string;
				if (assessment.phase === "finished" || assessment.phase === "decided") {
					const decision = assessment.result;
					// eslint-disable-next-line unicorn/prefer-ternary -- Keep failure diagnostics and report summaries explicit.
					if (decision.kind === "failed") {
						summary = `${decision.reason}: ${decision.detail}`;
					} else {
						({ summary } = decision.report);
					}
					if (filter.request) {
						result = decision;
					}
				}
				if (assessment.phase !== "queued") {
					sourcePath = join(assessment.receipt.directory, "source.json");
					if (filter.request && (await Bun.file(sourcePath).exists())) {
						source = assessmentSourceSchema.parse(await Bun.file(sourcePath).json());
					}
				}
				return {
					id: assessment.id,
					phase: assessment.phase,
					queuedAt: assessment.queuedAt,
					requestId: assessment.requestId,
					result,
					source,
					sourcePath,
					summary: summary.slice(START, SUMMARY_LENGTH),
				};
			}),
		);
		return { assessments, kind: "assessments" as const, repository: filter.repository };
	} finally {
		database.close();
	}
}
