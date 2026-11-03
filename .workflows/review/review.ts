import { scopePaths, scopeSchema } from "./scope.ts";
import type { Scope } from "./scope.ts";
import { z } from "zod";

const ZERO = 0;
const text = z.string().nonempty();
const gateSchema = z.object({
	role: z.enum(["bookworm", "librarian"]),
	run: text,
	stage: text,
	request: text.optional(),
	response: text,
	verdict: z.literal("approved"),
	base: text,
	content: text,
});
const specSchema = z.object({ request: text, acceptance: text, corrections: z.array(text) });
export const evidenceSchema = z.object({
	sourceTask: text,
	content: text,
	checks: z.array(text),
	architecture: z.array(text),
});
const bookwormGate = gateSchema.extend({ role: z.literal("bookworm") });
const librarianGate = gateSchema.extend({ role: z.literal("librarian") });
export const purposeSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("advisory"), spec: specSchema.optional() }),
	z.object({
		kind: z.literal("final-gate"),
		spec: specSchema,
		bookworm: bookwormGate,
		librarian: librarianGate,
	}),
]);
export const reviewInputSchema = z.object({
	target: text.startsWith("/"),
	scope: scopeSchema,
	evidence: evidenceSchema,
	purpose: purposeSchema,
});
export type ReviewInput = z.infer<typeof reviewInputSchema>;
export type Domain = "code" | "tests" | "docs" | "spec";
export const resultSchema = z.object({
	verdict: z.enum(["clear", "findings", "incomplete"]),
	response: text,
});
export type AuditResult = z.infer<typeof resultSchema>;
export interface Coverage {
	/** Selected paths per fixed domain; empty means omitted. */
	paths: Record<Domain, string[]>;
	/** Paths without a standards-domain owner. */
	unmatched: string[];
}

// eslint-disable-next-line max-statements -- Keep fixed domain routing together.
export function selectDomains(scope: Scope, hasSpec: boolean): Coverage {
	const files = scopePaths(scope);
	const paths: Record<Domain, string[]> = {
		code: [],
		tests: [],
		docs: [],
		spec: [],
	};
	if (hasSpec) {
		paths.spec = files;
	}
	const unmatched: string[] = [];
	for (const path of files) {
		if (/\.(?:md|mdx|rst|txt)$/u.test(path)) {
			paths.docs.push(path);
		} else if (
			/\.(?:[cm]?[jt]sx?|json|jsonc|ya?ml|toml|sh|bash|zsh|css|html|lock)$/u.test(path) ||
			/(?:^|\/)(?:Makefile|Dockerfile|\.gitignore|\.gitattributes|\.editorconfig|\.npmrc|\.bun-version)$/u.test(
				path,
			)
		) {
			paths.code.push(path);
			paths.tests.push(path);
		} else {
			unmatched.push(path);
		}
	}
	return { paths, unmatched };
}

export function aggregateVerdict(
	coverage: Coverage,
	results: Partial<Record<Domain, AuditResult>>,
): AuditResult["verdict"] {
	const selected = (Object.keys(coverage.paths) as Domain[]).filter(
		(domain) => coverage.paths[domain].length > ZERO,
	);
	if (
		coverage.unmatched.length > ZERO ||
		selected.some(
			(domain) => results[domain] === undefined || results[domain]?.verdict === "incomplete",
		)
	) {
		return "incomplete";
	}
	if (selected.some((domain) => results[domain]?.verdict === "findings")) {
		return "findings";
	}
	return "clear";
}
