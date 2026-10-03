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

interface SyncStatusOutput {
	/** Unvalidated CLI field indicating a changed canonical JSONL generation. */
	readonly jsonl_newer: unknown;
}

const assertTrackerReady = async (root: string): Promise<void> => {
	await $`git -C ${root} fetch origin`;
	const head = await $`git -C ${root} rev-parse HEAD`.text();
	const accepted = await $`git -C ${root} rev-parse origin/main`.text();
	if (head.trim() !== accepted.trim()) {
		throw new Error("Stopped: synchronize canonical main with origin before selecting work.");
	}
	const status: SyncStatusOutput = await $`br sync --status --json`.json();
	if (typeof status.jsonl_newer !== "boolean") {
		throw new TypeError("Stopped: br did not return a boolean jsonl_newer status.");
	}
	if (status.jsonl_newer) {
		throw new Error(
			"Stopped: reconcile received tracker state and publish it before selecting work.",
		);
	}
};

const EXIT_SUCCESS = 0;
const agents = new Map([
	// ["opus", { args: ["--dangerously-skip-permissions", "--model", "opus"], cli: "claude" }],
	["lead", { args: ["--model", "openai-codex/gpt-6-astra:xhigh"], cli: "pi" }],
	["worker", { args: ["--model", "openai-codex/gpt-6.1-sol:xhigh"], cli: "pi" }],
	// ["lead", { args: ["--model", "deepseek/deepseek-flash", "--thinking", "max"], cli: "pi" }],
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
	const rootOutput = await $`honeycomb root`.text();
	const canonicalRoot = rootOutput.trim();
	process.env.BEADS_DB = `${canonicalRoot}/.beads/beads.db`;
	$.env(process.env);
	let recipe = "work";
	if (values.system) {
		recipe = "system";
	}
	// Each agent must finish before querying the next ready bead.
	/* eslint-disable no-await-in-loop */
	while (true) {
		await assertTrackerReady(canonicalRoot);
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
Receive and reconcile accepted remote tracker state before reading claims. Inspect this bead and its reserved scope, then claim it with your actor and owner ct.
Publish the claim from canonical main with an explicit flush, tracker-only commit and successful push before implementation. Respect already-published competing reservations.
Implement the task and run the required checks and tests. Close it only when all acceptance criteria are satisfied; criteria requiring landing remain open until the post-landing publication.
If blocked or awaiting landing, record the next action on the bead and stop without closing it. Do not land without explicit user authorization. Routine progress stays in SQLite between publication checkpoints.
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
		await assertTrackerReady(canonicalRoot);
		const [finished]: Bead[] = await $`br show ${bead.id} --json`.json();
		if (finished?.status !== "closed") {
			console.log(`Stopped: ${bead.id} still needs completion or landing; see its notes.`);
			break;
		}
	}
	/* eslint-enable no-await-in-loop */
}
