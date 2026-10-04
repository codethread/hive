import { Glob, TOML } from "bun";
import { z } from "zod";

const codexAgents = `${import.meta.dir}/../../../.codex/agents`;
const piAgents = `${import.meta.dir}/../../../.pi/agents`;
const minimumTextLength = 1;
const piTools: Readonly<Record<string, string>> = {
	librarian: "read, bash, subagent",
	reviewer: "read, bash",
};

const requiredString = z.string().trim().min(minimumTextLength);
const agentSchema = z.object({
	description: requiredString,
	developer_instructions: requiredString,
	model: requiredString,
	model_reasoning_effort: requiredString,
	name: requiredString,
});

type Agent = z.infer<typeof agentSchema>;

export async function syncAgents(): Promise<void> {
	const glob = new Glob("*.toml");
	const files = await Array.fromAsync(glob.scan({ cwd: codexAgents }));
	await Promise.all(files.map((file) => syncAgent(file)));
}
// --- Private functions ---

function parseAgent(contents: string, file: string): Agent {
	const result = agentSchema.safeParse(TOML.parse(contents));
	if (!result.success) {
		throw new Error(`${file}: ${z.prettifyError(result.error)}`);
	}
	const agent = result.data;
	if (`${agent.name}.toml` !== file) {
		throw new Error(`${file}: name must match the filename`);
	}
	return agent;
}

function renderPiAgent(agent: Agent, file: string): string {
	const tools = piTools[agent.name] ?? "read, bash";
	return `---\nname: ${agent.name}\ndescription: ${JSON.stringify(agent.description)}\nmodel:\n  - openai-codex/${agent.model}:${agent.model_reasoning_effort}\ntools: ${tools}\nmetadata:\n  source: .codex/agents/${file}\n---\n\n${agent.developer_instructions.trim()}\n`;
}

async function syncAgent(file: string): Promise<void> {
	const source = `${codexAgents}/${file}`;
	const contents = await Bun.file(source).text();
	const agent = parseAgent(contents, file);
	const target = `${piAgents}/${agent.name}.md`;
	await Bun.write(target, renderPiAgent(agent, file));
	console.log(`Synced .pi/agents/${agent.name}.md`);
}

if (import.meta.main) {
	await syncAgents();
}
