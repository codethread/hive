import { activateNurse, isNurseWork, readNurseTopics, reconcileNurse } from "./nurse.ts";
import { afterAll, expect, test } from "bun:test";
import { assessment, nurseFixture, seal, seedReports } from "./nurse.test-support.ts";
import { beforeTrackerWrite, createSpawn, createTask } from "./tracker.test-support.ts";
import { CommandError } from "@hive/beads";
import type { Store } from "./store.ts";
import { dispatch } from "./dispatch.ts";

const NONE = 0;
const ONE = 1;
const TWO = 2;
const BELOW_BATCH = 24;
const TOPIC_COUNT = 7;
const TOPIC_PADDING = 600;
const TOPIC_LIMIT = 5;
const TOPIC_BYTES = 4096;
const BATCH = 25;
const BACKLOG = 60;
const FIRST_CURSOR = 25;
const SECOND_CURSOR = 50;
const warm = await nurseFixture();
await warm.activate();
seedReports(warm, BATCH);
await reconcileNurse(warm.runtime);
await seal(warm);
await reconcileNurse(warm.runtime);

const under = await prepared(BELOW_BATCH);
const threshold = await prepared(BATCH);
const backlog = await prepared(BACKLOG);
await reconcileNurse(backlog.runtime);
await seal(backlog);
const late = await nurseFixture();
seedReports(late, BATCH);
const inFlight = assessment("early-enrolled");
const {
	receipt: _receipt,
	deadline: _deadline,
	startedAt: _started,
	launched: _launched,
	result: _result,
	...queued
} = inFlight;
late.store.saveAssessment(late.repository.root, { ...queued, phase: "queued" });
await late.activate();
const recent = seedReports(late, BELOW_BATCH);

const badCases = ["failed", "missing", "receipt", "partial", "unavailable"];
const bad = new Map(
	await Promise.all(
		// eslint-disable-next-line max-statements -- Keep each failure fixture's setup and receipt mutation together.
		badCases.map(async (name) => {
			const fixture = await prepared(BATCH);
			await reconcileNurse(fixture.runtime);
			if (name !== "missing" && name !== "failed") {
				await seal(fixture);
			}
			const active = fixture.store.nurseCheckpoint(fixture.repository.root)!.active!;
			if (active.phase !== "submitted") {
				throw new Error("Fixture requires a submitted audit");
			}
			if (name === "failed" || name === "missing") {
				fixture.done();
				await fixture.beads.close(fixture.scope, active.runId, { reason: "fixture" });
				await fixture.beads.close(fixture.scope, active.requestId, {
					reason: failedReason(name),
				});
			}
			if (name === "receipt" || name === "partial") {
				const audit = await fixture.beads.show(fixture.scope, active.auditId);
				const coverage = JSON.parse(audit.notes);
				if (name === "receipt") {
					coverage.responseId = "another-response";
				} else {
					coverage.reports.pop();
				}
				await fixture.beads.update(fixture.scope, [active.auditId], {
					notes: JSON.stringify(coverage),
				});
			}
			if (name === "unavailable") {
				await createTask(fixture, { parent: active.auditId, title: "Required investigation" });
			}
			return [name, fixture] as const;
		}),
	),
);

const recovery = await prepared(BATCH);
let interruptedRun = "";
recovery.runtime.nurse = {
	...recovery.runtime.nurse,
	start: async ({ parent }) => {
		interruptedRun = await createTask(recovery, { parent });
		await createSpawn(recovery, interruptedRun);
		throw new Error("Interrupted publication response");
	},
};
await reconcileNurse(recovery.runtime).catch(() => {});
const interruptedState = recovery.store.nurseCheckpoint(recovery.repository.root)!;
recovery.runtime.nurse = {
	...recovery.runtime.nurse,
	start: () => {
		throw new Error("Duplicate submission");
	},
};

const conflicts = await prepared(BATCH);
const conflicting = beforeTrackerWrite(conflicts.beads, async (scope, ids, input) => {
	if (input.ifUnchanged !== undefined) {
		await conflicts.beads.update(scope, ids, { design: "concurrent native revision" });
	}
});
const lineage = await prepared(NONE);
const audit = await createTask(lineage, { parent: lineage.parent });
const investigator = await createTask(lineage, { parent: audit });
const genericRun = await createTask(lineage, { parent: investigator });
const ordinary = await createTask(lineage);
const topics = await prepared(NONE);
const padding = "x".repeat(TOPIC_PADDING);
const topicIds = await Promise.all(
	Array.from({ length: TOPIC_COUNT }, (_entry, index) =>
		createTask(topics, {
			type: "docs",
			status: "closed",
			parent: topics.parent,
			description: `Source request-${index}; uncertain explanation; next evidence: initiating trace ${padding}`,
		}),
	),
);
await topics.beads.update(topics.scope, [topics.parent], {
	design: JSON.stringify({ topics: topicIds }),
});
const missingTopic = await prepared(NONE);
await missingTopic.beads.update(missingTopic.scope, [missingTopic.parent], {
	design: JSON.stringify({ topics: ["missing-topic"] }),
});

const orphan = await prepared(BATCH);
let orphanRun = "";
orphan.runtime.nurse = {
	...orphan.runtime.nurse,
	start: async ({ parent }) => {
		orphanRun = await createTask(orphan, { parent });
		throw new Error("Interrupted before driver publication");
	},
	attach: async ({ runId }) => ({ runId, requestId: await createSpawn(orphan, runId) }),
};
await reconcileNurse(orphan.runtime).catch(() => {});

const interruptedCommit = await prepared(BATCH);
await reconcileNurse(interruptedCommit.runtime);
await seal(interruptedCommit);
const failedCommit = beforeTrackerWrite(interruptedCommit.beads, (_scope, _ids, input) => {
	if (input.notes && JSON.parse(input.notes).active === null) {
		throw new Error("Interrupted coverage projection");
	}
	return Promise.resolve();
});
await reconcileNurse({ ...interruptedCommit.runtime, beads: failedCommit }).catch(() => {});

const ambiguous = await prepared(BATCH);
await reconcileNurse(ambiguous.runtime);
await seal(ambiguous);
const ambiguousActive = ambiguous.store.nurseCheckpoint(ambiguous.repository.root)!.active!;
if (ambiguousActive.phase !== "submitted") {
	throw new Error("Expected submitted audit");
}
await createTask(ambiguous, {
	type: "docs",
	status: "closed",
	labels: ["response"],
	description: JSON.stringify({
		formatVersion: ONE,
		author: "worker",
		taskId: ambiguousActive.runId,
		requestId: ambiguousActive.requestId,
		body: "Conflicting complete response",
		supersedes: [],
	}),
	deps: [
		{ id: ambiguousActive.runId, type: "replies-to" },
		{ id: ambiguousActive.requestId, type: "related" },
	],
});

const unavailableReport = await prepared(BATCH);
await reconcileNurse(unavailableReport.runtime);
await seal(unavailableReport);
const unavailableActive = unavailableReport.store.nurseCheckpoint(
	unavailableReport.repository.root,
)!.active!;
if (unavailableActive.phase !== "submitted") {
	throw new Error("Expected submitted audit");
}
const unavailableAudit = await unavailableReport.beads.show(
	unavailableReport.scope,
	unavailableActive.auditId,
);
const unavailableCoverage = JSON.parse(unavailableAudit.notes);
unavailableCoverage.reports[NONE] = {
	id: unavailableActive.reports[NONE]!.id,
	kind: "unavailable",
	reason: "Retained artifact unreadable",
};
await unavailableReport.beads.update(unavailableReport.scope, [unavailableAudit.id], {
	notes: JSON.stringify(unavailableCoverage),
});

const gaps = await prepared(NONE);
const gapRows = Array.from({ length: BATCH + ONE }, (_entry, index) =>
	assessment(`gap-${index}`, false),
);
for (const entry of gapRows) {
	gaps.store.saveAssessment(gaps.repository.root, entry);
}
seedReports(gaps, BATCH);
const disabled = await prepared(BELOW_BATCH);
const disabledBaseline = disabled.store.nurseCheckpoint(disabled.repository.root)!.baseline;
const reenabledReport = assessment("completed-while-disabled");
// eslint-disable-next-line unicorn/no-null -- Null is the public policy value that disables new audits.
await activateNurse({ ...disabled.runtime, config: { ...disabled.config, auto_nurse: null } });
disabled.store.saveAssessment(disabled.repository.root, reenabledReport);
const reserved = await prepared(BATCH);
await reserved.beads.update(reserved.scope, [reserved.parent], { assignee: "another-agent" });
const noHistory: Store["history"] = {
	run: (_input, action) =>
		action({ completed: () => {}, failed: () => {}, reference: () => {}, step: () => {} }),
};
await dispatch(
	{
		...warm.runtime,
		store: { ...warm.store, history: noHistory, inventory: () => Promise.resolve([]) },
	},
	warm.config,
	"fixture",
);

const investigationCases = ["pending", "failed", "missing", "ambiguous"];
const investigations = new Map(
	await Promise.all(
		// eslint-disable-next-line max-statements -- Keep each request outcome and authored response setup together.
		investigationCases.map(async (kind) => {
			const fixture = await prepared(BATCH);
			await reconcileNurse(fixture.runtime);
			await seal(fixture);
			const active = fixture.store.nurseCheckpoint(fixture.repository.root)!.active!;
			if (active.phase !== "submitted") {
				throw new Error("Expected submitted audit");
			}
			const runId = await createTask(fixture, { parent: active.auditId });
			const requestId = await createSpawn(fixture, runId);
			if (kind !== "pending") {
				await fixture.beads.close(fixture.scope, requestId, { reason: failedReason(kind) });
			}
			if (kind === "ambiguous") {
				await Promise.all(
					Array.from({ length: TWO }, () =>
						createTask(fixture, {
							type: "docs",
							status: "closed",
							labels: ["response"],
							description: JSON.stringify({
								formatVersion: ONE,
								author: "worker",
								taskId: runId,
								requestId,
								body: "Complete sourced audit with uncertainty",
								supersedes: [],
							}),
							deps: [
								{ id: runId, type: "replies-to" },
								{ id: requestId, type: "related" },
							],
						}),
					),
				);
			}
			if (kind === "failed") {
				const pendingRun = await createTask(fixture, { parent: active.auditId });
				await createSpawn(fixture, pendingRun);
			}
			return [kind, { fixture, active, requestId }] as const;
		}),
	),
);

const fixtures = [
	warm,
	under,
	threshold,
	backlog,
	late,
	recovery,
	conflicts,
	lineage,
	topics,
	missingTopic,
	orphan,
	interruptedCommit,
	ambiguous,
	unavailableReport,
	...bad.values(),
	...Array.from(investigations.values(), ({ fixture }) => fixture),
	gaps,
	disabled,
	reserved,
];
afterAll(() => {
	for (const fixture of fixtures) {
		fixture.store.close();
	}
});

test("24 newly completed reports do not reserve an audit", async () => {
	await reconcileNurse(under.runtime);
	expect(under.submissions).toEqual([]);
	expect(under.store.nurseCheckpoint(under.repository.root)?.active).toBeNull();
});

test("25 reports reserve the oldest exact manifest without marking coverage", async () => {
	await reconcileNurse(threshold.runtime);
	const checkpoint = threshold.store.nurseCheckpoint(threshold.repository.root)!;
	expect(checkpoint.active?.reports).toHaveLength(BATCH);
	expect(checkpoint.active?.reports.map(({ ordinal }) => ordinal)).toEqual(
		Array.from({ length: BATCH }, (_entry, index) => index + ONE),
	);
	expect(checkpoint.cursor).toBe(NONE);
	expect(threshold.submissions).toHaveLength(ONE);
});

test("historical reports are excluded while preactivation in-flight completion arrives last", async () => {
	late.store.saveAssessment(late.repository.root, inFlight);
	await reconcileNurse(late.runtime);
	const checkpoint = late.store.nurseCheckpoint(late.repository.root)!;
	expect(checkpoint.baseline).toBe(BATCH);
	expect(checkpoint.active?.reports.map(({ id }) => id)).toEqual([
		...recent.map(({ id }) => id),
		inFlight.id,
	]);
	const ordinal = checkpoint.active?.reports.at(-ONE)?.ordinal;
	late.store.saveAssessment(late.repository.root, inFlight);
	expect(late.store.assessmentCompletionHead(late.repository)).toBe(ordinal!);
});

test("verified delivered coverage commits one batch of a 60-report backlog", async () => {
	await reconcileNurse(backlog.runtime);
	expect(backlog.store.nurseCheckpoint(backlog.repository.root)?.cursor).toBe(FIRST_CURSOR);
	expect(backlog.store.nurseCheckpoint(backlog.repository.root)?.active).toBeNull();
});

test("backlog starts the next 25 only after successful coverage", async () => {
	await reconcileNurse(backlog.runtime);
	const active = backlog.store.nurseCheckpoint(backlog.repository.root)?.active;
	expect(active?.reports).toHaveLength(BATCH);
	expect(active?.reports.at(-ONE)?.ordinal).toBe(SECOND_CURSOR);
	expect(backlog.submissions).toHaveLength(TWO);
});

test.each(badCases)(
	"%s delivery retains the batch and allows reconciliation to return",
	async (name) => {
		const fixture = bad.get(name)!;
		await reconcileNurse(fixture.runtime);
		const checkpoint = fixture.store.nurseCheckpoint(fixture.repository.root)!;
		expect(checkpoint.cursor).toBe(NONE);
		expect(checkpoint.active?.reports).toHaveLength(BATCH);
		expect(fixture.submissions).toHaveLength(ONE);
		if (name !== "unavailable") {
			expect(checkpoint.attention).not.toBeNull();
		}
	},
);

test.each(investigationCases)(
	"%s investigation retains the batch with attention only after settlement",
	// eslint-disable-next-line max-statements -- Verify retention and native attention for each investigation outcome.
	async (kind) => {
		const { fixture, active, requestId } = investigations.get(kind)!;
		await reconcileNurse(fixture.runtime);
		const saved = fixture.store.nurseCheckpoint(fixture.repository.root)!;
		expect(saved.active?.token).toBe(active.token);
		expect(saved.cursor).toBe(NONE);
		expect(fixture.submissions).toHaveLength(ONE);
		if (kind === "pending") {
			expect(saved.attention).toBeNull();
		} else {
			if (kind === "failed") {
				expect(saved.attention?.kind).toBe("failed");
			} else {
				expect(saved.attention?.kind).toBe("delivery");
			}
			expect(saved.attention?.detail).toContain(requestId);
		}
		const control = await fixture.beads.show(fixture.scope, fixture.parent);
		expect(JSON.parse(control.notes).attention).toEqual(saved.attention);
	},
);

test("reconciliation recovers a published driver after an interrupted submission response", async () => {
	await activateNurse(recovery.runtime);
	await reconcileNurse(recovery.runtime);
	const active = recovery.store.nurseCheckpoint(recovery.repository.root)!.active!;
	expect(interruptedState.active?.phase).toBe("starting");
	expect(active.phase).toBe("submitted");
	if (active.phase === "submitted") {
		expect(active.runId).toBe(interruptedRun);
	}
});

test("native reservation rejects a competing revision before any audit launch", async () => {
	await expect(reconcileNurse({ ...conflicts.runtime, beads: conflicting })).rejects.toBeInstanceOf(
		CommandError,
	);
	expect(conflicts.submissions).toEqual([]);
});

test("interrupted workflow creation attaches only the confirmed orphan run", async () => {
	await reconcileNurse(orphan.runtime);
	const active = orphan.store.nurseCheckpoint(orphan.repository.root)!.active!;
	expect(active.phase).toBe("submitted");
	if (active.phase === "submitted") {
		expect(active.runId).toBe(orphanRun);
	}
});

test("delivered coverage resumes after audit closure interrupted its cursor commit", async () => {
	await reconcileNurse(interruptedCommit.runtime);
	const checkpoint = interruptedCommit.store.nurseCheckpoint(interruptedCommit.repository.root)!;
	expect(checkpoint.active).toBeNull();
	expect(checkpoint.cursor).toBe(FIRST_CURSOR);
	expect(interruptedCommit.submissions).toHaveLength(ONE);
});

test("ambiguous authored responses leave the exact batch outstanding", async () => {
	await reconcileNurse(ambiguous.runtime);
	const checkpoint = ambiguous.store.nurseCheckpoint(ambiguous.repository.root)!;
	expect(checkpoint.active?.token).toBe(ambiguousActive.token);
	expect(checkpoint.cursor).toBe(NONE);
	expect(checkpoint.attention?.kind).toBe("delivery");
});

test("explicit unavailable dispositions commit coverage while retaining their reason", async () => {
	await reconcileNurse(unavailableReport.runtime);
	const checkpoint = unavailableReport.store.nurseCheckpoint(unavailableReport.repository.root)!;
	expect(checkpoint.cursor).toBe(FIRST_CURSOR);
	const retained = await unavailableReport.beads.show(unavailableReport.scope, unavailableAudit.id);
	expect(JSON.parse(retained.notes).reports[NONE]).toEqual(unavailableCoverage.reports[NONE]);
});

test.each(["host", "tracker", "state"])(
	"a different %s cannot adopt an active control",
	async (name) => {
		const runtime = { ...under.runtime };
		if (name === "host") {
			runtime.host = "foreign-host";
		}
		if (name === "state") {
			runtime.state = "/other-state";
		}
		if (name === "tracker") {
			runtime.repository = { ...runtime.repository, beadsDb: "/other-tracker" };
		}
		await expect(activateNurse(runtime)).rejects.toBeInstanceOf(Error);
	},
);

test("a health scope assigned to another agent cannot be mutated or launch an audit", async () => {
	const before = await reserved.beads.show(reserved.scope, reserved.parent);
	await expect(reconcileNurse(reserved.runtime)).rejects.toBeInstanceOf(Error);
	expect(await reserved.beads.show(reserved.scope, reserved.parent)).toEqual(before);
	expect(reserved.submissions).toEqual([]);
});

test("generic investigator descendants are excluded by native lineage", async () => {
	expect(await isNurseWork(lineage.runtime, [genericRun])).toBe(true);
	expect(await isNurseWork(lineage.runtime, [ordinary])).toBe(false);
});

test("current topics remain bounded, sourced and explicit about omitted items", async () => {
	const snapshot = await readNurseTopics(topics.runtime);
	expect(snapshot.kind).toBe("available");
	if (snapshot.kind === "available") {
		expect(snapshot.topics.length).toBeLessThanOrEqual(TOPIC_LIMIT);
		expect(Buffer.byteLength(JSON.stringify(snapshot.topics))).toBeLessThanOrEqual(TOPIC_BYTES);
		expect(snapshot.topics.length + snapshot.omitted).toBe(topicIds.length);
		expect(snapshot.topics[NONE]?.summary).toContain("Source request-0");
	}
});

test("unavailable topic reads remain distinct from an empty index", async () => {
	const snapshot = await readNurseTopics(missingTopic.runtime);
	expect(snapshot.kind).toBe("unavailable");
});

test("failed assessments are bounded gaps and never count toward the report threshold", async () => {
	await reconcileNurse(gaps.runtime);
	const active = gaps.store.nurseCheckpoint(gaps.repository.root)!.active!;
	expect(active.reports).toHaveLength(BATCH);
	expect(active.gaps.entries).toHaveLength(BATCH);
	expect(active.gaps.omitted).toBe(ONE);
	expect(active.gaps.entries[NONE]?.reason).toContain("missing_report");
});

test("disable and re-enable preserve the activation baseline and accumulated backlog", async () => {
	await activateNurse(disabled.runtime);
	await reconcileNurse(disabled.runtime);
	const checkpoint = disabled.store.nurseCheckpoint(disabled.repository.root)!;
	expect(checkpoint.baseline).toBe(disabledBaseline);
	expect(checkpoint.active?.reports.at(-ONE)?.id).toBe(reenabledReport.id);
});

test("a failed advisory audit leaves the ordinary dispatch pass running", async () => {
	const fixture = bad.get("failed")!;
	let scheduled = false;
	await dispatch(
		{
			...fixture.runtime,
			store: {
				...fixture.store,
				history: noHistory,
				inventory: () => {
					scheduled = true;
					return Promise.resolve([]);
				},
			},
		},
		fixture.config,
		"fixture",
	);
	expect(scheduled).toBe(true);
	expect(fixture.store.nurseCheckpoint(fixture.repository.root)?.attention?.kind).toBe("failed");
});

async function prepared(count: number) {
	const fixture = await nurseFixture();
	await fixture.activate();
	seedReports(fixture, count);
	return fixture;
}

function failedReason(name: string) {
	if (name === "failed") {
		return "exhausted";
	}
	return "completed";
}
