import type { Skill, SkillProvider } from "skills-handler";
import type { Command } from "commander";
import { CommanderError } from "commander";
import { createBundledSkills } from "./bundled-skills.ts";

const USAGE_ERROR = 2;

/** Register offline discovery without touching repository or runtime services. */
export function registerSkills(
	program: Command,
	command: "bee" | "colony",
	stdout: (text: string) => void,
): void {
	program
		.command("skills [action] [name] [path]")
		.description("Read bundled agent guidance: list (default), get <name>, file <name> <path>")
		.addHelpText(
			"after",
			`
List metadata first; get returns Markdown instructions without frontmatter.
file NAME SKILL.md returns the same body; load listed supporting files on demand.
Works offline outside a repository, without configuration, a tracker or daemon.
With --json, list returns {ok:true,kind:"skills_list",skills:[{name,description,files}]};
get/file return {ok:true,kind:"skills_get",name,path,content}.
Unknown names, unlisted paths and missing inputs exit 2. JSON errors emit one
{ok:false,kind:"error",reason:"usage",message} document on stdout, with silent stderr.
Examples:
  ${command} skills list --json
  ${command} skills get <name>
  ${command} skills file <name> <path>
`,
		)
		.action(async (action = "list", name?: string, path?: string) => {
			const result = await readSkill(createBundledSkills(command), [action, name, path]);
			if (program.opts()["json"]) {
				stdout(`${JSON.stringify({ ok: true, ...result })}\n`);
			} else if (result.kind === "skills_list") {
				stdout(
					`${result.skills.map((skill) => `${skill.name}\t${skill.description}`).join("\n")}\n`,
				);
			} else {
				stdout(`${result.content.trimEnd()}\n`);
			}
		});
}

// --- Private functions ---
async function readSkill(
	provider: SkillProvider,
	args: [string, string | undefined, string | undefined],
) {
	const [action, name, path] = args;
	const skills = await provider.getSkills();
	if (action === "list" && name === undefined && path === undefined) {
		return {
			kind: "skills_list" as const,
			skills: skills.map(({ name: skillName, description, files }) => ({
				name: skillName,
				description,
				files,
			})),
		};
	}
	if (action !== "get" && action !== "file") {
		throw new CommanderError(USAGE_ERROR, "usage", `unknown skills subcommand: ${action}`);
	}
	const skill = findSkill(skills, name);
	const resource = resourcePath(skill, action, path);
	const content = await readContent(provider, skill, resource);
	return { kind: "skills_get" as const, name: skill.name, path: resource, content };
}

function findSkill(skills: Skill[], name: string | undefined): Skill {
	const skill = skills.find((entry) => entry.name === name);
	if (!skill) {
		throw new CommanderError(USAGE_ERROR, "usage", `skill not found: ${name ?? "(missing name)"}`);
	}
	return skill;
}

function resourcePath(skill: Skill, action: "get" | "file", path: string | undefined): string {
	if (action === "get") {
		if (path !== undefined) {
			throw new CommanderError(USAGE_ERROR, "usage", "skills get accepts only a skill name");
		}
		return "SKILL.md";
	}
	if (!path || !skill.files.includes(path)) {
		throw new CommanderError(
			USAGE_ERROR,
			"usage",
			`skill file not found: ${skill.name}/${path ?? "(missing path)"}`,
		);
	}
	return path;
}

async function readContent(provider: SkillProvider, skill: Skill, path: string): Promise<string> {
	if (path === "SKILL.md") {
		return skill.body;
	}
	const content = await provider.getSkillFile(skill.name, path);
	if (content === null) {
		throw new Error(`Bundled skill file is unavailable: ${skill.name}/${path}`);
	}
	return content;
}
