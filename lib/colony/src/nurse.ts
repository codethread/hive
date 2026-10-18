import { ResponseError, getResponse, resolveResponse } from "./response-store.ts";
import { SPAWN_REQUEST_LABELS, readSpawnRequest, requestOutcome } from "@hive/shared";
import type { BeadRecord } from "@hive/beads";
import type { BeesConfig } from "@hive/shared";
import type { Store } from "./store.ts";
import type { TrackerContext } from "./tracker.ts";
import { renderNurseBrief } from "./nurse-brief.ts";
import { trackerScope } from "./tracker.ts";
import { z } from "zod";

const BATCH_SIZE = 25;
const ARRAY_DELIMITERS = 2;
const RECOVERY_LIMIT = 2;
const NONE = 0;
const ONE = 1;
const MAX_TOPICS = 5;
const TOPIC_BYTES = 4096;
const MAX_AUDIT_TASKS = 32;
const text = z.string().min(ONE);
const entrySchema = z.strictObject({
	id: text,
	requestId: text,
	ordinal: z.number().int().positive(),
});
const gapSchema = entrySchema.extend({ reason: text });
const manifestSchema = z.strictObject({
	token: text,
	after: z.number().int().nonnegative(),
	through: z.number().int().positive(),
	reports: z.array(entrySchema).length(BATCH_SIZE),
	gaps: z.strictObject({
		entries: z.array(gapSchema).max(BATCH_SIZE),
		omitted: z.number().int().nonnegative(),
	}),
});
const activeSchema = z.discriminatedUnion("phase", [
	manifestSchema.extend({ phase: z.literal("reserved") }),
	manifestSchema.extend({ phase: z.literal("creating") }),
	manifestSchema.extend({ phase: z.literal("created"), auditId: text }),
	manifestSchema.extend({ phase: z.literal("starting"), auditId: text }),
	manifestSchema.extend({
		phase: z.literal("submitted"),
		auditId: text,
		runId: text,
		requestId: text,
	}),
]);
const dispositionSchema = z.discriminatedUnion("kind", [
	z.strictObject({ id: text, kind: z.literal("reviewed") }),
	z.strictObject({ id: text, kind: z.literal("unavailable"), reason: text }),
]);
export const nurseCoverageSchema = z.strictObject({
	format: z.literal("colony-nurse-coverage"),
	token: text,
	responseId: text,
	reports: z.array(dispositionSchema).length(BATCH_SIZE),
	gaps: manifestSchema.shape.gaps,
	topics: z.array(text).max(MAX_AUDIT_TASKS),
});
export const nurseCheckpointSchema = z.strictObject({
	format: z.literal("colony-nurse-control"),
	parent: text,
	kind: text,
	root: text,
	beadsDb: text,
	host: text,
	state: text,
	activatedAt: z.number(),
	baseline: z.number().int().nonnegative(),
	cursor: z.number().int().nonnegative(),
	active: activeSchema.nullable(),
	lastCoverage: z.strictObject({ auditId: text, responseId: text, token: text }).nullable(),
	attention: z
		.strictObject({ kind: z.enum(["failed", "delivery", "publication"]), detail: text })
		.nullable(),
});
const topicIndexSchema = z.strictObject({ topics: z.array(text).max(MAX_AUDIT_TASKS) });
export type NurseCheckpoint = z.infer<typeof nurseCheckpointSchema>;
export type NurseBatch = z.infer<typeof manifestSchema>;
type AuditReadiness =
	| { kind: "complete" }
	| { kind: "pending" }
	| { kind: "attention"; attention: NonNullable<NurseCheckpoint["attention"]> };
export interface NurseCommands {
	/** Submit the ordinary audit workflow through Bee. */
	start: (input: {
		/** Ordinary audit task beneath the retained health scope. */
		parent: string;
		/** Configured nurse role. */
		kind: string;
		/** Frozen batch identity, also used for its private input file. */
		token: string;
		/** Rendered audit protocol and manifest. */
		request: string;
		/** Canonical configuration root and selected tracker. */
		repository: TrackerContext["repository"];
	}) => Promise<{ runId: string; requestId: string }>;
	/** Attach a driver only after publication recovery establishes an orphan run. */
	attach: (input: {
		/** Existing audit workflow whose publication was interrupted. */
		runId: string;
		/** Retained nurse role. */
		kind: string;
		/** Endpoint used for the original audit. */
		repository: TrackerContext["repository"];
	}) => Promise<{ runId: string; requestId: string }>;
	/** Read saved workflow completion through Busy Bee. */
	show: (runId: string, repository: TrackerContext["repository"]) => Promise<{ status: string }>;
}
export interface NurseRuntime extends TrackerContext {
	/** Private completion order and projection of native nurse control. */
	store: Store;
	/** Loaded scheduling policy and owner. */
	config: BeesConfig;
	/** Selected private Colony state directory. */
	state: string;
	/** Host authorized to reconcile this control record. */
	host: string;
	/** Clock for activation and topic-snapshot freshness. */
	now: () => number;
	/** Public workflow submission and inspection boundary. */
	nurse: NurseCommands;
}

/** Establish the retained baseline before this pass can finalize assessments. */
// eslint-disable-next-line max-statements -- Keep baseline capture, native authority and local projection in order.
export async function activateNurse(runtime: NurseRuntime): Promise<void> {
	const { store, repository, config } = runtime;
	let saved = store.nurseCheckpoint(repository.root);
	if (!saved && config.auto_nurse === null) {
		return;
	}
	if (
		saved &&
		config.auto_nurse !== null &&
		(saved.parent !== config.auto_nurse.parent || saved.kind !== config.auto_nurse.kind)
	) {
		throw new Error("Automatic nurse configuration changed its retained health scope or kind");
	}
	if (!saved) {
		const baseline = store.assessmentCompletionHead(repository);
		/* eslint-disable unicorn/no-null -- Native control encodes inactive fields as JSON null. */
		saved = {
			format: "colony-nurse-control",
			...config.auto_nurse!,
			...repository,
			host: runtime.host,
			state: runtime.state,
			activatedAt: runtime.now(),
			baseline,
			cursor: baseline,
			active: null,
			lastCoverage: null,
			attention: null,
		};
		/* eslint-enable unicorn/no-null */
		store.saveNurseCheckpoint(repository.root, saved);
	}
	const control = await readControl(runtime, saved.parent);
	assertAvailable(control);
	if (control.notes === "") {
		await writeControl(runtime, control, saved);
	} else {
		const native = nurseCheckpointSchema.parse(JSON.parse(control.notes));
		assertAuthority(runtime, native);
		if (native.parent !== saved.parent || native.baseline !== saved.baseline) {
			throw new Error("Nurse baseline or health control does not match this endpoint checkpoint");
		}
		store.saveNurseCheckpoint(repository.root, native);
	}
}

// eslint-disable-next-line max-statements -- Reserve before publication and consume only the retained batch.
export async function reconcileNurse(runtime: NurseRuntime): Promise<void> {
	let saved = runtime.store.nurseCheckpoint(runtime.repository.root);
	if (!saved) {
		return;
	}
	assertAuthority(runtime, saved);
	let control = await readControl(runtime, saved.parent);
	assertAvailable(control);
	saved = nurseCheckpointSchema.parse(JSON.parse(control.notes));
	assertAuthority(runtime, saved);
	if (saved.active === null) {
		if (runtime.config.auto_nurse === null) {
			return;
		}
		const batch = selectBatch(runtime, saved.cursor);
		if (!batch) {
			return;
		}
		// eslint-disable-next-line unicorn/no-null -- A new reservation clears native attention explicitly.
		saved = { ...saved, active: { ...batch, phase: "reserved" }, attention: null };
		control = await writeControl(runtime, control, saved);
	}
	const active = saved.active!;
	if (active.phase === "submitted") {
		await consumeCoverage(runtime, { control, saved, active });
		return;
	}
	await publishAudit(runtime, control, saved);
}

// eslint-disable-next-line max-statements -- Read one bounded snapshot with its omission and availability evidence.
export async function readNurseTopics(
	runtime: TrackerContext & { store: Store; now: () => number },
) {
	const saved = runtime.store.nurseCheckpoint(runtime.repository.root);
	const sampledAt = runtime.now();
	if (!saved) {
		return { kind: "disabled" as const, sampledAt };
	}
	try {
		const scope = trackerScope(runtime.repository, "sys-colony");
		const control = await runtime.beads.show(scope, saved.parent);
		let index: z.infer<typeof topicIndexSchema> = { topics: [] };
		if (control.design !== "") {
			index = topicIndexSchema.parse(JSON.parse(control.design));
		}
		const selected = index.topics.slice(NONE, MAX_TOPICS);
		const snapshots = await Promise.all(
			selected.map(async (id) => {
				const topic = await runtime.beads.show(scope, id);
				return { id, updatedAt: topic.updated_at, summary: topic.description };
			}),
		);
		const topics = [];
		let remaining = TOPIC_BYTES - ARRAY_DELIMITERS;
		let omitted = index.topics.length - selected.length;
		for (const snapshot of snapshots) {
			const bytes = Buffer.byteLength(JSON.stringify(snapshot)) + Number(topics.length > NONE);
			if (bytes <= remaining) {
				topics.push(snapshot);
				remaining -= bytes;
			} else {
				omitted += ONE;
			}
		}
		return {
			kind: "available" as const,
			sampledAt,
			indexUpdatedAt: control.updated_at,
			topics,
			omitted,
		};
	} catch (error) {
		return {
			kind: "unavailable" as const,
			sampledAt,
			reason: String(error).slice(NONE, TOPIC_BYTES),
		};
	}
}

// eslint-disable-next-line max-statements -- Follow native ancestry while retaining one visited set.
export async function isNurseWork(
	runtime: TrackerContext & { store: Store },
	taskIds: string[],
): Promise<boolean> {
	const saved = runtime.store.nurseCheckpoint(runtime.repository.root);
	if (!saved) {
		return false;
	}
	const scope = trackerScope(runtime.repository, "sys-colony");
	const seen = new Set<string>();
	const pending = [...taskIds];
	while (pending.length > NONE) {
		const id = pending.pop()!;
		if (id === saved.parent) {
			return true;
		}
		if (!seen.has(id)) {
			seen.add(id);
			// eslint-disable-next-line no-await-in-loop -- Each read discovers the next parent links.
			const task = await runtime.beads.show(scope, id);
			pending.push(
				...task.dependencies
					.filter((edge) => edge.dependency_type === "parent-child")
					.map(({ id: parent }) => parent),
			);
		}
	}
	return false;
}

function selectBatch(runtime: NurseRuntime, cursor: number): NurseBatch | undefined {
	const head = runtime.store.assessmentCompletionHead(runtime.repository);
	const rows = runtime.store.assessmentCompletions(runtime.repository, {
		after: cursor,
		successful: true,
		through: head,
		limit: BATCH_SIZE,
	});
	if (rows.length !== BATCH_SIZE) {
		return;
	}
	const through = rows.at(-ONE)!.ordinal;
	const failures = runtime.store.assessmentCompletions(runtime.repository, {
		after: cursor,
		successful: false,
		through,
		limit: BATCH_SIZE,
	});
	const entries = failures.map(({ ordinal, id, requestId, reason, detail }) => ({
		ordinal,
		id,
		requestId,
		reason: `${reason}: ${detail}`,
	}));
	return {
		token: crypto.randomUUID(),
		after: cursor,
		through,
		reports: rows.map(({ ordinal, id, requestId }) => ({ id, requestId, ordinal })),
		gaps: {
			entries,
			omitted:
				runtime.store.assessmentGapCount(runtime.repository, cursor, through) - entries.length,
		},
	};
}

// eslint-disable-next-line max-statements -- Keep each native publication effect beside its retained recovery phase.
async function publishAudit(
	runtime: NurseRuntime,
	original: BeadRecord,
	checkpoint: NurseCheckpoint,
): Promise<void> {
	let control = original;
	let saved = checkpoint;
	let active = saved.active!;
	const scope = trackerScope(runtime.repository, "sys-colony");
	if (active.phase === "reserved") {
		active = { ...active, phase: "creating" };
		saved = { ...saved, active };
		control = await writeControl(runtime, control, saved);
		const audit = await runtime.beads.create(scope, {
			title: `Nurse audit ${active.token}`,
			owner: runtime.config.owner,
			parent: saved.parent,
			description: renderNurseBrief({
				batch: active,
				parent: saved.parent,
				repository: runtime.repository,
				state: runtime.state,
			}),
			labels: ["area:colony"],
		});
		active = { ...active, phase: "created", auditId: audit.id };
		saved = { ...saved, active };
		control = await writeControl(runtime, control, saved);
	}
	if (active.phase === "creating") {
		const matches = await runtime.beads.list(scope, {
			descriptionContains: active.token,
			excludeLabels: ["system"],
			all: true,
			limit: RECOVERY_LIMIT,
		});
		if (matches.issues.length !== ONE || matches.has_more) {
			await recordAttention(
				runtime,
				{ control, saved },
				{
					kind: "publication",
					detail: `Uncertain audit creation for ${active.token}; inspect health ${saved.parent} before recovery`,
				},
			);
			return;
		}
		const audit = await runtime.beads.show(scope, matches.issues[NONE]!.id);
		if (
			!audit.dependencies.some(
				(edge) => edge.id === saved.parent && edge.dependency_type === "parent-child",
			)
		) {
			throw new Error("Recovered nurse audit is outside the configured health scope");
		}
		active = { ...active, phase: "created", auditId: audit.id };
		saved = { ...saved, active };
		control = await writeControl(runtime, control, saved);
	}
	if (active.phase === "created") {
		active = { ...active, phase: "starting" };
		saved = { ...saved, active };
		control = await writeControl(runtime, control, saved);
		const result = await runtime.nurse.start({
			parent: active.auditId,
			kind: saved.kind,
			token: active.token,
			request: renderNurseBrief({
				batch: active,
				parent: saved.parent,
				repository: runtime.repository,
				state: runtime.state,
			}),
			repository: runtime.repository,
		});
		await writeControl(runtime, control, {
			...saved,
			active: { ...active, phase: "submitted", ...result },
		});
		return;
	}
	if (active.phase === "starting") {
		const children = await runtime.beads.dep.list(scope, active.auditId, {
			direction: "up",
			type: "parent-child",
		});
		if (children.length !== ONE) {
			await recordAttention(
				runtime,
				{ control, saved },
				{
					kind: "publication",
					detail:
						`Uncertain workflow publication for ${active.token} beneath ${active.auditId}; ` +
						"inspect before recovery",
				},
			);
			return;
		}
		const runId = children[NONE]!.issue_id;
		const links = await runtime.beads.dep.list(scope, runId, { direction: "up", type: "related" });
		let requests: Awaited<ReturnType<typeof runtime.beads.list>> = {
			issues: [],
			has_more: false,
			total: NONE,
			limit: RECOVERY_LIMIT,
			offset: NONE,
		};
		if (links.length > NONE) {
			requests = await runtime.beads.list(scope, {
				ids: links.map(({ issue_id }) => issue_id),
				labels: SPAWN_REQUEST_LABELS,
				all: true,
				limit: RECOVERY_LIMIT,
			});
		}
		let result = { runId, requestId: "" };
		if (requests.issues.length === NONE && !requests.has_more) {
			result = await runtime.nurse.attach({
				runId,
				kind: saved.kind,
				repository: runtime.repository,
			});
		} else if (requests.issues.length === ONE && !requests.has_more) {
			const request = readSpawnRequest(await runtime.beads.show(scope, requests.issues[NONE]!.id));
			assertNurseRequest(runtime, request, runId);
			result = { runId, requestId: request.id };
		} else {
			await recordAttention(
				runtime,
				{ control, saved },
				{
					kind: "publication",
					detail: `Ambiguous driver requests for ${active.token}; inspect before recovery`,
				},
			);
			return;
		}
		await writeControl(runtime, control, {
			...saved,
			active: { ...active, phase: "submitted", ...result },
		});
	}
}

// eslint-disable-next-line max-statements -- Verify coverage before closing the audit and advancing its cursor.
async function consumeCoverage(
	runtime: NurseRuntime,
	input: {
		control: BeadRecord;
		saved: NurseCheckpoint;
		active: Extract<z.infer<typeof activeSchema>, { phase: "submitted" }>;
	},
): Promise<void> {
	const { control, saved, active } = input;
	const scope = trackerScope(runtime.repository, "sys-colony");
	let request = await runtime.beads.show(scope, active.requestId);
	assertNurseRequest(runtime, readSpawnRequest(request), active.runId);
	const replacements = request.dependents.filter((edge) => edge.dependency_type === "supersedes");
	if (replacements.length > NONE) {
		if (replacements.length !== ONE) {
			throw new Error("Nurse has ambiguous explicit replacements");
		}
		request = await runtime.beads.show(scope, replacements[NONE]!.id);
		assertNurseRequest(runtime, readSpawnRequest(request), active.runId);
		await writeControl(runtime, control, {
			...saved,
			active: { ...active, requestId: request.id },
		});
		return;
	}
	if (requestOutcome(request) === "pending") {
		return;
	}
	if (requestOutcome(request) !== "succeeded") {
		await recordAttention(
			runtime,
			{ control, saved },
			{
				kind: "failed",
				detail:
					`Request ${request.id} did not succeed; batch ${active.token} remains outstanding. ` +
					"Inspect bee status before explicit retry.",
			},
		);
		return;
	}
	const run = await runtime.nurse.show(active.runId, runtime.repository);
	if (run.status !== "done") {
		return;
	}
	const delivery = await nurseResponse(runtime, { runId: active.runId, requestId: request.id });
	if (delivery.kind === "unavailable") {
		await recordAttention(
			runtime,
			{ control, saved },
			{ kind: "delivery", detail: delivery.detail },
		);
		return;
	}
	const { response } = delivery;
	const audit = await runtime.beads.show(scope, active.auditId);
	let document: unknown = undefined;
	try {
		document = JSON.parse(audit.notes);
	} catch (error) {
		if (!(error instanceof SyntaxError)) {
			throw error;
		}
	}
	const parsed = nurseCoverageSchema.safeParse(document);
	if (!parsed.success) {
		await recordAttention(
			runtime,
			{ control, saved },
			{
				kind: "delivery",
				detail: `Missing or invalid coverage receipt on ${audit.id}`,
			},
		);
		return;
	}
	const coverage = parsed.data;
	if (
		coverage.token !== active.token ||
		coverage.responseId !== response.id ||
		JSON.stringify(coverage.gaps) !== JSON.stringify(active.gaps) ||
		new Set(coverage.reports.map(({ id }) => id)).size !== BATCH_SIZE ||
		!active.reports.every(({ id }) => coverage.reports.some((entry) => entry.id === id))
	) {
		await recordAttention(
			runtime,
			{ control, saved },
			{
				kind: "delivery",
				detail: `Coverage receipt on ${audit.id} does not account for the frozen manifest and response`,
			},
		);
		return;
	}
	const children = await auditChildrenReadiness(runtime, active);
	if (children.kind !== "complete") {
		if (children.kind === "attention") {
			await recordAttention(runtime, { control, saved }, children.attention);
		}
		return;
	}
	if (audit.status !== "closed") {
		await runtime.beads.close(scope, audit.id, {
			reason: `Verified nurse coverage ${response.id} for batch ${active.token}`,
		});
	}
	/* eslint-disable unicorn/no-null -- Accepted coverage clears the native active batch and attention fields. */
	await writeControl(runtime, control, {
		...saved,
		cursor: active.through,
		active: null,
		attention: null,
		lastCoverage: { auditId: audit.id, responseId: response.id, token: active.token },
	});
	/* eslint-enable unicorn/no-null */
}

// eslint-disable-next-line max-statements -- Bound the audit tree and verify each descendant before accepting coverage.
async function auditChildrenReadiness(
	runtime: NurseRuntime,
	active: { auditId: string; token: string },
): Promise<AuditReadiness> {
	const scope = trackerScope(runtime.repository, "sys-colony");
	const pending = [active.auditId];
	const seen = new Set<string>();
	let waiting = false;
	while (pending.length > NONE) {
		const id = pending.pop()!;
		if (!seen.has(id)) {
			seen.add(id);
			if (seen.size > MAX_AUDIT_TASKS) {
				throw new Error("Nurse audit exceeds its bounded investigation scope");
			}
			// eslint-disable-next-line no-await-in-loop -- Each native read discovers this task's descendants.
			const task = await runtime.beads.show(scope, id);
			pending.push(
				...task.dependents
					.filter((edge) => edge.dependency_type === "parent-child")
					.map(({ id: child }) => child),
			);
			// eslint-disable-next-line no-await-in-loop -- Check for settled failure even while other work is pending.
			const delivery = await auditTaskReadiness(runtime, task, active.token);
			if (delivery.kind === "attention") {
				return delivery;
			}
			waiting ||=
				delivery.kind === "pending" || (id !== active.auditId && task.status !== "closed");
		}
	}
	if (waiting) {
		return { kind: "pending" };
	}
	return { kind: "complete" };
}

// eslint-disable-next-line max-statements -- Classify current request outcomes and delivery before combining readiness.
async function auditTaskReadiness(
	runtime: NurseRuntime,
	task: BeadRecord,
	token: string,
): Promise<AuditReadiness> {
	const scope = trackerScope(runtime.repository, "sys-colony");
	const ids = task.dependents
		.filter((edge) => edge.dependency_type === "related")
		.map(({ id }) => id);
	if (ids.length === NONE) {
		return { kind: "complete" };
	}
	const requests = await runtime.beads.list(scope, {
		ids,
		labels: SPAWN_REQUEST_LABELS,
		all: true,
		limit: MAX_AUDIT_TASKS,
	});
	if (requests.has_more) {
		throw new Error("Nurse audit exceeds its bounded request history");
	}
	const delivered = await Promise.all(
		// eslint-disable-next-line max-statements -- Verify each request's outcome, authority and answer together.
		requests.issues.map(async ({ id }): Promise<AuditReadiness> => {
			const native = await runtime.beads.show(scope, id);
			if (native.dependents.some((edge) => edge.dependency_type === "supersedes")) {
				return { kind: "complete" };
			}
			const request = readSpawnRequest(native);
			if (requestOutcome(native) === "pending") {
				return { kind: "pending" };
			}
			if (requestOutcome(native) !== "succeeded") {
				return {
					kind: "attention",
					attention: {
						kind: "failed",
						detail:
							`Request ${id} did not succeed; batch ${token} remains outstanding. ` +
							"Inspect bee status before explicit retry.",
					},
				};
			}
			let taskId = request.assignment.runId;
			if (request.assignment.kind === "stage") {
				taskId = request.assignment.stageId;
			}
			if (request.host !== runtime.host || taskId !== task.id) {
				throw new Error("Audit investigator has mismatched delivery authority");
			}
			const delivery = await nurseResponse(runtime, { runId: taskId, requestId: id });
			if (delivery.kind === "unavailable") {
				return { kind: "attention", attention: { kind: "delivery", detail: delivery.detail } };
			}
			return { kind: "complete" };
		}),
	);
	const attention = delivered.find((entry) => entry.kind === "attention");
	if (attention) {
		return attention;
	}
	if (delivered.some((entry) => entry.kind === "pending")) {
		return { kind: "pending" };
	}
	return { kind: "complete" };
}

async function nurseResponse(runtime: NurseRuntime, input: { runId: string; requestId: string }) {
	const context = { beads: runtime.beads, scope: trackerScope(runtime.repository, "sys-colony") };
	try {
		const resolved = await resolveResponse(context, {
			taskId: input.runId,
			requestId: input.requestId,
		});
		if (resolved.state !== "available") {
			return {
				kind: "unavailable" as const,
				detail: `Response is ${resolved.state} for ${input.requestId}; coverage remains outstanding`,
			};
		}
		const response = await getResponse(context, resolved.responseIds[NONE]);
		return { kind: "available" as const, response };
	} catch (error) {
		if (!(error instanceof ResponseError)) {
			throw error;
		}
		return {
			kind: "unavailable" as const,
			detail: `Response ${error.reason} for ${input.requestId}; coverage remains outstanding`,
		};
	}
}

function assertNurseRequest(
	runtime: NurseRuntime,
	request: ReturnType<typeof readSpawnRequest>,
	runId: string,
): void {
	if (
		request.host !== runtime.host ||
		request.assignment.kind !== "driver" ||
		request.assignment.runId !== runId
	) {
		throw new Error("Nurse request has mismatched host or workflow authority");
	}
}
function assertAuthority(runtime: NurseRuntime, saved: NurseCheckpoint): void {
	if (
		saved.root !== runtime.repository.root ||
		saved.beadsDb !== runtime.repository.beadsDb ||
		saved.host !== runtime.host ||
		saved.state !== runtime.state
	) {
		throw new Error("Nurse control belongs to another repository, tracker, host or server state");
	}
}
function assertAvailable(control: BeadRecord): void {
	if (
		control.status === "closed" ||
		control.status === "blocked" ||
		control.labels.includes("system") ||
		control.labels.includes("hitl") ||
		(control.assignee !== undefined && control.assignee !== "sys-colony")
	) {
		throw new Error(`Nurse health control ${control.id} is closed, blocked or reserved`);
	}
}
function readControl(runtime: NurseRuntime, parent: string): Promise<BeadRecord> {
	return runtime.beads.show(trackerScope(runtime.repository, "sys-colony"), parent);
}
async function recordAttention(
	runtime: NurseRuntime,
	input: { control: BeadRecord; saved: NurseCheckpoint },
	attention: NonNullable<NurseCheckpoint["attention"]>,
): Promise<void> {
	const { control, saved } = input;
	if (JSON.stringify(saved.attention) !== JSON.stringify(attention)) {
		await writeControl(runtime, control, { ...saved, attention });
	}
}
async function writeControl(
	runtime: NurseRuntime,
	previous: BeadRecord,
	next: NurseCheckpoint,
): Promise<BeadRecord> {
	assertAuthority(runtime, next);
	const notes = JSON.stringify(next);
	await runtime.beads.update(trackerScope(runtime.repository, "sys-colony"), [previous.id], {
		notes,
		ifUnchanged: previous.updated_at,
		force: true,
	});
	const current = await readControl(runtime, previous.id);
	const saved = nurseCheckpointSchema.parse(JSON.parse(current.notes));
	if (current.notes !== notes) {
		throw new Error("Nurse control changed after conditional publication");
	}
	runtime.store.saveNurseCheckpoint(runtime.repository.root, saved);
	return current;
}
