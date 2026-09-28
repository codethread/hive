import { isAbsolute, normalize } from "node:path";
import { z } from "zod";
import {
	expandConfigPath,
	expandConfigGlob,
	rootGlobMatches,
	type ConfigPathContext,
} from "./domain/config.ts";

export const CopyModeSchema = z.enum(["copy", "symlink"]);
export const PoolSizeSchema = z.number().int().min(1);

const NonEmptyStringSchema = z.string().regex(/\S/, "must be a non-empty string");
// oxlint-disable-next-line no-control-regex -- Filesystem paths cannot contain a null byte; also emit this constraint for editors.
const PathSchema = NonEmptyStringSchema.regex(/^[^\x00]*$/, "path must not contain a null byte");
const WorktreeLocationSchema = z.enum(["sibling", "nested"]);
const AddPolicySchema = z.strictObject({
	policy: z
		.enum(["origin_default", "fresh_canonical"])
		.describe("Start from origin's default branch or first fast-forward the canonical checkout."),
});
const FinishPolicySchema = z.strictObject({
	enabled: z.boolean().optional().describe("Allow finishing; built-in default: true."),
	strategy: z
		.enum(["ff_only", "rebase_ff", "squash", "merge_commit"])
		.optional()
		.describe("Integration strategy; built-in default: ff_only."),
	push: z.boolean().optional().describe("Push before cleanup; built-in default: false."),
	remove_worktree: z
		.boolean()
		.optional()
		.describe("Remove the checkout after integration; built-in default: false."),
	delete_branch: z
		.boolean()
		.optional()
		.describe(
			"Delete its branch; requires remove_worktree in the effective policy. Default: false.",
		),
});
const PolicyShape = {
	add: AddPolicySchema.optional().describe("Override the inherited add policy."),
	finish: FinishPolicySchema.optional().describe("Override individual inherited finish fields."),
};

const RelativeCopyPathSchema = PathSchema.regex(
	/^[^/~]/,
	"copy path must be relative, not absolute or start with ~",
)
	.refine((value) => {
		const path = normalize(value);
		return path !== "." && path !== ".." && !path.startsWith("../") && !isAbsolute(path);
	}, "copy path must stay within the worktree")
	.describe("A worktree-relative destination that stays inside the worktree after normalization.");

const CopyDestinationsSchema = z.union([
	RelativeCopyPathSchema,
	z.array(RelativeCopyPathSchema).min(1),
]);

const CopyEntrySchema = z.union([
	RelativeCopyPathSchema.describe("Copy this relative path to the same destination."),
	z.strictObject({
		from: PathSchema.describe(
			"Source relative to the canonical root, absolute, or beginning with ~/.",
		),
		to: CopyDestinationsSchema,
		mode: CopyModeSchema.optional().describe("Override this project's copy_mode_default."),
	}),
]);

const SetupShape = {
	command: NonEmptyStringSchema.optional().describe(
		"Bootstrap command run under bash; inherits from rules.",
	),
	pre_remote_check: NonEmptyStringSchema.optional().describe(
		"Bash command run before remote operations.",
	),
	worktree_location: WorktreeLocationSchema.optional().describe(
		"Override the inherited placement for new worktrees.",
	),
};

const ProjectSchema = z.strictObject({
	root: PathSchema.describe("Canonical checkout path; leading ~/ and relative paths are expanded."),
	name: z.string().optional().describe("Display name; defaults to the expanded root's basename."),
	...SetupShape,
	pool_size: PoolSizeSchema.optional().describe(
		"Fixed pool size; requires an effective bootstrap command.",
	),
	copy_mode_default: CopyModeSchema.optional().describe(
		"Default copy mode (copy when omitted); setting it requires an effective command.",
	),
	copy: z
		.array(CopyEntrySchema)
		.default([])
		.describe(
			"Files to materialize before bootstrap; non-empty lists require an effective command.",
		),
	...PolicyShape,
});

const RuleSchema = z.strictObject({
	root_glob: PathSchema.regex(
		/^(?:~(?:\/|$)|[^~])/,
		"root_glob supports only leading ~/ expansion",
	).describe("Canonical-root glob: * matches within a segment, ** matches zero or more segments."),
	...SetupShape,
	...PolicyShape,
});

/** One TOML schema; path context supplies environment-dependent cross-entry validation. */
export const createConfigSchema = (context: ConfigPathContext) =>
	z
		.strictObject({
			worktree_location: WorktreeLocationSchema.default("sibling").describe(
				"Global placement for new worktrees.",
			),
			defaults: z
				.strictObject(PolicyShape)
				.default({})
				.describe("Policy patches applied over built-in defaults."),
			rule: z
				.array(RuleSchema)
				.default([])
				.describe("Matching rules apply in file order; later values win."),
			project: z
				.array(ProjectSchema)
				.default([])
				.describe("Exact-root overrides; expanded roots must be unique."),
		})
		.superRefine((config, refinement) => {
			const roots = new Set<string>();
			const projects = config.project.map((project) => ({
				project,
				root: expandConfigPath(project.root, context),
			}));
			for (const [index, { project, root }] of projects.entries()) {
				if (roots.has(root)) {
					refinement.addIssue({
						code: "custom",
						path: ["project", index, "root"],
						message: `duplicate root \`${root}\``,
					});
				}
				roots.add(root);
				const needsCommand =
					project.pool_size !== undefined ||
					project.copy.length > 0 ||
					project.copy_mode_default !== undefined;
				if (!needsCommand) continue;
				const canonicalRoot = context.normalizePath(root);
				const effectiveProject = projects.find(
					(candidate) => context.normalizePath(candidate.root) === canonicalRoot,
				)?.project;
				if (effectiveProject?.command !== undefined) continue;
				const inheritedCommand = config.rule.some(
					(rule) =>
						rule.command !== undefined &&
						rootGlobMatches(expandConfigGlob(rule.root_glob, context), canonicalRoot),
				);
				if (!inheritedCommand) {
					refinement.addIssue({
						code: "custom",
						path: ["project", index, "command"],
						message: `root \`${root}\` requires an effective command for pooled or copy setup`,
					});
				}
			}
		})
		.describe(
			"HONEYCOMB configuration. Policy inheritance, canonical path matching and normalized path safety are also checked at runtime.",
		);

export type RawConfig = z.output<ReturnType<typeof createConfigSchema>>;
