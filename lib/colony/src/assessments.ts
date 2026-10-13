/* eslint-disable unicorn/no-null -- SQL optional filters and explicitly requested missing source retain absence. */
import { assessmentSchema, assessmentSourceSchema } from "./postrun.ts";
import type { Assessment } from "./postrun.ts";
import { Database } from "bun:sqlite";
import type { RepositoryEndpoint } from "@hive/shared";
/* eslint-disable-next-line import/no-nodejs-modules --
 * Offline access selects the existing daemon store and private source bundle.
 */
import { join } from "node:path";
import { z } from "zod";

const NONE = 0;
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
	/** Exact source request; selecting it includes the full validated report. */
	request?: string | undefined;
	/** Explicitly include the private supporting bundle for a selected request. */
	source?: boolean;
	/** Bounded recent result count. */
	limit: number;
}
export type AssessmentsResult = Awaited<ReturnType<typeof readAssessments>>;
interface AssessmentDetails {
	/** Selected complete report, or failure diagnostics visible in every view. */
	result?: Extract<Assessment, { phase: "finished" }>["result"];
	/** Explicitly requested source bundle; null means its artifact is missing. */
	source?: z.infer<typeof assessmentSourceSchema> | null;
	/** Expected location of the explicitly requested source artifact. */
	sourcePath?: string;
	/** Missing task coverage retained even without requesting the source bundle. */
	coverage?: Pick<Assessment["source"], "unavailableTasks" | "omittedTasks">;
}

/** SELECT-only access: no migration, daemon wake, tracker refresh or database creation. */
export async function readAssessments(state: string, filter: AssessmentFilter) {
	const database = new Database(join(state, "colony.sqlite"), { readonly: true });
	try {
		const rows = z
			.array(z.object({ snapshot: z.string() }))
			.parse(
				database
					.query(
						"SELECT snapshot FROM assessments WHERE root = ? AND beads_db = ? " +
							"AND (? IS NULL OR request_id = ?) ORDER BY rowid DESC LIMIT ?",
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
			/* eslint-disable-next-line max-statements --
			 * Project private rows without exposing execution tokens or transcript data.
			 */
			rows.map(async ({ snapshot }) => {
				const assessment = assessmentSchema.parse(JSON.parse(snapshot));
				const details: AssessmentDetails = {};
				let summary = assessment.phase as string;
				if (assessment.phase === "finished" || assessment.phase === "decided") {
					const decision = assessment.result;
					// eslint-disable-next-line unicorn/prefer-ternary -- Keep failure diagnostics and report summaries explicit.
					if (decision.kind === "failed") {
						summary = `${decision.reason}: ${decision.detail}`;
					} else {
						({ summary } = decision.report);
					}
					if (filter.request || decision.kind === "failed") {
						details.result = decision;
					}
				}
				if (filter.source && assessment.phase !== "queued") {
					const sourcePath = join(assessment.receipt.directory, "source.json");
					details.sourcePath = sourcePath;
					details.source = null;
					if (await Bun.file(sourcePath).exists()) {
						details.source = assessmentSourceSchema.parse(await Bun.file(sourcePath).json());
					}
				}
				if (
					assessment.source.unavailableTasks.length > NONE ||
					assessment.source.omittedTasks > NONE
				) {
					details.coverage = {
						unavailableTasks: assessment.source.unavailableTasks,
						omittedTasks: assessment.source.omittedTasks,
					};
				}
				const row = {
					id: assessment.id,
					phase: assessment.phase,
					queuedAt: assessment.queuedAt,
					requestId: assessment.requestId,
					summary,
				};
				return Object.assign(row, details);
			}),
		);
		return { assessments, kind: "assessments" as const, repository: filter.repository };
	} finally {
		database.close();
	}
}
