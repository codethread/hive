import {
	commandSchemas,
	inputSchema,
	machine,
	resumeSchema,
	runBrief,
	validateCommand,
} from "../../../../.workflows/do-feature-task/workflow.ts";
import { createMachine, initialTransition, transition } from "xstate";
import { expect, test } from "bun:test";
import { metadataSchema, renderTask } from "../../src/definition.ts";
import { navigate, recordResult, start } from "../../src/runtime.ts";
import type { SnapshotFrom } from "xstate";
import { createMemoryBeads } from "@hive/beads";
import { createServices } from "../../src/native.ts";
import manifest from "../../../../.workflows/do-feature-task/busybee.toml" with { type: "text" };

// These values simulate transport only; no test obtains real review or mutates Git.
/* eslint-disable unicorn/no-null */
const FIRST = 0;
const AFTER_ISOLATION = 1;
const OID_LENGTH = 40;
const baseOid = "a".repeat(OID_LENGTH);
const sourceOid = "b".repeat(OID_LENGTH);
const treeOid = "c".repeat(OID_LENGTH);
const staleOid = "d".repeat(OID_LENGTH);
const evidence = "SIMULATED proof: no real check, review, integration, cleanup or source closure.";
const observation = { evidence };
const interrupted = { kind: "interrupted", evidence } as const;
const revision = { baseOid, headOid: baseOid, treeOid };
const candidate = { baseOid, sourceOid, candidateOid: sourceOid, treeOid };
const input = inputSchema.parse({
	feature: { id: "feature", brief: "Original feature goal and accepted seams." },
	source: {
		id: "source",
		parentId: "feature",
		brief: "Original source task acceptance and reservations.",
	},
	beadsDb: "/selected/beads.db",
	canonicalRoot: "/canonical",
	base: { path: "/feature", branch: "feat/example" },
	isolation: { path: "/task", branch: "task/example" },
	authority: {
		request: "SIMULATED explicit local delivery authority",
		localCommit: true,
		featureIntegration: true,
		sourceClosure: true,
	},
	previousDeliveries: [
		{
			taskId: "earlier",
			requestId: "earlier-request",
			responseId: "earlier-response",
			summary: "Previously delivered seam",
			candidate,
		},
	],
});
const choices = [
	"isolated",
	"implemented",
	"prose-requested",
	"prose-approved",
	"passed",
	"review-requested",
	"approved",
	"committed",
	"architect-requested",
	"approved",
	"cleaned",
	"reported",
] as const;
type Choice = keyof typeof commandSchemas;
type Snapshot = SnapshotFrom<typeof machine>;
type Event = Parameters<typeof machine.transition>[typeof AFTER_ISOLATION];
const [initial] = initialTransition(machine, input);
const frontiers = trace(initial, choices);
const architectResult = frontiers["architect-result"]!;
const approval = result(architectResult, "approved");
const integrated = advance(frontiers.integrate!, "integrated");
const cleaned = advance(integrated, "cleaned");
resumeSchema.parse(frontiers.done!.context);
const receiptMismatches = [
	{ name: "feature", patch: { featureId: "other-feature" } },
	{ name: "task", patch: { taskId: "other-task" } },
	{ name: "request", patch: { requestId: "other-request" } },
	{ name: "identity", patch: { identity: "other-specialist" } },
	{ name: "role", patch: { kind: "reviewer" } },
	{ name: "mode", patch: { mode: "unblock" } },
	{ name: "outcome", patch: { outcome: "follow-up" } },
	{ name: "blocker", patch: { blockerId: "unrelated-blocker" } },
	{ name: "base", patch: { candidate: { ...candidate, baseOid: staleOid } } },
	{ name: "source", patch: { candidate: { ...candidate, sourceOid: staleOid } } },
	{ name: "combined candidate", patch: { candidate: { ...candidate, candidateOid: staleOid } } },
	{ name: "tree", patch: { candidate: { ...candidate, treeOid: staleOid } } },
	{ name: "unavailable candidate", patch: { candidate: null } },
	{
		name: "reused response",
		patch: { responseId: architectResult.context.receipts[FIRST]!.responseId },
	},
];

// Verify the ordered public frontier and its retained briefs as one contract.
test(
	"the public feature-task chart orders isolation, full quality, exact Architect review and delivery",
	// eslint-disable-next-line max-statements
	() => {
		expect(Bun.TOML.parse(manifest)).toMatchObject({ version: "0.1.0", run: "./workflow.ts" });
		expect(frontiers.done!.status).toBe("done");
		expect(Object.keys(frontiers)).toEqual([
			"prepare",
			"implement",
			"prose",
			"prose-result",
			"check",
			"review",
			"review-result",
			"commit",
			"architect",
			"architect-result",
			"integrate",
			"report",
			"done",
		]);
		for (const snapshot of Object.values(frontiers)) {
			expect(resumeSchema.safeParse(snapshot.context).success).toBe(true);
			if (snapshot.status === "active") {
				const brief = task(snapshot);
				expect(brief.instructions).toContain(input.source.brief);
				expect(brief.instructions).toContain(input.feature.brief);
				expect(brief.instructions).toContain("earlier-response");
				expect(brief.commands).toHaveProperty("suspected-blocker");
			}
		}
		expect(task(frontiers.check!).instructions).toContain("COMPLETE bun run check through qlock");
		expect(task(frontiers.review!).instructions).toContain("Only after full checks pass");
		expect(task(frontiers.architect!).instructions).toContain("without publishing the candidate");
	},
);

test.each(receiptMismatches)("Architect rejects a mismatched $name receipt", ({ patch }) => {
	const data = commandSchemas.approved.parse(approval);
	expect(() =>
		advance(architectResult, "approved", { ...data, receipt: { ...data.receipt, ...patch } }),
	).toThrow(Error);
});

test("quality and commit gates reject changed trees and self review", () => {
	expect(() =>
		advance(frontiers.check!, "passed", {
			...result(frontiers.check!, "passed"),
			revision: { ...revision, treeOid: staleOid },
		}),
	).toThrow(Error);
	expect(() =>
		advance(frontiers.commit!, "committed", {
			...observation,
			checkedHeadOid: baseOid,
			candidate: { ...candidate, treeOid: staleOid },
		}),
	).toThrow(Error);
	expect(() =>
		advance(frontiers.review!, "review-requested", {
			...observation,
			requestId: "self-review",
			identity: "task-bee",
		}),
	).toThrow(Error);
	expect(() =>
		advance(frontiers.architect!, "architect-requested", {
			...observation,
			requestId: "same-reviewer",
			identity: "reviewer-bee",
		}),
	).toThrow(Error);
});

test("isolation binds the regular checkout and newly observed blocker revisions before consultation", () => {
	const isolation = commandSchemas.isolated.parse(result(initial, "isolated"));
	expect(() =>
		advance(initial, "isolated", {
			...isolation,
			worktree: { ...isolation.worktree, path: "/other-task" },
		}),
	).toThrow(Error);
	const repairing = frontiers.implement!;
	const suspected = advance(repairing, "suspected-blocker", {
		...observation,
		blockerId: "inspected-blocker",
		revision,
	});
	const consultation = advance(suspected, "unblock-requested");
	expect(consultation.context.consultation).toMatchObject({
		revision,
		blockerId: "inspected-blocker",
	});
	const beforeIsolation = advance(advance(initial, "suspected-blocker"), "unblock-requested");
	expect(advance(beforeIsolation, "follow-up").value).toBe("prepare");
});

test.each([
	{ name: "check repair", state: "check", choice: "changes" },
	{ name: "detailed findings", state: "review-result", choice: "follow-up" },
	{ name: "commit content change", state: "commit", choice: "changes" },
	{ name: "Architect follow-up", state: "architect-result", choice: "follow-up" },
	{ name: "stale feature base", state: "integrate", choice: "stale" },
] as const)(
	"$name invalidates quality and restarts prose with prior deliveries retained",
	({ state, choice }) => {
		const repair = advance(frontiers[state]!, choice);
		expect(repair.value).toBe("implement");
		expect(repair.context).toMatchObject({ revision: null, candidate: null, consultation: null });
		expect(repair.context.previousDeliveries).toEqual(input.previousDeliveries);
		expect(advance(repair, "implemented").value).toBe("prose");
	},
);

test.each(["terminal-blocker", "critical-decision"] as const)(
	"Architect %s retains an unfinished hold and new evidence requires renewed unblock direction",
	(choice) => {
		const hold = advance(architectResult, choice);
		expect(hold).toMatchObject({ status: "active", value: "hold" });
		const unblock = advance(hold, "new-evidence");
		expect(unblock.value).toBe("unblock");
		const direction = advance(unblock, "unblock-requested");
		expect(task(direction).commands).not.toHaveProperty("approved");
		const repair = advance(direction, "follow-up");
		expect(repair.value).toBe("implement");
		expect(task(repair).instructions).toContain("routine repairs preserve assignment");
	},
);

test.each(["prose-result", "review-result", "architect-result"])(
	"missing %s delivery recovers the same consultation and grants no verdict",
	(state) => {
		const recovery = advance(frontiers[state]!, "unavailable");
		expect(recovery).toMatchObject({ status: "active", value: "consultation-recovery" });
		expect(task(recovery).commands).not.toHaveProperty("terminal-blocker");
		const retry = advance(recovery, "available");
		expect(retry.context.receipts).toEqual(frontiers[state]!.context.receipts);
		expect(String(retry.value)).toBe(state);
	},
);

test("a late original report and an explicit replacement resume results without duplicate submission", () => {
	const recovery = advance(architectResult, "unavailable");
	const original = advance(recovery, "available");
	expect(original.context.consultation).toEqual(architectResult.context.consultation);
	expect(advance(original, "approved").value).toBe("integrate");
	const replacement = advance(recovery, "replacement", {
		...observation,
		previousRequestId: recovery.context.consultation!.requestId,
		requestId: "actual-replacement-request",
		identity: "replacement-architect",
	});
	expect(replacement.value).toBe("architect-result");
	expect(replacement.context.requests).toHaveLength(
		recovery.context.requests.length + AFTER_ISOLATION,
	);
	expect(() => advance(replacement, "approved", approval)).toThrow(Error);
	expect(advance(replacement, "approved").value).toBe("integrate");
});

test("native observations require recorded uncertainty before normal delivery can succeed", () => {
	const frontier = frontiers.integrate!;
	const proof = nativeObservation(frontier.context, interrupted);
	expect(() => {
		advance(frontier, "integrated", { ...observation, integration: proof });
	}).toThrow(Error);
	expect(() => {
		advance(frontier, "cleaned", {
			...observation,
			integration: integrationReceipt(frontier.context),
			cleanup: { ...proof, worktreeAbsent: true, branchAbsent: true, targetUnchanged: true },
		});
	}).toThrow(Error);
});

test("native integration and cleanup observations bind the recorded interruption", () => {
	const uncertain = advance(frontiers.integrate!, "uncertain");
	const detached = { kind: "interrupted", evidence: "SIMULATED unrelated interruption" };
	const proof = nativeObservation(uncertain.context, detached);
	expect(() => {
		advance(uncertain, "integrated", { ...observation, integration: proof });
	}).toThrow(Error);
	expect(() => {
		advance(uncertain, "cleaned", {
			...observation,
			integration: nativeObservation(uncertain.context, interrupted),
			cleanup: { ...proof, worktreeAbsent: true, branchAbsent: true, targetUnchanged: true },
		});
	}).toThrow(Error);
});

test("an interrupted integration blocker records the origin used by directed reconciliation", () => {
	const unblock = advance(advance(frontiers.integrate!, "suspected-blocker"), "unblock-requested");
	const directed = advance(unblock, "follow-up");
	expect(directed.context.origins).toEqual([interrupted]);
	const recovered = advance(directed, "integrated", {
		...observation,
		integration: nativeObservation(directed.context, interrupted),
	});
	expect(recovered.value).toBe("cleanup");
});

test("a prior attempt's uncertainty cannot authorize proof after quality restarts", () => {
	const previous = advance(frontiers.integrate!, "uncertain");
	const repair = advance(previous, "not-integrated");
	const renewed = trace(repair, choices.slice(AFTER_ISOLATION)).integrate!;
	const currentOrigin = { kind: "interrupted", evidence: "SIMULATED current attempt" };
	const uncertain = advance(renewed, "uncertain", { ...observation, origin: currentOrigin });
	expect(() => {
		advance(uncertain, "integrated", {
			...observation,
			integration: nativeObservation(uncertain.context, interrupted),
		});
	}).toThrow(Error);
	expect(previous.context.origins).toEqual([interrupted]);
	expect(
		advance(uncertain, "integrated", {
			...observation,
			integration: nativeObservation(uncertain.context, currentOrigin),
		}).value,
	).toBe("cleanup");
});

test("native reconciliation retains failed cleanup evidence without inventing a successful tool receipt", () => {
	const origin = {
		kind: "failed-command",
		receipt: {
			ok: false,
			kind: "error",
			reason: "git_failed",
			message: evidence,
			cleanup_actions: ["remove_worktree"],
			integration_attempted: true,
			integrated: true,
		},
	};
	const uncertain = advance(frontiers.integrate!, "uncertain", { ...observation, origin });
	const proof = nativeObservation(uncertain.context, origin);
	const cleanup = advance(uncertain, "integrated", { ...observation, integration: proof });
	expect(cleanup.context.origins).toMatchObject([origin]);
	const completed = advance(cleanup, "cleaned", {
		...observation,
		integration: proof,
		cleanup: { ...proof, worktreeAbsent: true, branchAbsent: true, targetUnchanged: true },
	});
	expect(completed.context.delivery).toMatchObject({
		kind: "cleaned",
		integration: { kind: "native-observation" },
	});
	expect(() =>
		advance(uncertain, "integrated", {
			...observation,
			integration: { ...proof, candidate: { ...candidate, sourceOid: staleOid } },
		}),
	).toThrow(Error);
});

// Preserve original integrated proof while a registered corrective child satisfies new direction.
test(
	"post-integration corrective direction cannot be lost or reported before its exact child delivery",
	// eslint-disable-next-line max-statements
	() => {
		const unblock = advance(advance(cleaned, "suspected-blocker"), "unblock-requested");
		const followed = advance(unblock, "follow-up", {
			...result(unblock, "follow-up"),
			work: "corrective-work",
		});
		const direction = advance(followed, "cleaned");
		expect(direction.value).toBe("direction");
		expect(direction.context.delivery).toEqual(cleaned.context.delivery);
		expect(() =>
			validateCommand(
				{ context: { ...direction.context } },
				"reported",
				commandSchemas.reported.parse(result(direction, "reported")),
			),
		).toThrow(Error);
		const directionResponseId = direction.context.directions[FIRST]!.receipt.responseId;
		const resolution = {
			kind: "corrective-work",
			taskId: "correction-task",
			runId: "correction-run",
			responseId: "correction-response",
			candidate,
		};
		expect(() =>
			advance(direction, "resolved-direction", { ...observation, directionResponseId, resolution }),
		).toThrow(Error);
		const registered = advance(direction, "register-correction", {
			...observation,
			directionResponseId,
			taskId: "correction-task",
			runId: "correction-run",
		});
		expect(() =>
			advance(registered, "resolved-direction", {
				...observation,
				directionResponseId,
				resolution: { ...resolution, runId: "wrong-child" },
			}),
		).toThrow(Error);
		const reported = advance(registered, "resolved-direction", {
			...observation,
			directionResponseId,
			resolution,
		});
		expect(reported.value).toBe("report");
		expect(reported.context.delivery).toEqual(cleaned.context.delivery);
		expect(advance(reported, "reported").status).toBe("done");
	},
);

test("every mutable frontier routes suspected blockers through direction, preserving integration effects", () => {
	for (const snapshot of [...Object.values(frontiers), integrated, cleaned]) {
		if (snapshot.status === "active") {
			const unblock = advance(snapshot, "suspected-blocker");
			expect(unblock.value).toBe("unblock");
			const directed = advance(advance(unblock, "unblock-requested"), "follow-up");
			if (
				snapshot.context.delivery.kind === "cleaned" ||
				snapshot.context.delivery.kind === "integrated"
			) {
				expect(directed.value).toBe("reconcile");
				expect(directed.context.delivery).toEqual(snapshot.context.delivery);
			}
			if (snapshot.value === "integrate") {
				expect(directed).toMatchObject({
					value: "reconcile",
					context: { delivery: { kind: "uncertain" } },
				});
			}
		}
	}
});

// Keep uncertain, integrated and cleaned observations in one recovery lifecycle.
test(
	"partial effects never replay confirmed integration or erase completed cleanup",
	// eslint-disable-next-line max-statements
	() => {
		const uncertain = advance(frontiers.integrate!, "uncertain");
		expect(advance(uncertain, "not-integrated").value).toBe("implement");
		const cleanup = advance(uncertain, "integrated");
		expect(cleanup.value).toBe("cleanup");
		const observed = advance(cleanup, "uncertain");
		expect(() => advance(observed, "not-integrated")).toThrow(Error);
		expect(advance(observed, "cleaned").value).toBe("report");
		const postCleanup = advance(
			advance(advance(cleaned, "suspected-blocker"), "unblock-requested"),
			"follow-up",
		);
		expect(() => advance(postCleanup, "integrated")).toThrow(Error);
		expect(() => advance(postCleanup, "not-integrated")).toThrow(Error);
		expect(advance(postCleanup, "cleaned").context.delivery.kind).toBe("cleaned");
	},
);

test.each([
	{ name: "destination branch", patch: { target_branch: "main" } },
	{ name: "destination worktree", patch: { target_worktree_path: "/canonical" } },
	{ name: "source", patch: { source_oid: staleOid } },
	{ name: "base", patch: { target_before_oid: staleOid } },
	{ name: "integrated head", patch: { target_after_oid: staleOid } },
])("public integration proof rejects mismatched $name", ({ patch }) => {
	const data = commandSchemas.integrated.parse(result(frontiers.integrate!, "integrated"));
	if (data.integration.kind !== "command-receipt") {
		throw new Error("Expected simulated command receipt");
	}
	const { integration } = data;
	expect(() =>
		advance(frontiers.integrate!, "integrated", {
			...data,
			integration: { ...integration, receipt: { ...integration.receipt, ...patch } },
		}),
	).toThrow(Error);
});

test("rendered integration and cleanup instructions use the frozen commands from a surviving checkout", () => {
	const integration = task(frontiers.integrate!).instructions;
	for (const instruction of [
		"qlock exec --merge-target BASE_BRANCH",
		"honeycomb --cwd TASK_PATH integrate --into BASE_BRANCH",
		"--expected-target BASE_OID",
		"--expected-source SOURCE_OID",
		"remove --self --integrated-into-local",
		"--expected-target OBSERVED_TARGET_OID",
		"--repo CANONICAL_ROOT",
		"Never blindly replay",
	]) {
		expect(integration).toContain(instruction);
	}
	expect(task(integrated).instructions).toContain("No integration replay");
	expect(task(frontiers.prepare!).instructions).toContain("--no-network --skip-command");
	expect(task(frontiers.prepare!).instructions).toContain("Claim the source");
	expect(task(frontiers.prepare!).instructions).toContain("Never allocate a pooled slot");
});

test(
	"Busy Bee finishes its run before explicit caller source closure releases native dependents",
	// eslint-disable-next-line max-statements
	async () => {
		const { beads, scope, io, run, source, dependent, stage } = await runtimeFixture();
		expect(await beads.show(scope, source.id)).toMatchObject({
			status: "open",
			assignee: "simulated-driver",
		});
		expect(await beads.ready(scope)).not.toContainEqual(
			expect.objectContaining({ id: dependent.id }),
		);
		await beads.close(scope, stage);
		const done = await navigate({ id: run.id, operation: "collect" }, {}, io);
		expect(done).toMatchObject({ status: "done", active: [] });
		expect(await beads.show(scope, source.id)).toMatchObject({
			status: "open",
			assignee: "simulated-driver",
		});
		expect(await beads.ready(scope)).not.toContainEqual(
			expect.objectContaining({ id: dependent.id }),
		);
		// Simulate ONLY the separately authorized caller tail; chart actions never close the source.
		await beads.close(scope, source.id, { reason: evidence });
		expect(await beads.ready(scope)).toContainEqual(expect.objectContaining({ id: dependent.id }));
	},
);

test("the run retains source closure authority and preserves failed post-done handoff", () => {
	const brief = runBrief(input);
	for (const retained of [
		"SAME task driver",
		"Busy Bee must report done",
		"source open",
		"Keep the completed run done",
		"native closure permits it",
		"ct/HITL reservations and pending children",
		input.beadsDb,
		input.base.path,
		input.canonicalRoot,
		"No tracker publication is authorized",
	]) {
		expect(brief.description).toContain(retained);
	}
	expect(task(frontiers.report!).instructions).toContain("Source task stays OPEN");
	expect(advance(advance(initial, "waiting"), "recheck").value).toBe("prepare");
	expect(() =>
		advance(initial, "isolated", { ...result(initial, "isolated"), runParent: "feature" }),
	).toThrow(Error);
});

function task(snapshot: Snapshot) {
	const metadata = metadataSchema.parse(Object.values(snapshot.getMeta())[FIRST]);
	return renderTask(metadata, { ...snapshot.context });
}

function advance(snapshot: Snapshot, choice: Choice, data = result(snapshot, choice)): Snapshot {
	expect(task(snapshot).commands).toHaveProperty(choice);
	const parsed = commandSchemas[choice].parse(data);
	validateCommand({ context: { ...snapshot.context } }, choice, parsed);
	const [next, effects] = transition(machine, snapshot, { type: choice, data: parsed } as Event);
	expect(effects).toEqual([]);
	return next;
}

function trace(snapshot: Snapshot, steps: readonly Choice[]): Record<string, Snapshot> {
	const snapshots: Record<string, Snapshot> = { [String(snapshot.value)]: snapshot };
	for (const choice of steps) {
		snapshot = advance(snapshot, choice);
		snapshots[String(snapshot.value)] = snapshot;
	}
	return snapshots;
}

// Fixture outcomes mirror the finite public schemas; no external operations run.
// eslint-disable-next-line max-statements
function result(snapshot: Pick<Snapshot, "context">, choice: Choice): Record<string, unknown> {
	const { context } = snapshot;
	switch (choice) {
		case "isolated": {
			return {
				...observation,
				identity: "task-bee",
				beadsDb: context.beadsDb,
				sourceParent: context.source.parentId,
				runParent: context.source.id,
				nativeReady: true,
				worktree: {
					kind: "regular",
					...context.isolation,
					basePath: context.base.path,
					baseBranch: context.base.branch,
				},
				revision,
			};
		}
		case "implemented": {
			return { ...observation, revision, focusedTests: ["SIMULATED focused test result"] };
		}
		case "prose-requested": {
			return {
				...observation,
				requestId: `prose-${context.requests.length}`,
				identity: "bookworm-bee",
			};
		}
		case "review-requested": {
			return {
				...observation,
				requestId: `review-${context.requests.length}`,
				identity: "reviewer-bee",
			};
		}
		case "architect-requested":
		case "unblock-requested": {
			return {
				...observation,
				requestId: `architect-${context.requests.length}`,
				identity: "architect-bee",
			};
		}
		case "prose-approved": {
			return { ...verdict(snapshot, "approved"), revision };
		}
		case "approved":
		case "terminal-blocker":
		case "critical-decision": {
			return verdict(snapshot, choice);
		}
		case "follow-up": {
			let work = "repair";
			if (context.delivery.kind !== "unstarted") {
				work = "recovery";
			}
			return { ...verdict(snapshot, choice), work };
		}
		case "available": {
			return { ...observation, requestId: context.consultation!.requestId };
		}
		case "uncertain": {
			return { ...observation, origin: interrupted };
		}
		case "passed": {
			return {
				...observation,
				revision,
				command: "bun run check",
				lock: "/tmp/agent-cpu.lock",
				exitCode: 0,
			};
		}
		case "committed": {
			return { ...observation, checkedHeadOid: baseOid, candidate };
		}
		case "unavailable": {
			return { ...observation, recovery: "SIMULATED repair consultation infrastructure" };
		}
		case "suspected-blocker": {
			return {
				...observation,
				blockerId: "suspected-implementation-blocker",
				revision: context.revision,
			};
		}
		case "integrated": {
			return { ...observation, integration: integrationReceipt(context) };
		}
		case "cleaned": {
			return {
				...observation,
				integration: integrationReceipt(context),
				cleanup: cleanupReceipt(context),
			};
		}
		case "reported": {
			return { ...observation, responseId: "SIMULATED verified run response" };
		}
		default: {
			return observation;
		}
	}
}

function verdict(snapshot: Pick<Snapshot, "context">, outcome: string) {
	return {
		...observation,
		direction: "SIMULATED bounded direction and verification limits",
		receipt: {
			...snapshot.context.consultation!,
			featureId: snapshot.context.feature.id,
			taskId: snapshot.context.source.id,
			responseId: `${snapshot.context.consultation!.requestId}-response`,
			outcome,
		},
	};
}

function deliveryIdentity(context: Snapshot["context"]) {
	return {
		ok: true,
		kind: "ready",
		root: context.canonicalRoot,
		worktree_path: context.isolation.path,
		source_branch: context.isolation.branch,
		target_branch: context.base.branch,
		target_worktree_path: context.base.path,
		source_oid: sourceOid,
		target_before_oid: baseOid,
		target_after_oid: sourceOid,
		diagnostics: [],
		setup_output: [],
	};
}

function integrationReceipt(context: Snapshot["context"]) {
	return {
		kind: "command-receipt",
		receipt: {
			...deliveryIdentity(context),
			strategy: "ff_only",
			integrated: true,
			cleanup_actions: [],
		},
	};
}
function cleanupReceipt(context: Snapshot["context"]) {
	return {
		kind: "command-receipt",
		receipt: {
			...deliveryIdentity(context),
			target_before_oid: sourceOid,
			removed: true,
			containment: "git_ancestry",
			cleanup_actions: ["remove_worktree", "delete_branch"],
		},
	};
}

function nativeObservation(context: Snapshot["context"], origin: unknown) {
	return {
		kind: "native-observation",
		identity: deliveryIdentity(context),
		candidate,
		targetOid: staleOid,
		sourceContained: true,
		evidence,
		origin,
	};
}

// Own the memory graph, injected runtime and traversal together.
// eslint-disable-next-line max-statements
async function runtimeFixture() {
	const beads = createMemoryBeads({ db: input.beadsDb });
	const scope = { cwd: input.base.path, db: input.beadsDb, actor: "simulated-driver" };
	const feature = await beads.create(scope, { title: "Feature", type: "feature", owner: "ct" });
	const source = await beads.create(scope, {
		title: "Source",
		type: "task",
		owner: "ct",
		parent: feature.id,
		assignee: scope.actor,
	});
	const prerequisite = await beads.create(scope, {
		title: "Prerequisite",
		type: "task",
		owner: "ct",
	});
	await beads.dep.add(scope, source.id, prerequisite.id, "blocks");
	const dependent = await beads.create(scope, {
		title: "Dependent",
		type: "task",
		owner: "ct",
		parent: feature.id,
	});
	await beads.dep.add(scope, dependent.id, source.id, "blocks");
	const fixtureInput = {
		...input,
		feature: { ...input.feature, id: feature.id },
		source: { ...input.source, id: source.id, parentId: feature.id },
	};
	// Enter the real final reporting visit with proof from the complete pure traversal above.
	const reporting = createMachine(
		{
			...machine.config,
			initial: "report",
			context: { ...frontiers.report!.context, ...fixtureInput },
		},
		{ actions: machine.implementations.actions, guards: machine.implementations.guards },
	);
	const io = {
		...createServices(),
		actor: scope.actor,
		beads,
		cwd: scope.cwd,
		importModule: () =>
			Promise.resolve({
				commandSchemas,
				inputSchema,
				machine: reporting,
				resumeSchema,
				runBrief,
				validateCommand,
			}),
		readText: () => Promise.resolve(JSON.stringify(fixtureInput)),
		readBytes: () => Promise.resolve(new ArrayBuffer(FIRST)),
		execute: () => Promise.reject(new Error("Feature-task test must never execute processes")),
	};
	const run = await start(
		"workflow.ts",
		{ owner: "ct", parent: source.id, inputFile: "input.json" },
		io,
	);
	const sourceBefore = await beads.show(scope, source.id);
	expect(sourceBefore.dependencies).toContainEqual(
		expect.objectContaining({ id: prerequisite.id }),
	);
	await beads.close(scope, prerequisite.id);
	const stage = run.active[FIRST]!.bead;
	await recordResult(
		{ id: run.id, bead: stage, choice: "reported", data: result(frontiers.report!, "reported") },
		{},
		io,
	);
	return { beads, dependent, io, run, scope, source, stage };
}
