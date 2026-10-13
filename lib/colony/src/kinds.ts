import type { BeeKind, BeesConfig } from "@hive/shared";
import { canonicalRoot, kindSchema } from "@hive/shared";
import { loadBeesConfig } from "./config.ts";
import { z } from "zod";

const summarySchema = z.strictObject({
	/** Concise guidance on when to choose this kind. */
	description: z.string(),
	/** Configured name accepted by bee spawn. */
	name: z.string(),
	/** Workflow selected for new assignments of this kind. */
	workflow: z.string(),
});
const summaryResultSchema = z.strictObject({
	/** Concise selection guidance only. */
	detail: z.literal("summary"),
	/** Identifies configuration discovery results. */
	kind: z.literal("bee_kinds"),
	/** Visible kind names and descriptions. */
	kinds: z.array(summarySchema),
	/** Configuration conflicts resolved in favor of central definitions. */
	warnings: z.array(z.string()),
});
const fullResultSchema = summaryResultSchema.extend({
	/** Full configuration was explicitly requested. */
	detail: z.literal("full"),
	/** Selected kinds including prompts and visibility configuration. */
	kinds: z.array(
		summarySchema.extend({
			/** Complete configured defaults, disclosed only by explicit request. */
			configuration: kindSchema,
		}),
	),
});
const failureSchema = z.strictObject({
	/** Identifies the existing Bee CLI failure envelope. */
	kind: z.literal("error"),
	/** Human diagnostic; callers branch on reason instead. */
	message: z.string(),
	/** Failure status shared by usage and operation errors. */
	ok: z.literal(false),
	/** Machine-readable command or operational failure. */
	reason: z.union([z.string(), z.number()]),
});

export interface KindOptions {
	/** Repository discovery directory; no tracker or daemon is required. */
	repo: string;
	/** Effective caller kind, selected by --as ahead of BR_AGENT_NAME. */
	as?: string;
	/** Include all kinds regardless of discovery guidance. */
	all: boolean;
	/** Include execution defaults and full prompts. */
	verbose: boolean;
}
export type KindsResult = z.infer<typeof summaryResultSchema> | z.infer<typeof fullResultSchema>;
interface Caller {
	/** Configured kind name used to expand #self. */
	name: string;
	/** Caller-owned discovery guidance. */
	kind: BeeKind;
}

/** Describe success and failure output without reading repository configuration. */
export function kindsJsonSchema(verbose: boolean) {
	let success: z.ZodType = summaryResultSchema.extend({ ok: z.literal(true) });
	if (verbose) {
		success = fullResultSchema.extend({ ok: z.literal(true) });
	}
	return z.toJSONSchema(z.union([success, failureSchema]));
}

/** Read kind selection guidance without touching the tracker or Colony. */
export async function listKinds(
	name: string | undefined,
	options: KindOptions,
): Promise<KindsResult> {
	const root = await canonicalRoot(options.repo);
	const { config, warnings } = await loadBeesConfig(root);
	return { ...discoverKinds(config, name, options), warnings };
}

/** Select the visible catalog; explicit named inspection bypasses discovery filtering. */
export function discoverKinds(
	config: BeesConfig,
	name: string | undefined,
	options: Pick<KindOptions, "as" | "all" | "verbose">,
): KindsResult {
	let caller: Caller | undefined = undefined;
	if (options.as !== undefined) {
		caller = { kind: configuredKind(config, options.as), name: options.as };
	}
	if (name !== undefined) {
		configuredKind(config, name);
	}
	const entries = Object.entries(config.kinds).filter(([target, kind]) => {
		if (name !== undefined) {
			return target === name;
		}
		return options.all || visibleKind(target, kind, caller);
	});
	if (options.verbose) {
		return {
			detail: "full",
			kind: "bee_kinds",
			kinds: entries.map(([target, configuration]) => ({
				configuration,
				description: configuration.description,
				name: target,
				workflow: configuration.workflow,
			})),
			warnings: [],
		};
	}
	return {
		detail: "summary",
		kind: "bee_kinds",
		kinds: entries.map(([target, kind]) => ({
			description: kind.description,
			name: target,
			workflow: kind.workflow,
		})),
		warnings: [],
	};
}

// --- Private functions ---
function configuredKind(config: BeesConfig, name: string): BeeKind {
	const kind = config.kinds[name];
	if (!kind) {
		throw new Error(`Unknown bee kind ${name}`);
	}
	return kind;
}
function visibleKind(name: string, kind: BeeKind, caller: Caller | undefined): boolean {
	const matches = (selector: string) => {
		if (selector === "#self") {
			return caller?.name === name;
		}
		return selector === name;
	};
	if (caller !== undefined && "allow" in caller.kind) {
		return caller.kind.allow.some(matches);
	}
	return (
		!kind.hidden &&
		!(caller !== undefined && "deny" in caller.kind && caller.kind.deny.some(matches))
	);
}
