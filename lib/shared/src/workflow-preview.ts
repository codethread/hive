import { z } from "zod";

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
