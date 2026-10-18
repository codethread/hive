import { z } from "zod";

const INSPECTION_FORMAT_VERSION = 1;

/** Public checkpoint identity and native update time. */
export const workflowCheckpointSchema = z.object({
	runId: z.string(),
	checkpoint: z.string(),
	savedAt: z.string(),
});
export type WorkflowCheckpoint = z.infer<typeof workflowCheckpointSchema>;

type StateValue = string | { [key: string]: StateValue };
const stateValueSchema: z.ZodType<StateValue> = z.union([
	z.string(),
	z.record(
		z.string(),
		z.lazy(() => stateValueSchema),
	),
]);
const snapshotSchema = z.object({
	value: stateValueSchema,
	status: z.enum(["active", "done", "error", "stopped"]),
});
const actorSchema = z.object({
	id: z.string(),
	path: z.array(z.string()),
	machine: z.record(z.string(), z.unknown()),
	snapshot: snapshotSchema,
});

/** Structural workflow data and saved state, without executable code or actor context. */
export const workflowPreviewSchema = z.object({
	runId: z.string(),
	title: z.string(),
	checkpoint: z.string(),
	savedAt: z.string(),
	definition: z.object({
		label: z.string(),
		savedHash: z.string(),
		currentHash: z.string(),
		sourceMatch: z.enum(["exact", "compatible"]),
	}),
	actors: z.array(actorSchema),
});

export type WorkflowPreview = z.infer<typeof workflowPreviewSchema>;

const authoredBeeSchema = z.object({ kind: z.string() });
const publishedBeeSchema = authoredBeeSchema.extend({ request: z.string() });
const instructionSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("frozen"),
		title: z.string(),
		instructions: z.string(),
		bead: z.string(),
		bee: publishedBeeSchema.optional(),
	}),
	z.object({
		kind: z.literal("rendered"),
		title: z.string(),
		instructions: z.string(),
		bee: authoredBeeSchema.optional(),
	}),
	z.object({ kind: z.literal("none") }),
	z.object({ kind: z.literal("unavailable"), message: z.string() }),
]);

/** Tooling inspection with frozen published briefs and labelled saved-context previews. */
const inspectionActorSchema = actorSchema.extend({
	instructions: z.record(z.string(), instructionSchema),
});
export const workflowInspectionSchema = workflowPreviewSchema.extend({
	formatVersion: z.literal(INSPECTION_FORMAT_VERSION),
	actors: z.array(inspectionActorSchema),
});

export type WorkflowInspection = z.infer<typeof workflowInspectionSchema>;
