import { BeeswaxError, EXIT } from "./errors.ts";
import type { Command } from "commander";

// Public tool concepts from package bins, release artifacts and docs/architecture.md.
// Runtime, worker and watchdog executables belong to Colony's operations guidance.
const tools = [
	{
		name: "honeycomb",
		everyday: true,
		guidance: "Use Honeycomb for all Git worktrees.",
		instructions: "honeycomb skills get git-workflow",
	},
	{
		name: "busybee",
		everyday: true,
		guidance: "Use Busy Bee to execute workflows and record outcomes.",
		instructions: "busybee skills get workflow-execution",
	},
	{
		name: "bee",
		everyday: true,
		guidance: "Use Bee for all agent delegation and read its results.",
		instructions: "bee skills get delegation",
	},
	{
		name: "qlock",
		everyday: true,
		guidance: "Use qlock for shared command and merge queues under repository policy.",
		instructions: "qlock skills get command-queues",
	},
	{
		name: "colony",
		everyday: false,
		guidance: "Operate scheduling and execution of submitted bee requests.",
		instructions: "colony skills get operations",
	},
	{
		name: "beeswax",
		everyday: false,
		guidance: "Configure repositories, trackers, Git hooks and harness onboarding.",
		instructions: "beeswax skills get repository-setup",
	},
	{
		name: "waggle",
		everyday: false,
		guidance: "Run repository-owned semantic classifiers to direct review attention.",
		instructions: "waggle list --json; waggle describe <id> --json; waggle --help",
	},
	{
		name: "hive-ui",
		everyday: false,
		guidance: "View repository work and workflow state in a read-only web board.",
		instructions: "hive-ui --help",
	},
] as const;

interface PrimeOptions {
	/** Optional tool guidance added to the everyday set. */
	include: readonly string[];
	/** Tools removed after inclusion, including everyday tools. */
	exclude: readonly string[];
}

/** Register read-only onboarding without invoking repository or tracker services. */
export function addPrime(program: Command, emit: (value: object, text?: string) => void): void {
	program
		.command("prime")
		.description("Print Hive onboarding; works offline outside a configured repository")
		.option("--include <tool>", "Add a tool to the everyday set; repeatable", collect, [])
		.option("--exclude <tool>", "Remove a tool after inclusion; repeatable", collect, [])
		.addHelpText(
			"after",
			"\nDefaults: honeycomb, busybee, bee, qlock. Includes add; excludes win.\n" +
				`Tools: ${tools.map((tool) => tool.name).join(", ")}.\n` +
				"Rows keep the listed order; repeated names add no rows. Unknown names are usage errors.\n" +
				"Examples: beeswax prime --include colony --include beeswax\n" +
				"          beeswax prime --exclude bee --exclude busybee\n" +
				"With --json, returns a prime document containing the same onboarding text.\n",
		)
		.action(function prime(this: Command) {
			const content = renderPrime(this.opts<PrimeOptions>());
			emit({ ok: true, kind: "prime", content }, content);
		});
}

/** Select canonical rows once so filtering never changes an individual tool's guidance. */
export function renderPrime(options: PrimeOptions): string {
	for (const name of [...options.include, ...options.exclude]) {
		if (!tools.some((tool) => tool.name === name)) {
			throw new BeeswaxError(
				"usage",
				`Unknown tool '${name}'. Choose: ${tools.map((tool) => tool.name).join(", ")}.`,
				{
					exitCode: EXIT.usage,
				},
			);
		}
	}
	const selected = tools.filter(
		(tool) =>
			(tool.everyday || options.include.includes(tool.name)) &&
			!options.exclude.includes(tool.name),
	);
	return [
		"This repository uses Hive. Follow these conventions:",
		"Read a tool's instructions when its task applies; use its --help for command options.",
		"After upgrading, read <tool> changelog for breaking changes and adoption actions.",
		"",
		"| Tool | When to use it | Instructions |",
		"| --- | --- | --- |",
		...selected.map((tool) => `| ${tool.name} | ${tool.guidance} | \`${tool.instructions}\` |`),
	].join("\n");
}

/** The project pin is a comparison baseline, not evidence of adoption or acknowledgment. */
export function updateChangelogs(
	previousVersion: string,
	installedVersion: string,
	commandAvailable: (name: string) => boolean,
) {
	let selector = "";
	if (previousVersion !== installedVersion) {
		selector = ` --since ${previousVersion}`;
	}
	return {
		previousVersion,
		installedVersion,
		commands: tools
			.filter((tool) => commandAvailable(tool.name))
			.map((tool) => `${tool.name} changelog${selector}`),
	};
}

// --- Private functions ---

function collect(value: string, previous: string[]): string[] {
	return [...previous, value];
}
