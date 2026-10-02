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

interface Pick {
	/** Recommended bead, omitted when nothing is actionable. */
	readonly id?: string;
	/** Whether bv proved the pick claimable now. */
	readonly actionable: boolean;
	/** Proof from bv that the tracker it loaded is complete enough to claim from. */
	readonly source_authority: { readonly claim_safe: boolean };
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
		system: { default: false, type: "boolean" },
	},
});

if (values.help) {
	console.log("Usage: bun scripts/beads-loop.ts [--agent worker|lead] [--system]");
	console.log("Picks with bv's work recipe, or its system recipe with --system.");
	console.log("hitl-labeled beads are never picked; they are worked with the user.");
} else {
	let recipe = "work";
	if (values.system) {
		recipe = "system";
	}
	// Each agent must finish before querying the next ready bead.
	/* eslint-disable no-await-in-loop */
	while (true) {
		const pick: Pick =
			await $`bv --recipe ${recipe} --robot-next --robot-not-ready-labels hitl`.json();
		if (!pick.source_authority.claim_safe) {
			throw new Error("Stopped: bv reports the tracker is not safe to claim from.");
		}
		if (!pick.actionable || pick.id === undefined) {
			console.log("No ready beads.");
			break;
		}
		// Labels route the bead to a runner, and bv omits them.
		const [bead]: Bead[] = await $`br show ${pick.id} --json`.json();
		if (!bead) {
			throw new Error(`Stopped: br could not show ${pick.id}.`);
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
