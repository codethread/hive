import { createStaticProvider, validateSkillFrontmatter } from "skills-handler";
import type { SkillProvider } from "skills-handler";
import matter from "gray-matter";
import mergeQueues from "../skills/command-queues/references/merge-queues.md" with { type: "text" };
import workflow from "../skills/command-queues/SKILL.md" with { type: "text" };

/** Embed instructions and references in both source and standalone executables. */
export function createBundledSkills(): SkillProvider {
	const parsed = matter(workflow);
	if (!validateSkillFrontmatter(parsed.data)) {
		throw new Error("Invalid frontmatter in qlock's bundled command-queues skill");
	}
	const { name, description } = parsed.data;
	return createStaticProvider(
		[
			{
				name,
				description,
				body: parsed.content.trim(),
				files: ["SKILL.md", "references/merge-queues.md"],
			},
		],
		{ [name]: { "references/merge-queues.md": mergeQueues } },
	);
}
