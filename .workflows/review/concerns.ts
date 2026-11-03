import { Glob, TOML } from "bun";
import type { Scope } from "./scope.ts";
import { z } from "zod";

const ZERO = 0;
const ONE = 1;
const text = z.string().trim().min(ONE);
const concernSchema = z.strictObject({
	id: z.string().regex(/^[a-z][a-z0-9-]*$/u),
	title: text,
	kind: z.enum(["reviewer", "librarian"]),
	patterns: z.array(text).min(ONE),
	sources: z.array(text).min(ONE),
	focus: text,
});
const catalogueSchema = z
	.strictObject({
		concerns: z.array(concernSchema).min(ONE),
	})
	.refine(
		({ concerns }) => new Set(concerns.map((concern) => concern.id)).size === concerns.length,
		{
			message: "Concern IDs must be unique",
		},
	);
export const jobSchema = concernSchema.omit({ patterns: true }).extend({
	axis: z.enum(["standards", "spec"]),
	files: z.array(z.string().min(ONE)).min(ONE),
});
export type ReviewJob = z.infer<typeof jobSchema>;

/** The index selects expertise; the referenced skills remain the standards authority. */
export function selectReviews(
	scope: Scope,
	catalogue: string,
	spec: string | undefined,
): ReviewJob[] {
	const { concerns } = catalogueSchema.parse(TOML.parse(catalogue));
	const jobs: ReviewJob[] = concerns.flatMap(({ patterns, ...concern }) => {
		const globs = patterns.map((pattern) => new Glob(pattern));
		const files = scope.files.filter((file) => globs.some((glob) => glob.match(file)));
		if (files.length === ZERO) {
			return [];
		}
		return [{ ...concern, axis: "standards" as const, files }];
	});
	if (spec !== undefined) {
		jobs.push({
			axis: "spec",
			files: scope.files,
			focus: `Review the selected scope against this supplied specification. Report missing, incorrect or out-of-scope behaviour; cite the exact requirement.\n\n${text.parse(spec)}`,
			id: "spec",
			kind: "reviewer",
			sources: ["Supplied specification in this task"],
			title: "Specification compliance",
		});
	}
	if (new Set(jobs.map((job) => job.id)).size !== jobs.length) {
		throw new Error("Concern ID spec is reserved for specification review");
	}
	return jobs;
}
