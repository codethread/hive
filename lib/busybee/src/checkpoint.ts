/* eslint-disable unicorn/no-null -- Format-2 wire control explicitly represents absent ownership with null. */
import { BusyBeeError, conditionalUpdate, readBead } from "./native.ts";
import type { Endpoint, MutationEndpoint, Services } from "./native.ts";
import { WorkflowControlError, parseWorkflowControl, readWorkflowControl } from "@hive/shared";
import type { BeadRecord } from "@hive/beads";
import type { ResolvedTask } from "./definition.ts";
import type { Snapshot } from "xstate";
import type { WorkflowControl } from "@hive/shared";
import { workflowVersionSchema } from "./compatibility.ts";
import { z } from "zod";

const FORMAT_VERSION = 2;
const LOCK_TIMEOUT = 10_000;
const LOCK_POLL = 25;
const NONEMPTY = 1;
const text = z.string().min(NONEMPTY);
const namedLocatorSchema = z.object({
	kind: z.literal("named"),
	name: text,
	version: workflowVersionSchema,
});
const sourceLocatorSchema = z.object({ kind: z.literal("source"), source: text });
const locatorSchema = z.discriminatedUnion("kind", [namedLocatorSchema, sourceLocatorSchema]);
const headerSchema = z.compile(
	z.object({
		definition: locatorSchema,
		formatVersion: z.literal(FORMAT_VERSION),
		hash: text,
		id: text,
	}),
);
const retainedNameSchema = z.object({ kind: z.literal("named"), name: text });
const identitySchema = z.compile(z.object({ definition: retainedNameSchema }));
const formatSchema = z.object({ formatVersion: z.unknown().optional() });

export type Locator = z.infer<typeof locatorSchema>;
export interface ActiveEntry {
	/** Published native visit. */
	bead: string;
	/** Frozen context used to publish this visit. */
	context: Record<string, unknown>;
	/** Stable actor and node visit identity. */
	key: string;
	/** Published task contract. */
	meta: ResolvedTask;
	/** State node identity. */
	node: string;
	/** Nearest published parent. */
	parent?: string;
	/** Child actor route. */
	path: string[];
	/** Bee dispatch request, absent for driver-handled tasks. */
	request: string | null;
}
export interface Visit {
	/** Explicit generated membership, independent of current chart metadata. */
	scope: "visit" | "group";
	/** Native bead created for this visit. */
	bead: string;
	/** State node visited. */
	node: string;
	/** Published parent. */
	parent: string;
	/** Child actor route. */
	path: string[];
	/** Bee dispatch request, absent for visits without Bee dispatch. */
	request: string | null;
	/** Monotonic visit number for this state. */
	visit: number;
}
export interface Run extends Omit<WorkflowControl, "created"> {
	/** Engine-owned checkpoint encoding, independent of workflow SemVer. */
	formatVersion: typeof FORMAT_VERSION;
	/** Currently published visits. */
	active: ActiveEntry[];
	/** Published visit history. */
	created: Visit[];
	/** Named compatibility identity or explicit-file source. */
	definition: Locator;
	/** Definition fingerprint that produced the saved state. */
	hash: string;
	/** Accepted submissions. */
	history: { bead: string; command: string; data: unknown; request: string | null }[];
	/** Native run bead. */
	id: string;
	/** Engine-persisted actor state. */
	snapshot: Snapshot<unknown>;
	/** Next visit sequence by state. */
	visits: Record<string, number>;
}

export interface Ownership {
	/** Related system record containing state and ownership. */
	checkpoint: string;
	/** This invocation's unique ownership token. */
	owner: string;
	/** Unknown create/dispatch effects require explicit inspection, never replay. */
	uncertainOperation?: string;
	/** Created task identity confirmed before a later publication failure. */
	knownBead?: string;
	/** Request identity confirmed before a later checkpoint failure. */
	knownRequest?: string;
}

/** Decode Busy Bee's own payload after validating the persistence contract header. */
export function readCheckpoint(record: Pick<BeadRecord, "id" | "description">): Run {
	const raw = checkpointJson(record);
	const header = headerSchema.safeParse(raw);
	if (!header.success) {
		throw checkpointHeaderError(record.id, raw, header.error);
	}
	try {
		parseWorkflowControl(record, header.data.id);
	} catch (error) {
		controlFailure(error);
	}
	// Busy Bee owns the opaque snapshot body after header/control validation.
	// TypeScript checks engine construction and writes of that body.
	return raw as Run;
}

/** Select and validate the single related system record without loading a definition. */
export async function checkpointBead(
	endpoint: Endpoint,
	id: string,
	services: Services,
): Promise<BeadRecord> {
	const run = await readBead(endpoint, id, services);
	try {
		const { checkpoint } = await readWorkflowControl(
			services.beads,
			{ cwd: endpoint.repo, db: endpoint.db },
			run,
		);
		readCheckpoint(checkpoint);
		return checkpoint;
	} catch (error) {
		return controlFailure(error);
	}
}

/** Serialize cooperating writers; never steal an occupied owner, including a dead PID. */
// eslint-disable-next-line max-statements -- Keep format rejection and bounded ownership polling together.
export async function acquire(
	endpoint: MutationEndpoint,
	checkpoint: string | BeadRecord,
	services: Services,
): Promise<Ownership> {
	const owner = services.uuid();
	const deadline = services.now() + LOCK_TIMEOUT;
	let bead = await lockCandidate(checkpoint, endpoint, services);
	for (;;) {
		const run = readCheckpoint(bead);
		if (!run.lock) {
			run.lock = { owner, pid: services.pid };
			if (
				// eslint-disable-next-line no-await-in-loop -- Native CAS decides ownership.
				await conditionalUpdate(
					{ endpoint, bead, input: { description: JSON.stringify(run), force: true } },
					services,
				)
			) {
				return { checkpoint: bead.id, owner };
			}
		}
		if (services.now() >= deadline) {
			throw new BusyBeeError(
				"checkpoint_locked",
				`Checkpoint ${bead.id} is locked by ${JSON.stringify(run.lock)}. Inspect its owner ` +
					`and partial effects; there is no automatic expiry.`,
				{ context: { checkpoint: bead.id, runId: run.id } },
			);
		}
		// eslint-disable-next-line no-await-in-loop -- Bounded sequential contention polling.
		await services.sleep(LOCK_POLL);
		// eslint-disable-next-line no-await-in-loop -- Refresh after contention before another CAS.
		bead = await readBead(endpoint, bead.id, services);
	}
}

/** Apply an owner-checked patch to the fresh whole description, preserving all other members. */
export async function patchOwned(
	input: { endpoint: MutationEndpoint; locked: Ownership; patch: (run: Run) => void },
	services: Services,
): Promise<Run> {
	const { endpoint, locked, patch } = input;
	const bead = await readBead(endpoint, locked.checkpoint, services);
	const run = readCheckpoint(bead);
	if (run.lock?.owner !== locked.owner) {
		throw new BusyBeeError("ownership_lost", `Lost workflow lock ${locked.checkpoint}.`, {
			context: { checkpoint: locked.checkpoint, runId: run.id },
		});
	}
	patch(run);
	if (
		!(await conditionalUpdate(
			{ endpoint, bead, input: { description: JSON.stringify(run), force: true } },
			services,
		))
	) {
		throw new BusyBeeError(
			"checkpoint_changed",
			`Checkpoint ${locked.checkpoint} changed while owned by ${locked.owner}.`,
			{ context: { checkpoint: locked.checkpoint, runId: run.id } },
		);
	}
	return run;
}

/** Release known completion failures, but quarantine unknown task/request publication effects. */
// eslint-disable-next-line max-statements -- Release known failures; quarantine unknown publication effects.
export async function withCheckpointOwner<Result>(
	input: { endpoint: MutationEndpoint; lock: Ownership; runId: string; parentId?: string },
	services: Services,
	operation: () => Promise<Result>,
): Promise<Result> {
	const { endpoint, lock, runId, parentId } = input;
	try {
		return await operation();
	} catch (error) {
		if (lock.uncertainOperation) {
			let context: Record<string, unknown> = {};
			if (error instanceof BusyBeeError) {
				({ context } = error);
			}
			throw new BusyBeeError(
				"partial_effects",
				`Mutation failed during ${lock.uncertainOperation}; checkpoint ${lock.checkpoint} ` +
					`remains locked by ${lock.owner}. Inspect known and uncertain effects before explicit ` +
					`recovery.`,
				{
					cause: error,
					context: {
						...context,
						bead: lock.knownBead,
						request: lock.knownRequest,
						checkpoint: lock.checkpoint,
						owner: lock.owner,
						runId,
						parentId,
						uncertainOperation: lock.uncertainOperation,
					},
				},
			);
		}
		if (!(error instanceof BusyBeeError)) {
			throw error;
		}
		throw new BusyBeeError(error.reason, error.message, {
			cause: error,
			context: {
				...error.context,
				checkpoint: lock.checkpoint,
				runId,
				nextAction: `br show ${runId} ${lock.checkpoint} --json`,
			},
		});
	} finally {
		if (!lock.uncertainOperation) {
			await releaseOwner({ endpoint, lock, runId }, services);
		}
	}
}

// --- Private functions ---

async function releaseOwner(
	input: { endpoint: MutationEndpoint; lock: Ownership; runId: string },
	services: Services,
): Promise<void> {
	const { endpoint, lock, runId } = input;
	try {
		await patchOwned(
			{
				endpoint,
				locked: lock,
				patch: (run) => {
					run.lock = null;
				},
			},
			services,
		);
	} catch (error) {
		throw new BusyBeeError(
			"checkpoint_release_failed",
			`Workflow ${runId} effects may be saved, but release of checkpoint ${lock.checkpoint} ` +
				`owner ${lock.owner} is not confirmed. Inspect native state before explicit recovery.`,
			{
				cause: error,
				context: {
					runId,
					checkpoint: lock.checkpoint,
					owner: lock.owner,
					bead: lock.knownBead,
					request: lock.knownRequest,
				},
			},
		);
	}
}

function controlFailure(error: unknown): never {
	if (error instanceof WorkflowControlError) {
		throw new BusyBeeError(error.reason, error.message, {
			cause: error,
			context: { runId: error.runId, checkpoint: error.checkpoint },
		});
	}
	throw error;
}

function lockCandidate(
	checkpoint: string | BeadRecord,
	endpoint: MutationEndpoint,
	services: Services,
): BeadRecord | Promise<BeadRecord> {
	if (typeof checkpoint === "string") {
		return readBead(endpoint, checkpoint, services);
	}
	return checkpoint;
}

function checkpointJson(record: Pick<BeadRecord, "id" | "description">): unknown {
	try {
		return JSON.parse(record.description) as unknown;
	} catch (error) {
		throw new BusyBeeError("invalid_checkpoint", `Checkpoint ${record.id} contains invalid JSON.`, {
			cause: error,
			context: { checkpoint: record.id },
		});
	}
}

// eslint-disable-next-line max-statements -- Keep version diagnosis and identity-scoped recovery in one error contract.
function checkpointHeaderError(checkpoint: string, raw: unknown, cause: unknown): BusyBeeError {
	const format = formatSchema.safeParse(raw).data?.formatVersion;
	let reason = "unsupported_checkpoint_format";
	if (format === FORMAT_VERSION) {
		reason = "invalid_checkpoint";
	}
	const context: Record<string, unknown> = {
		checkpoint,
		formatVersion: format,
		supportedFormatVersion: FORMAT_VERSION,
	};
	const identity = identitySchema.safeParse(raw);
	let guidance =
		"Finish the saved run with matching old tools, or deliberately create a fresh run " +
		"within existing authorization after inspecting effects and preserving evidence. " +
		"Old-run disposition and live cutover need their own authority; no migration is supported.";
	if (identity.success) {
		context["name"] = identity.data.definition.name;
		guidance =
			`Finish named workflow ${identity.data.definition.name} with matching old tools, or ` +
			"deliberately create a fresh run of that same existing workflow for the same " +
			"already-authorized scope. Inspect prior/uncertain effects and preserve the old run " +
			"and evidence. If its name is missing, ask which workflow to use. Old-run disposition " +
			"and live cutover need their own authority; no migration or automatic cutover is supported.";
	}
	return new BusyBeeError(
		reason,
		`Cannot decode checkpoint ${checkpoint} with engine format ${String(format)}. ${guidance}`,
		{ cause, context },
	);
}
