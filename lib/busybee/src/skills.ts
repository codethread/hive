import type { Skill, SkillProvider } from "skills-handler";
import { BusyBeeError } from "./native.ts";
import { createBundledSkills } from "./bundled-skills.ts";

/** Serve bundled guidance without consulting repository or runtime services. */
export async function readSkills(action = "list", name?: string, resource?: string) {
	const provider = createBundledSkills();
	const skills = await provider.getSkills();
	if (action === "list") {
		return listSkills(skills);
	}
	if (action !== "get" && action !== "file") {
		throw new BusyBeeError("usage", `unknown skills subcommand: ${action}`);
	}
	return readSkill(provider, findSkill(skills, name), { action, resource });
}

// --- Private functions ---

async function readSkill(
	provider: SkillProvider,
	skill: Skill,
	selection: { action: string; resource: string | undefined },
) {
	let path = "SKILL.md";
	if (selection.action === "file") {
		path = requireResource(skill, selection.resource);
	}
	const content = await readContent(provider, skill, path);
	return { payload: { kind: "skills_get", name: skill.name, path, content }, readable: content };
}

function listSkills(skills: Skill[]) {
	const entries = skills.map(({ name, description, files }) => ({ name, description, files }));
	return {
		payload: { kind: "skills_list", skills: entries },
		readable: entries.map((skill) => `${skill.name}\t${skill.description}`).join("\n"),
	};
}

function findSkill(skills: Skill[], name: string | undefined): Skill {
	const skill = skills.find((entry) => entry.name === name);
	if (!skill) {
		throw new BusyBeeError("usage", `skill not found: ${name ?? "(missing name)"}`);
	}
	return skill;
}

function requireResource(skill: Skill, resource: string | undefined): string {
	if (!resource || !skill.files.includes(resource)) {
		throw new BusyBeeError(
			"usage",
			`skill file not found: ${skill.name}/${resource ?? "(missing path)"}`,
		);
	}
	return resource;
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
