import type { Snapshot, SnapshotFrom } from "xstate";
import {
	commandSchemas,
	inputSchema,
	machine,
	resumeSchema,
	runBrief,
} from "../../../../.workflows/land/workflow.ts";
import { describe, expect, test } from "bun:test";
import {
	initialActor,
	metadataSchema,
	renderTask,
	restoredActor,
	snapshotFor,
} from "../../src/definition.ts";
import { initialTransition, transition } from "xstate";
import { createMemoryBeads } from "@hive/beads";
import { createServices } from "../../src/native.ts";
import { invoke } from "./support.ts";
import manifest from "../../../../.workflows/land/busybee.toml" with { type: "text" };

const FIRST = 0;
const EVENT_ARGUMENT = 1;
const input = inputSchema.parse({
	beadsDb: "/selected/beads.db",
	canonicalRoot: "/surviving",
	completedTasks: [],
	request: "SIMULATED chart checks; no real review or integration.",
	target: { kind: "worktree", branch: "simulated-work" },
});
const evidence = "SIMULATED review evidence";
const data = { evidence, revision: "1111111111111111111111111111111111111111" };
const [check] = initialTransition(machine, input);
const pendingLibrarian = advance(check, "passed");
const integratedLibrarian = advance(check, "integrated");
const reviewer = advance(pendingLibrarian, "approved");
const finish = advance(reviewer, "approved");
const verify = advance(advance(integratedLibrarian, "approved"), "approved");

// Persist the actual review frontiers: initialization must not erase integration proof on resume.
const definition = {
	commandSchemas,
	inputSchema,
	machine,
	resumeSchema,
	runBrief: (value: unknown) => runBrief(inputSchema.parse(value)),
};
const recovery = initialActor(definition, input);
recovery.send({ type: "INTEGRATED", data });
const savedLibrarian = snapshotFor(recovery);
recovery.send({ type: "APPROVED", data });
const savedReviewer = snapshotFor(recovery);
recovery.stop();

test.each([
	{ result: "passed", snapshot: pendingLibrarian, target: "finish", alreadyIntegrated: false },
	{
		result: "integrated",
		snapshot: integratedLibrarian,
		target: "verify",
		alreadyIntegrated: true,
	},
])(
	"Land $result requires both reviews before $target",
	({ snapshot, target, alreadyIntegrated }) => {
		expect(snapshot.value).toBe("librarian");
		expect(task(snapshot).bee).toEqual({ kind: "librarian" });
		expect(snapshot.context).toMatchObject({ alreadyIntegrated, evidence });
		const review = advance(snapshot, "approved");
		expect(review.value).toBe("review");
		expect(task(review).bee).toEqual({ kind: "reviewer" });
		expect(task(review).instructions).toContain(evidence);
		expect(advance(review, "approved").value).toBe(target);
	},
);

test.each([
	{ stage: "Librarian", snapshot: integratedLibrarian, result: "passed", target: "finish" },
	{ stage: "Librarian", snapshot: integratedLibrarian, result: "integrated", target: "verify" },
	{ stage: "Reviewer", snapshot: reviewer, result: "passed", target: "finish" },
	{ stage: "delivery", snapshot: finish, result: "passed", target: "finish" },
	{ stage: "verification", snapshot: verify, result: "passed", target: "finish" },
	{ stage: "verification", snapshot: verify, result: "integrated", target: "verify" },
] as const)(
	"Land $stage findings require fresh checks and both reviews after $result",
	({ snapshot, result, target }) => {
		const repair = advance(snapshot, "changes");
		expect(repair.value).toBe("check");
		expect(repair.context.evidence).toBe(evidence);
		const librarian = advance(repair, result);
		expect(librarian.value).toBe("librarian");
		expect(librarian.context.alreadyIntegrated).toBe(result === "integrated");
		const review = advance(librarian, "approved");
		expect(review.value).toBe("review");
		expect(advance(review, "approved").value).toBe(target);
	},
);

test.each([
	{ stage: "librarian", saved: savedLibrarian, approvals: ["APPROVED", "APPROVED"] },
	{ stage: "review", saved: savedReviewer, approvals: ["APPROVED"] },
])(
	"Land restores integrated $stage review without repeating integration",
	({ stage, saved, approvals }) => {
		// eslint-disable-next-line unicorn/prefer-structured-clone -- Exercise the JSON checkpoint boundary.
		const persisted = JSON.parse(JSON.stringify(saved)) as Snapshot<unknown>;
		const actor = restoredActor(definition, persisted);
		expect(actor.getSnapshot().value).toBe(stage);
		expect(resumeSchema.parse(actor.getSnapshot().context)).toMatchObject({
			alreadyIntegrated: true,
			evidence,
		});
		for (const type of approvals) {
			actor.send({ type, data });
		}
		expect(actor.getSnapshot().value).toBe("verify");
		actor.stop();
	},
);

describe("land definition loading", () => {
	test("a land run requires retained input before publishing any tasks #test-21", async () => {
		const repo = "/land-input";
		const beads = createMemoryBeads();
		const scope = { cwd: repo };
		const parent = await beads.create(
			{ ...scope, actor: "test-agent" },
			{ title: "Original work", owner: "test-human" },
		);
		const selection = { all: true, limit: 0 };
		const services = {
			...createServices(),
			actor: "test-agent",
			beads,
			cwd: repo,
			beforeWrite: () => {
				throw new Error("Invalid retained input must fail before publication");
			},
			execute: () => Promise.resolve(repo),
			importModule: () => Promise.resolve({ commandSchemas, inputSchema, machine, runBrief }),
			isFile: () => Promise.resolve(true),
			readBytes: () => Promise.resolve(new ArrayBuffer(FIRST)),
			readDirectory: () => Promise.resolve([{ kind: "file" as const, name: "workflow.ts" }]),
			readText: () => Promise.resolve(manifest),
		};
		const before = await beads.list(scope, selection);
		await expect(
			invoke(["--owner", "test-human", "--parent", parent.id, "run", "land"], services),
		).resolves.toMatchObject({ document: { ok: false, reason: "invalid_input" } });
		expect(await beads.list(scope, selection)).toEqual(before);
	});
});

// --- Private helpers ---

function advance(snapshot: SnapshotFrom<typeof machine>, choice: keyof typeof commandSchemas) {
	const event = {
		type: task(snapshot).commands![choice]!,
		data: commandSchemas[choice].parse(data),
	};
	const [next, effects] = transition(
		machine,
		snapshot,
		event as Parameters<typeof machine.transition>[typeof EVENT_ARGUMENT],
	);
	expect(effects).toEqual([]);
	return next;
}

function task(snapshot: SnapshotFrom<typeof machine>) {
	return renderTask(metadataSchema.parse(snapshot.getMeta()[`land.${snapshot.value}`]), {
		...snapshot.context,
	});
}
