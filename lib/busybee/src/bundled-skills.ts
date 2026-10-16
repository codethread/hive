import { createStaticProvider, validateSkillFrontmatter } from "skills-handler";
import type { SkillProvider } from "skills-handler";
import authoring from "../skills/workflow-execution/references/authoring.md" with { type: "text" };
import matter from "gray-matter";
import workflow from "../skills/workflow-execution/SKILL.md" with { type: "text" };

/** Embed portable instructions and resources in source and standalone executables. */
export function createBundledSkills(): SkillProvider {
	const parsed = matter(workflow);
	if (!validateSkillFrontmatter(parsed.data)) {
		throw new Error("Invalid frontmatter in Busy Bee's bundled workflow-execution skill");
	}
	const { name, description } = parsed.data;
	return createStaticProvider(
		[
			{
				name,
				description,
				body: parsed.content.trim(),
				files: ["SKILL.md", "references/authoring.md"],
			},
		],
		{ [name]: { "references/authoring.md": authoring } },
	);
}
