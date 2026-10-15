import { createStaticProvider, validateSkillFrontmatter } from "skills-handler";
import type { SkillProvider } from "skills-handler";
import delegation from "../skills/delegation/SKILL.md" with { type: "text" };
import execution from "../skills/delegation/references/execution.md" with { type: "text" };
import matter from "gray-matter";
import operations from "../skills/operations/SKILL.md" with { type: "text" };
import recovery from "../skills/operations/references/recovery.md" with { type: "text" };

/** Embed each executable's portable instructions and on-demand reference. */
export function createBundledSkills(command: "bee" | "colony"): SkillProvider {
	const bundles = {
		bee: { source: delegation, path: "references/execution.md", content: execution },
		colony: { source: operations, path: "references/recovery.md", content: recovery },
	};
	const bundle = bundles[command];
	const parsed = matter(bundle.source);
	if (!validateSkillFrontmatter(parsed.data)) {
		throw new Error(`Invalid frontmatter in ${command}'s bundled skill`);
	}
	const { name, description } = parsed.data;
	return createStaticProvider(
		[{ name, description, body: parsed.content.trim(), files: ["SKILL.md", bundle.path] }],
		{ [name]: { [bundle.path]: bundle.content } },
	);
}
