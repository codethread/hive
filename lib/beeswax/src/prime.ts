import { BeeswaxError, EXIT } from "./errors.ts";
import type { Command } from "commander";

// Public tool concepts from package bins, release artifacts and docs/architecture.md.
// Runtime, worker and watchdog executables belong to Colony's operations guidance.
const hiveTools = [
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
	{
		name: "scent",
		everyday: false,
		guidance: "Supply identity through Beeswax-managed harness integrations.",
		instructions: "scent --help",
	},
] as const;

const tools = [
	{
		name: "br",
		everyday: true,
		guidance: "Read and update Beads work records.",
		instructions: "br --help",
	},
	{
		name: "bv",
		everyday: true,
		guidance: "Explore dependencies and prioritize work.",
		instructions: "bv --help",
	},
	...hiveTools,
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
			"\nDefaults: br, bv, honeycomb, busybee, bee, qlock. Includes add; excludes win.\n" +
				`Tools: ${tools.map((tool) => tool.name).join(", ")}.\n` +
				"Rows keep the listed order; repeated names add no rows. Unknown names are usage errors.\n" +
				"Include/exclude filter tool rows only; shared safety guidance always remains.\n" +
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
		"After upgrading Hive-owned CLIs, read <tool> changelog for breaking changes and adoption actions. " +
			"This release-history command excludes external br/bv.",
		"",
		"Preserve supplied BEADS_DB and actor identity. " +
			"Native Beads owns tasks, assignments and readiness; BV is advisory.",
		"Exclude automation-owned system beads from ordinary queries: " +
			"br search/list/ready use --exclude-label system; BV uses bv --recipe work --robot-triage.",
		"Inspect, claim available work, perform it, verify acceptance and close with evidence. " +
			"Preserve other assignees and human/HITL reservations.",
		"At pickup, read ancestor descriptions through the top-level task: " +
			"follow br dep list TASK --type parent-child --json, repeating with depends_on_id until empty; " +
			"then fetch known ancestors with br list --all --deferred --exclude-label system --id PARENT --id ANCESTOR " +
			"--format csv --fields id,title,description (repeat --id as needed). " +
			"Parent-child links carry scope; blocking dependencies carry prerequisites. " +
			"Child descriptions add narrower scope rather than repeating parent prose.",
		"Publish tracker changes at repository-defined checkpoints; code pushes require separate authorization.",
		"On tracker alerts or sync failure, pause Beads work and merges; read beeswax skills get tracker-recovery.",
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
		commands: hiveTools
			.filter((tool) => commandAvailable(tool.name))
			.map((tool) => `${tool.name} changelog${selector}`),
	};
}

// --- Private functions ---

function collect(value: string, previous: string[]): string[] {
	return [...previous, value];
}
