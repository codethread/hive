import { createStaticProvider, validateSkillFrontmatter } from "skills-handler";
import type { SkillProvider } from "skills-handler";
import manualRecovery from "../skills/tracker-recovery/references/manual-recovery.md" with { type: "text" };
import matter from "gray-matter";
import migration from "../skills/repository-setup/references/hook-migration.md" with { type: "text" };
import publication from "../skills/repository-setup/references/publication.md" with { type: "text" };
import recovery from "../skills/tracker-recovery/SKILL.md" with { type: "text" };
import setup from "../skills/repository-setup/SKILL.md" with { type: "text" };
import setupMigration from "../skills/repository-setup/references/setup-migration.md" with { type: "text" };

/** Embed setup and recovery guidance in the standalone executable. */
export function createBundledSkills(): SkillProvider {
	const parsed = matter(setup);
	const parsedRecovery = matter(recovery);
	if (!validateSkillFrontmatter(parsed.data) || !validateSkillFrontmatter(parsedRecovery.data)) {
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
			{
				name: parsedRecovery.data.name,
				description: parsedRecovery.data.description,
				body: parsedRecovery.content.trim(),
				files: ["SKILL.md", "references/manual-recovery.md"],
			},
		],
		{
			[parsed.data.name]: {
				"references/publication.md": publication,
				"references/hook-migration.md": migration,
				"references/setup-migration.md": setupMigration,
			},
			[parsedRecovery.data.name]: {
				"references/manual-recovery.md": manualRecovery,
			},
		},
	);
}
