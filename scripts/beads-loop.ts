#!/usr/bin/env bun
import { $ } from "bun";
// eslint-disable-next-line import/no-nodejs-modules -- This is a Bun CLI script.
import { parseArgs } from "node:util";

interface Bead {
	/** Beads issue identifier. */
	readonly id: string;
	/** Human-readable task title. */
	readonly title: string;
	/** Current issue status. */
	readonly status: string;
	/** Routing and other labels, omitted by br when empty. */
	readonly labels?: readonly string[];
}

const EXIT_SUCCESS = 0;
const agents = new Map([
	["lead", { args: ["--dangerously-skip-permissions", "--model", "opus"], cli: "claude" }],
	["worker", { args: ["--model", "deepseek/deepseek-flash", "--thinking", "max"], cli: "pi" }],
]);
const { values } = parseArgs({
	options: {
		agent: { default: "worker", type: "string" },
		help: { short: "h", type: "boolean" },
	},
});

if (values.help) {
	console.log("Usage: bun scripts/beads-loop.ts [--agent worker|lead]");
} else {
	// Each agent must finish before querying the next ready bead.
	/* eslint-disable no-await-in-loop */
	while (true) {
		const [bead]: Bead[] = await $`br ready --json`.json();
		if (!bead) {
			console.log("No ready beads.");
			break;
		}
		const [label, extraLabel] = (bead.labels ?? []).filter((item) => item.startsWith("agent:"));
		if (extraLabel !== undefined) {
			throw new Error(`Multiple agent labels on ${bead.id}.`);
		}
		const name = label?.slice("agent:".length) ?? values.agent;
		const runner = agents.get(name);
		if (!runner) {
			throw new Error(`Unknown agent: ${name}`);
		}
		console.log(`Working on ${bead.id}: ${bead.title} [${name}]`);
		const prompt = `Work only on bead ${bead.id}. Follow the repository instructions.
Read it with \`br show ${bead.id}\`, then claim it with \`br update ${bead.id} --claim\`.
Implement the task and run the required checks and tests. Close it with \`br close ${bead.id}\` only when complete.
If blocked, record the blocker on the bead and stop without closing it. Finish with \`br sync --merge\`.
Do not pick up another bead.`;
		const child = Bun.spawn([runner.cli, ...runner.args, "-p", prompt], {
			stderr: "inherit",
			stdin: "inherit",
			stdout: "inherit",
		});
		const exitCode = await child.exited;
		if (exitCode !== EXIT_SUCCESS) {
			process.exitCode = exitCode;
			break;
		}
		const [finished]: Bead[] = await $`br show ${bead.id} --json`.json();
		if (finished?.status !== "closed") {
			throw new Error(`Stopped: ${bead.id} was not closed.`);
		}
	}
	/* eslint-enable no-await-in-loop */
}
