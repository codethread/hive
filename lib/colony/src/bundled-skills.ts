import { createStaticProvider, validateSkillFrontmatter } from "skills-handler";
import type { SkillProvider } from "skills-handler";
import configuration from "../skills/operations/references/configuration.md" with { type: "text" };
import delegation from "../skills/delegation/SKILL.md" with { type: "text" };
import execution from "../skills/delegation/references/execution.md" with { type: "text" };
import matter from "gray-matter";
import operations from "../skills/operations/SKILL.md" with { type: "text" };
import recovery from "../skills/operations/references/recovery.md" with { type: "text" };

/** Embed each executable's portable instructions and on-demand reference. */
export function createBundledSkills(command: "bee" | "colony"): SkillProvider {
	const bundles = {
		bee: { source: delegation, resources: { "references/execution.md": execution } },
		colony: {
			source: operations,
			resources: {
				"references/configuration.md": configuration,
				"references/recovery.md": recovery,
			},
		},
	};
	const bundle = bundles[command];
	const parsed = matter(bundle.source);
	if (!validateSkillFrontmatter(parsed.data)) {
		throw new Error(`Invalid frontmatter in ${command}'s bundled skill`);
	}
	const { name, description } = parsed.data;
	return createStaticProvider(
		[
			{
				name,
				description,
				body: parsed.content.trim(),
				files: ["SKILL.md", ...Object.keys(bundle.resources)],
			},
		],
		{ [name]: bundle.resources },
	);
}
