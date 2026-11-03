import type { AuditResult, Coverage, Domain, ReviewInput } from "./review.ts";
import { aggregateVerdict, resultSchema, reviewInputSchema, selectDomains } from "./review.ts";
import { assign, setup } from "xstate";
import { scopeInstructions } from "./scope.ts";
import { z } from "zod";

const ZERO = 0;
const strings = z.array(z.string());
const selectedPaths = z.object({ code: strings, tests: strings, docs: strings, spec: strings });
const coverageSchema = z.object({ paths: selectedPaths, unmatched: strings });
const outcomeSchema = z.object({
	code: resultSchema.optional(),
	tests: resultSchema.optional(),
	docs: resultSchema.optional(),
	spec: resultSchema.optional(),
});
export const inputSchema = reviewInputSchema;
export const commandSchemas = { reviewed: resultSchema, synthesized: resultSchema };
interface Context extends ReviewInput {
	/** Fixed branch selection derived from resolved paths. */
	coverage: Coverage;
	/** Original worker outcomes retained for driver synthesis. */
	results: Partial<Record<Domain, AuditResult>>;
}
interface Event {
	/** Each domain has its own event, preventing sibling advancement. */
	type: "CODE.REVIEWED" | "TESTS.REVIEWED" | "DOCS.REVIEWED" | "SPEC.REVIEWED" | "SYNTHESIZED";
	/** Native submitted response pointer and verdict. */
	data: AuditResult;
}
export const resumeSchema = inputSchema.extend({
	coverage: coverageSchema,
	results: outcomeSchema,
});

export function runBrief(input: ReviewInput): { title: string; description: string } {
	return {
		title: `Review ${input.evidence.sourceTask}`,
		description:
			`Review ${input.target}; caller owns overlapping edits and final approval. ` +
			"Collect every selected audit, publish the independent synthesis on this run, then complete synthesis. " +
			"Execution completion with findings or incomplete coverage is not approval of the source task.",
	};
}

export const machine = setup({
	types: { context: {} as Context, input: {} as ReviewInput, events: {} as Event },
	guards: {
		codeOmitted: ({ context }) => context.coverage.paths.code.length === ZERO,
		testsOmitted: ({ context }) => context.coverage.paths.tests.length === ZERO,
		docsOmitted: ({ context }) => context.coverage.paths.docs.length === ZERO,
		specOmitted: ({ context }) => context.coverage.paths.spec.length === ZERO,
	},
	actions: {
		codeResult: assign({
			results: ({ context, event }) => ({ ...context.results, code: event.data }),
		}),
		testsResult: assign({
			results: ({ context, event }) => ({ ...context.results, tests: event.data }),
		}),
		docsResult: assign({
			results: ({ context, event }) => ({ ...context.results, docs: event.data }),
		}),
		specResult: assign({
			results: ({ context, event }) => ({ ...context.results, spec: event.data }),
		}),
	},
}).createMachine({
	id: "review",
	context: ({ input }) => ({
		...input,
		coverage: selectDomains(input.scope, input.purpose.spec !== undefined),
		results: {},
	}),
	initial: "audits",
	states: {
		audits: {
			type: "parallel",
			onDone: "synthesis",
			states: {
				code: {
					initial: "audit",
					states: {
						audit: {
							always: { guard: "codeOmitted", target: "done" },
							meta: {
								title: "Review code",
								commands: { reviewed: "CODE.REVIEWED" },
								task: ({ context }: { context: Context }) => ({
									bee: { kind: "reviewer" },
									instructions: auditBrief("code", context),
								}),
							},
							on: { "CODE.REVIEWED": { actions: "codeResult", target: "done" } },
						},
						done: { type: "final" },
					},
				},
				tests: {
					initial: "audit",
					states: {
						audit: {
							always: { guard: "testsOmitted", target: "done" },
							meta: {
								title: "Review tests",
								commands: { reviewed: "TESTS.REVIEWED" },
								task: ({ context }: { context: Context }) => ({
									bee: { kind: "reviewer" },
									instructions: auditBrief("tests", context),
								}),
							},
							on: { "TESTS.REVIEWED": { actions: "testsResult", target: "done" } },
						},
						done: { type: "final" },
					},
				},
				docs: {
					initial: "audit",
					states: {
						audit: {
							always: { guard: "docsOmitted", target: "done" },
							meta: {
								title: "Review docs",
								commands: { reviewed: "DOCS.REVIEWED" },
								task: ({ context }: { context: Context }) => ({
									bee: { kind: "reviewer" },
									instructions: auditBrief("docs", context),
								}),
							},
							on: { "DOCS.REVIEWED": { actions: "docsResult", target: "done" } },
						},
						done: { type: "final" },
					},
				},
				spec: {
					initial: "audit",
					states: {
						audit: {
							always: { guard: "specOmitted", target: "done" },
							meta: {
								title: "Review spec",
								commands: { reviewed: "SPEC.REVIEWED" },
								task: ({ context }: { context: Context }) => ({
									bee: { kind: "reviewer" },
									instructions: auditBrief("spec", context),
								}),
							},
							on: { "SPEC.REVIEWED": { actions: "specResult", target: "done" } },
						},
						done: { type: "final" },
					},
				},
			},
		},
		synthesis: {
			meta: {
				title: "Synthesize domain reviews",
				commands: { synthesized: "SYNTHESIZED" },
				task: ({ context }: { context: Context }) => ({
					instructions:
						`Read each immutable response and closed native outcome; publish an independent synthesis on this run. ` +
						`Include coverage and all request/stage/response IDs, separate Standards and Spec ` +
						`findings, required repairs, ` +
						`suggestions, gaps and exact scope/content. Omitted Spec is not_requested. ` +
						`For final gates, the caller verifies supplied Bookworm/Librarian roles from native provenance once; ` +
						`report headings never determine author role. Completion does not approve the parent. ` +
						`If managed for an outer run, use standalone publication for this child synthesis; ` +
						`consult bee response publish --help.\n${JSON.stringify({
							coverage: context.coverage,
							results: context.results,
							verdict: aggregateVerdict(context.coverage, context.results),
							evidence: context.evidence,
							purpose: context.purpose,
							scope: context.scope,
							target: context.target,
						})}`,
				}),
			},
			on: { SYNTHESIZED: "done" },
		},
		done: { type: "final" },
	},
});

// --- Private functions ---

function auditBrief(domain: Domain, context: Context): string {
	const guidance: Record<Domain, string> = {
		code:
			"Audit executable code/configuration style, CLI contracts and robustness using applicable package AGENTS.md, " +
			".agents/skills/typescript/SKILL.md, .agents/skills/agent-clis/SKILL.md and the available robustness skill. " +
			"Architectural conformity belongs to Librarian.",
		tests:
			"Audit behavioral coverage, assertion quality, fakes, I/O seams and supplied timing evidence using " +
			".agents/skills/testing/SKILL.md and .agents/skills/io-dependency-seams/SKILL.md. " +
			"Read nearby tests even when only production files changed.",
		docs:
			"Audit factual correctness, commands, links and applicability against implementation using " +
			".agents/skills/docs-styleguide/SKILL.md, .agents/skills/writing-for-agents/SKILL.md and " +
			".agents/skills/agent-docs-hotpath/SKILL.md where " +
			"applicable. Bookworm owns edits.",
		spec:
			"Independently compare the complete scope with the supplied request, acceptance and corrections; " +
			"report missing, wrong or unrequested behavior without repeating standards review.",
	};
	return [
		`Read-only ${domain} audit in ${context.target}. ${scopeInstructions(context.scope)}`,
		guidance[domain],
		"Apply docs/agents/specialists.md scoped-audit responsibilities to assigned paths; " +
			"surrounding contracts are context.",
		"Complete reviewed with verdict clear, findings or incomplete and your immutable response ID.",
		JSON.stringify({
			paths: context.coverage.paths[domain],
			scope: context.scope,
			evidence: context.evidence,
			purpose: context.purpose,
		}),
	].join("\n");
}
