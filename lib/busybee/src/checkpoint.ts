import type { BeadRecord } from "@hive/beads";
import { BusyBeeError } from "./native.ts";
import type { ResolvedTask } from "./definition.ts";
import type { Snapshot } from "xstate";
import { workflowVersionSchema } from "./compatibility.ts";
import { z } from "zod";

const FORMAT_VERSION = 1;
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
	/** Automatic Bee request, absent for manual tasks. */
	request: string | null;
}
export interface Visit {
	/** Native bead created for this visit. */
	bead: string;
	/** State node visited. */
	node: string;
	/** Published parent. */
	parent: string;
	/** Child actor route. */
	path: string[];
	/** Automatic Bee request. */
	request: string | null;
	/** Monotonic visit number for this state. */
	visit: number;
}
export interface Run {
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

/** Decode Busy Bee's own payload after validating the persistence contract header. */
export function readCheckpoint(record: Pick<BeadRecord, "id" | "description">): Run {
	const raw = checkpointJson(record);
	const header = headerSchema.safeParse(raw);
	if (!header.success) {
		throw checkpointHeaderError(record.id, raw, header.error);
	}
	// Busy Bee owns the body producer. A recognized header establishes the trust
	// Contract; TypeScript checks engine construction and writes of its payload.
	return raw as Run;
}

// --- Private functions ---

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
	let guidance = "Create a fresh run with the installed engine; do not migrate the saved snapshot.";
	if (identity.success) {
		context["name"] = identity.data.definition.name;
		guidance =
			`Inspect whether named workflow ${identity.data.definition.name}` +
			" still exists. If it exists, you may create a fresh run of that same " +
			"workflow for the same already-authorized scope without asking again; " +
			"inspect completed and uncertain effects and preserve the old run and " +
			"evidence. If it is missing, stop and ask the user which workflow to " +
			"use. Do not migrate the saved snapshot.";
	}
	return new BusyBeeError(
		reason,
		`Cannot decode checkpoint ${checkpoint} with engine format ${String(format)}. ${guidance}`,
		{ cause, context },
	);
}
