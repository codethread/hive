import { expect, test } from "bun:test";
import configuration from "../skills/operations/references/configuration.md" with { type: "text" };
import { createBundledSkills } from "./bundled-skills.ts";
import delegation from "../skills/delegation/SKILL.md" with { type: "text" };
import execution from "../skills/delegation/references/execution.md" with { type: "text" };
import matter from "gray-matter";
import operations from "../skills/operations/SKILL.md" with { type: "text" };
import recovery from "../skills/operations/references/recovery.md" with { type: "text" };

const bundles = [
	{
		command: "bee",
		name: "delegation",
		source: delegation,
		resources: { "references/execution.md": execution },
	},
	{
		command: "colony",
		name: "operations",
		source: operations,
		resources: {
			"references/configuration.md": configuration,
			"references/recovery.md": recovery,
		},
	},
] as const;

test.each([...bundles])(
	"$command bundle preserves its source body and every advertised resource #test-270",
	async ({ command, name, source, resources }) => {
		const provider = createBundledSkills(command);
		const parsed = matter(source);
		expect(await provider.getSkills()).toEqual([
			{
				name,
				description: parsed.data.description,
				body: parsed.content.trim(),
				files: ["SKILL.md", ...Object.keys(resources)],
			},
		]);
		await Promise.all(
			Object.entries(resources).map(async ([path, content]) => {
				expect(await provider.getSkillFile(name, path)).toBe(content);
			}),
		);
	},
);
