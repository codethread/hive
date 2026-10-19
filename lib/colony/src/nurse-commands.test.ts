import { colonyEntry, entryCommand } from "./executables.ts";
import { expect, test } from "bun:test";
import { nurseCommands } from "./nurse-commands.ts";

const FIRST = 0;
const repository = { root: "/repository", beadsDb: "/selected/tracker.db" };
const endpoint = [
	"--repo",
	repository.root,
	"--cwd",
	repository.root,
	"--beads-db",
	repository.beadsDb,
	"--actor",
	"sys-colony",
	"--model",
	"gpt-6.1-sol",
	"--effort",
	"high",
];

const calls: { argv: string[]; cwd: string }[] = [];
let input = "";
const submission = nurseCommands({
	writeInput: (token, body) => {
		input = body;
		return Promise.resolve(`/private/${token}.json`);
	},
	execute: (argv, cwd) => {
		calls.push({ argv, cwd });
		return Promise.resolve(
			JSON.stringify({ ok: true, request: { id: "request" }, workflow: { runId: "run" } }),
		);
	},
});
test("nurse submission preserves the selected endpoint, public workflow and fixed recipe", async () => {
	const result = await submission.start({
		parent: "audit",
		kind: "nurse",
		token: "batch",
		request: "Frozen reports",
		repository,
	});
	expect(result).toEqual({ runId: "run", requestId: "request" });
	expect(JSON.parse(input).request).toBe("Frozen reports");
	expect(calls[FIRST]).toEqual({
		cwd: repository.root,
		argv: [
			...entryCommand(colonyEntry("bee")),
			"--json",
			"spawn",
			"nurse",
			...endpoint,
			"--parent",
			"audit",
			"--input-file",
			"/private/batch.json",
			"--workflow",
			"do-work",
		],
	});
});

test("orphan attachment uses the saved run and selected tracker without starting another workflow", async () => {
	let invoked: string[] = [];
	const commands = nurseCommands({
		writeInput: () => {
			throw new Error("No new workflow input");
		},
		execute: (argv) => {
			invoked = argv;
			return Promise.resolve(
				JSON.stringify({ ok: true, request: { id: "request" }, workflow: { runId: "saved-run" } }),
			);
		},
	});
	await commands.attach({ runId: "saved-run", kind: "nurse", repository });
	expect(invoked).toEqual([
		...entryCommand(colonyEntry("bee")),
		"--json",
		"attach-workflow",
		"nurse",
		"saved-run",
		...endpoint,
	]);
});

test("coverage completion reads the saved workflow through its explicit public endpoint", async () => {
	let invoked = { argv: [] as string[], cwd: "" };
	const commands = nurseCommands({
		writeInput: () => {
			throw new Error("Read only");
		},
		execute: (argv, cwd) => {
			invoked = { argv, cwd };
			return Promise.resolve(
				JSON.stringify({
					ok: true,
					kind: "workflow_lifecycle",
					runId: "run",
					nativeStatus: "closed",
					updatedAt: "sampled",
					publication: {
						checkpoint: "checkpoint",
						savedAt: "sampled",
						locked: false,
						settlement: "none",
					},
					lifecycle: {
						kind: "terminal",
						closedAt: "sampled",
						fact: {
							kind: "busybee-lifecycle",
							formatVersion: 1,
							scope: "run",
							runId: "run",
							outcome: "succeeded",
							reason: "Completed",
						},
					},
					resolution: { kind: "resolved" },
				}),
			);
		},
	});
	expect(await commands.inspect("run", repository)).toMatchObject({
		kind: "terminal",
		fact: { outcome: "succeeded" },
	});
	expect(invoked).toEqual({
		cwd: repository.root,
		argv: [
			"busybee",
			"inspect",
			"run",
			"--repo",
			repository.root,
			"--db",
			repository.beadsDb,
			"--json",
		],
	});
});
