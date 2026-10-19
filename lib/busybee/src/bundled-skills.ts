import { createStaticProvider, validateSkillFrontmatter } from "skills-handler";
import type { SkillProvider } from "skills-handler";
import authoring from "../skills/workflow-authoring/SKILL.md" with { type: "text" };
import matter from "gray-matter";
import workflow from "../skills/workflow-execution/SKILL.md" with { type: "text" };

/** Embed portable instructions and resources in source and standalone executables. */
export function createBundledSkills(): SkillProvider {
	return createStaticProvider(
		[workflow, authoring].map((source) => {
			const parsed = matter(source);
			if (!validateSkillFrontmatter(parsed.data)) {
				throw new Error("Invalid frontmatter in Busy Bee's bundled skill");
			}
			const { name, description } = parsed.data;
			return {
				name,
				description,
				body: parsed.content.trim(),
				files: ["SKILL.md"],
			};
		}),
	);
}
