import { createStaticProvider, validateSkillFrontmatter } from "skills-handler";
import type { SkillProvider } from "skills-handler";
import matter from "gray-matter";
import migration from "../skills/repository-setup/references/hook-migration.md" with { type: "text" };
import publication from "../skills/repository-setup/references/publication.md" with { type: "text" };
import setup from "../skills/repository-setup/SKILL.md" with { type: "text" };
import setupMigration from "../skills/repository-setup/references/setup-migration.md" with { type: "text" };

/** Embed setup knowledge and optional publication detail in the installed executable. */
export function createBundledSkills(): SkillProvider {
	const parsed = matter(setup);
	if (!validateSkillFrontmatter(parsed.data)) {
		throw new Error("Invalid bundled Beeswax skill frontmatter");
	}
	return createStaticProvider(
		[
			{
				name: parsed.data.name,
				description: parsed.data.description,
				body: parsed.content.trim(),
				files: [
					"SKILL.md",
					"references/publication.md",
					"references/hook-migration.md",
					"references/setup-migration.md",
				],
			},
		],
		{
			[parsed.data.name]: {
				"references/publication.md": publication,
				"references/hook-migration.md": migration,
				"references/setup-migration.md": setupMigration,
			},
		},
	);
}
