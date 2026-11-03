import { limitsSchema, policyChangeSchema } from "./bees.ts";
import { requestOutcomeSchema, requestStateSchema } from "./spawn-request.ts";
import { z } from "zod";

const NONEMPTY = 1;
const text = z.string().min(NONEMPTY);
const clearanceRequestSchema = z.strictObject({
	id: text,
	proof: z.enum(["never-launched", "stopped"]),
	attemptIds: z.array(text),
});
const clearanceBlockerSchema = z.strictObject({
	reason: text,
	requestId: z.string().nullable(),
	attemptId: z.string().nullable(),
});
const clearExecutionSchema = z.strictObject({
	kind: z.literal("clear"),
	/** No-managed-requests is a scoped absence proof, not a process-exit event. */
	proof: z.enum(["no-managed-requests", "requests-cleared"]),
	requests: z.array(clearanceRequestSchema),
});
const refusedExecutionSchema = z.strictObject({
	kind: z.literal("refused"),
	/** Concrete missing authority, reservation, live process or inventory disagreement. */
	blockers: z.array(clearanceBlockerSchema).min(NONEMPTY),
});

export const COLONY_MANUAL_EXECUTION_PREFIX = "Colony manual execution:";
export const executionClearanceSelectionSchema = z.strictObject({
	/** Owning workflow run, whose checkpoint admission fence is held by the caller. */
	runId: z.string().min(NONEMPTY),
	/** Exact run and generated visit/group IDs inspected by Busy Bee. */
	anchorIds: z.array(z.string().min(NONEMPTY)).min(NONEMPTY),
});
export type ExecutionClearanceSelection = z.infer<typeof executionClearanceSelectionSchema>;

export const executionClearanceSchema = z.strictObject({
	kind: z.literal("execution-clearance"),
	/** Selected daemon endpoint; this observation grants no foreign-host authority. */
	repository: z.strictObject({ root: text, beadsDb: text }),
	/** Actual owning host performing the fresh execution observations. */
	host: z.string().min(NONEMPTY),
	/** Time the serialized observation completed; not a durable execution lease. */
	observedAt: z.string().min(NONEMPTY),
	/** Complete bounded inventory covered by this observation. */
	scope: executionClearanceSelectionSchema,
	result: z.discriminatedUnion("kind", [clearExecutionSchema, refusedExecutionSchema]),
});
export type ExecutionClearance = z.infer<typeof executionClearanceSchema>;

/** Repository authority crosses the socket as a pair, independent of daemon cwd. */
export const repositoryEndpointSchema = z.strictObject({
	/** Absolute selected Beads database. */
	beadsDb: z.string().min(NONEMPTY),
	/** Absolute canonical worktree. */
	root: z.string().min(NONEMPTY),
});

/** The daemon's recorded attempt state; task completion is a separate fact. */
export const attemptStatusSchema = z.strictObject({
	/** Stable execution attempt identity. */
	id: z.string().min(NONEMPTY),
	/** Spawn request in the enclosing repository's tracker. */
	spawnId: z.string().min(NONEMPTY),
	/** Last observed process state. */
	state: z.enum(["starting", "running", "exited", "failed"]),
});

const colonyFields = {
	/** Recorded attempts retained by the daemon. */
	attempts: z.array(attemptStatusSchema),
	/** Intended activity retained for durable membership. */
	intent: z.enum(["awake", "asleep"]),
	/** Effective scheduling policy, absent while asleep or config loading failed. */
	policy: z
		.strictObject({ limits: limitsSchema, ranking: z.enum(["bv-pagerank", "fifo"]) })
		.nullable(),
	/** Whether membership survives daemon exit. */
	registration: z.enum(["durable", "temporary"]),
	/** Repository and tracker served by this loop. */
	repository: repositoryEndpointSchema,
};

/** A failed loop carries the diagnostic needed to resume useful work. */
export const colonyStatusSchema = z.discriminatedUnion("state", [
	z.strictObject({ ...colonyFields, state: z.literal("awake") }),
	z.strictObject({ ...colonyFields, state: z.literal("asleep") }),
	z.strictObject({
		...colonyFields,
		message: z.string(),
		state: z.literal("failed"),
	}),
]);

const [awakeColonySchema, asleepColonySchema, failedColonySchema] = colonyStatusSchema.options;
/** Live membership and policy metadata, excluding retained attempt history. */
export const colonySummarySchema = z.discriminatedUnion("state", [
	awakeColonySchema.omit({ attempts: true }),
	asleepColonySchema.omit({ attempts: true }),
	failedColonySchema.omit({ attempts: true }),
]);

/** Explicit live configuration operations never patch recipe defaults. */
export const configCommandSchema = z.discriminatedUnion("operation", [
	z.strictObject({ operation: z.literal("show") }),
	z.strictObject({ operation: z.literal("history") }),
	z.strictObject({ actor: z.string().min(NONEMPTY), operation: z.literal("reset") }),
	z.strictObject({
		actor: z.string().min(NONEMPTY),
		change: policyChangeSchema,
		operation: z.literal("update"),
	}),
]);

/** Generic inspection names active formulas without exposing their argument values. */
export const policyViewSchema = z.strictObject({
	formulas: z.array(z.string()),
	limits: limitsSchema,
	maxRetries: z.number().int().nonnegative(),
	ranking: z.enum(["bv-pagerank", "fifo"]),
	retryDelayMs: z.number().int().nonnegative(),
	revisionId: z.string(),
});

/** Audit metadata attributes commands, without inferring who authored a config file. */
export const policyRevisionSchema = z.strictObject({
	actor: z.string().nullable(),
	createdAt: z.string(),
	formulaName: z.string().nullable(),
	id: z.string(),
	source: z.enum(["canonical", "formula", "limits", "reset"]),
});

/** Durable request checkpoint, last reconciled by an awake pass rather than current tracker state. */
export const requestCheckpointViewSchema = z.strictObject({
	/** Current attempt, absent before launch or after settlement. */
	attemptId: z.string().nullable(),
	/** Number of attempts reserved for this request. */
	attempts: z.number().int().nonnegative(),
	/** Stable spawn request identifier. */
	id: z.string(),
	/** Captured friendly identity for every attempt. */
	identity: z.string(),
	/** Last checkpoint diagnostic; does not contain worker logs. */
	message: z.string(),
	/** Recorded settlement decision, independent of native closure. */
	outcome: requestOutcomeSchema.nullable(),
	/** Earliest retry time in epoch milliseconds, when scheduled. */
	retryAt: z.number().nullable(),
	/** Last persisted request lifecycle state. */
	state: requestStateSchema,
	/** Captured related task identifiers. */
	taskIds: z.array(z.string()),
});

/** Safe receipt metadata and local artifact locations, excluding execution arguments and tokens. */
export const attemptDetailsSchema = attemptStatusSchema.extend({
	/** One-based attempt number within its request. */
	attemptNumber: z.number().int().positive(),
	/** Canonical capacity bucket. */
	bucket: z.string(),
	/** Immutable receipt creation time. */
	createdAt: z.string(),
	/** Captured execution directory. */
	cwd: z.string(),
	/** Captured harness choice. */
	harness: z.string(),
	/** Captured friendly execution identity. */
	identity: z.string(),
	/** Captured bee kind. */
	kind: z.string(),
	/** Captured model choice. */
	model: z.string(),
	/** Owned artifact locations; individual files may not yet exist. */
	paths: z.strictObject({
		/** Immutable launch receipt, containing private execution inputs. */
		receipt: z.string(),
		/** Harness standard error log. */
		stderr: z.string(),
		/** Harness standard output log. */
		stdout: z.string(),
		/** Supervisor startup log. */
		supervisor: z.string(),
		/** Worker lifecycle receipt. */
		worker: z.string(),
	}),
	/** Policy revision used to prepare this attempt. */
	policyRevisionId: z.string().nullable(),
	/** Task identifiers authorized by this receipt. */
	taskIds: z.array(z.string()),
});

/** One operation per HTTP request on the selected local Unix socket. */
export const colonyRequestSchema = z.discriminatedUnion("kind", [
	z.strictObject({
		kind: z.literal("execution-clearance"),
		repository: repositoryEndpointSchema,
		scope: executionClearanceSelectionSchema,
	}),
	z.strictObject({ kind: z.literal("status") }),
	/** Poll recovery: return recovering until each installed colony has reached idle, asleep or failed, then status. */
	z.strictObject({ kind: z.literal("recover") }),
	z.strictObject({ kind: z.literal("inspect"), repository: repositoryEndpointSchema }),
	z.strictObject({
		/** Read one request's retained evidence without reconciliation. */
		kind: z.literal("inspect-request"),
		/** Canonical repository and selected tracker authority. */
		repository: repositoryEndpointSchema,
		/** Spawn request whose checkpoint and complete attempt history are selected. */
		requestId: z.string().min(NONEMPTY),
	}),
	/** Bind stop to the caller's observed daemon lifetime with expectedId. */
	z.strictObject({ kind: z.literal("stop"), expectedId: z.string().optional() }),
	z.strictObject({
		kind: z.literal("wake"),
		repository: repositoryEndpointSchema,
		temporary: z.boolean(),
	}),
	z.strictObject({ kind: z.literal("add"), repository: repositoryEndpointSchema }),
	z.strictObject({ kind: z.literal("sleep"), repository: repositoryEndpointSchema }),
	z.strictObject({ kind: z.literal("remove"), repository: repositoryEndpointSchema }),
	z.strictObject({
		command: configCommandSchema,
		kind: z.literal("config"),
		repository: repositoryEndpointSchema,
	}),
]);

const registrationHandoffSchema = z.strictObject({
	repository: repositoryEndpointSchema,
	intent: z.enum(["awake", "asleep"]),
	attempts: z.array(attemptStatusSchema),
});

/** Drained durable registrations and attempts; acknowledgment precedes final daemon exit. */
export const daemonStopResponseSchema = z.strictObject({
	kind: z.literal("stopped"),
	id: z.string(),
	registrations: z.array(registrationHandoffSchema),
});

const occupantSchema = z.strictObject({
	/** Captured canonical capacity bucket. */
	bucket: z.string(),
	/** Captured bee kind occupying this slot. */
	kind: z.string(),
});

/** Current daemon observation, also retained in restart receipts; status alone does not prove recovery. */
export const daemonStatusResponseSchema = z.strictObject({
	/** Registered colonies with their current activity and retained attempts. */
	colonies: z.array(colonyStatusSchema),
	/** Identifier for this daemon process lifetime. */
	id: z.string(),
	/** Full daemon observation; recovery callers must also verify its contents. */
	kind: z.literal("status"),
	/** Operating-system process identifier for this daemon. */
	pid: z.number().int().positive(),
	/** Absolute Unix socket served by this daemon. */
	socket: z.string(),
	/** Absolute state directory owned by this daemon. */
	state: z.string(),
});

/** Public responses are validated by the CLI at the transport boundary. */
export const colonyResponseSchema = z.discriminatedUnion("kind", [
	executionClearanceSchema,
	z.strictObject({
		/** All retained attempts for the selected request, including exited and failed attempts. */
		attempts: z.array(attemptDetailsSchema),
		/** Last persisted checkpoint for the selected request, or null when absent. */
		checkpoint: requestCheckpointViewSchema.nullable(),
		/** Current membership and policy metadata, or null without a colony in this daemon. */
		colony: colonySummarySchema.nullable(),
		/** Focused response to inspect-request. */
		kind: z.literal("request-inspection"),
		/** Inspection time; neither checkpoint age nor reconciliation time. */
		observedAt: z.string(),
		/** One entry per starting/running attempt bound by its request checkpoint to this host; duplicates count. */
		occupied: z.array(occupantSchema),
		/** Canonical repository and selected tracker for these reads. */
		repository: repositoryEndpointSchema,
	}),
	z.strictObject({
		attempts: z.array(attemptDetailsSchema),
		/** Current membership, absent after removal or before registration. */
		colony: colonyStatusSchema.nullable(),
		history: z.array(policyRevisionSchema),
		kind: z.literal("inspection"),
		/** Time these local receipts and checkpoints were inspected. */
		observedAt: z.string(),
		repository: repositoryEndpointSchema,
		requests: z.array(requestCheckpointViewSchema),
	}),
	daemonStatusResponseSchema,
	/** Recovery is still pending; identity fields bind subsequent probes to this daemon. */
	daemonStatusResponseSchema.omit({ colonies: true }).extend({ kind: z.literal("recovering") }),
	daemonStopResponseSchema,
	z.strictObject({ kind: z.literal("awake"), repository: repositoryEndpointSchema }),
	z.strictObject({ kind: z.literal("registered"), repository: repositoryEndpointSchema }),
	z.strictObject({ kind: z.literal("slept"), repository: repositoryEndpointSchema }),
	z.strictObject({
		attempts: z.array(attemptStatusSchema),
		kind: z.literal("removed"),
		repository: repositoryEndpointSchema,
	}),
	z.strictObject({ kind: z.literal("error"), message: z.string() }),
	z.strictObject({
		active: policyViewSchema.nullable(),
		history: z.array(policyRevisionSchema),
		kind: z.literal("config"),
		repository: repositoryEndpointSchema,
	}),
]);

export type ColonyRequest = z.infer<typeof colonyRequestSchema>;
export type ColonyResponse = z.infer<typeof colonyResponseSchema>;
export type ColonyStatus = z.infer<typeof colonyStatusSchema>;
export type AttemptStatus = z.infer<typeof attemptStatusSchema>;
export type ConfigCommand = z.infer<typeof configCommandSchema>;
export type PolicyView = z.infer<typeof policyViewSchema>;
export type PolicyRevision = z.infer<typeof policyRevisionSchema>;

export type RequestCheckpointView = z.infer<typeof requestCheckpointViewSchema>;
export type AttemptDetails = z.infer<typeof attemptDetailsSchema>;
export type ColonyInspection = Extract<ColonyResponse, { kind: "inspection" }>;

export type ColonyRequestInspection = Extract<ColonyResponse, { kind: "request-inspection" }>;
