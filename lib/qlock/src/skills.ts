import { EXIT, QlockError } from "./queue.ts";
import type { Skill, SkillProvider } from "skills-handler";
import type { Command } from "commander";

interface OutputOptions {
	/** Emit one machine-readable result instead of Markdown or discovery rows. */
	json?: boolean;
}

type SkillsResult =
	| {
			/** Discovery contains metadata only. */
			kind: "skills_list";
			/** Available skills and their progressively disclosed resources. */
			skills: Pick<Skill, "name" | "description" | "files">[];
	  }
	| {
			/** Read one instruction body or supporting resource. */
			kind: "skills_get";
			/** Bundled skill identifier. */
			name: string;
			/** Advertised path within the skill. */
			path: string;
			/** Markdown body without frontmatter, or resource content. */
			content: string;
	  };

/** Register offline instruction reads independently of queue admission and storage. */
export function registerSkills(program: Command, stdout: (text: string) => void): void {
	const skills = program
		.command("skills")
		.description("Read bundled agent skills (default: list); works offline outside a repository")
		.option("--json", "One JSON result or error; put before other options")
		.action(async function list(this: Command) {
			writeResult(this, stdout, await listSkills());
		});
	skills
		.command("list")
		.description("List names and descriptions; --json also includes resource paths")
		.option("--json", "One JSON result or error")
		.action(async function list(this: Command) {
			writeResult(this, stdout, await listSkills());
		});
	skills
		.command("get <name>")
		.description("Print a skill's Markdown body without frontmatter")
		.option("--json", "One JSON result or error")
		.action(async function get(this: Command, name: string) {
			writeResult(this, stdout, await readSkill(name, "SKILL.md"));
		});
	skills
		.command("file <name> <path>")
		.description("Read an advertised resource; SKILL.md returns the same body as get")
		.option("--json", "One JSON result or error")
		.action(async function file(this: Command, name: string, path: string) {
			writeResult(this, stdout, await readSkill(name, path));
		});
}

// --- Private functions ---

async function listSkills(): Promise<SkillsResult> {
	const { createBundledSkills } = await import("./bundled-skills.ts");
	const catalog = await createBundledSkills().getSkills();
	const skills = catalog.map(({ name, description, files }) => ({ name, description, files }));
	return { kind: "skills_list", skills };
}

async function readSkill(name: string, path: string): Promise<SkillsResult> {
	const { createBundledSkills } = await import("./bundled-skills.ts");
	const provider = createBundledSkills();
	const catalog = await provider.getSkills();
	const skill = catalog.find((entry) => entry.name === name);
	if (!skill) {
		throw new QlockError("usage", `skill not found: ${name}`, EXIT.usage);
	}
	if (!skill.files.includes(path)) {
		throw new QlockError("usage", `skill file not found: ${name}/${path}`, EXIT.usage);
	}
	const content = await readContent(provider, skill, path);
	return { kind: "skills_get", name, path, content };
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

function writeResult(command: Command, stdout: (text: string) => void, result: SkillsResult): void {
	if (command.optsWithGlobals<OutputOptions>().json === true) {
		stdout(`${JSON.stringify({ ok: true, ...result })}\n`);
		return;
	}
	if (result.kind === "skills_list") {
		const rows = result.skills.map(({ name, description }) => `${name}\t${description}`);
		stdout(`${rows.join("\n")}\n`);
		return;
	}
	stdout(`${result.content.trimEnd()}\n`);
}
