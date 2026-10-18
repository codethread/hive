import { workflowInspectionSchema, workflowPreviewSchema } from "./workflow-preview.ts";
import { workflowLifecycleSchema } from "./workflow-lifecycle.ts";
import { z } from "zod";

export const workflowInstructionDiagramSchema = z.object({
	kind: z.literal("available"),
	mode: z.literal("instructions"),
	data: workflowInspectionSchema,
});
export const workflowUnavailableDiagramSchema = z.object({
	kind: z.literal("unavailable"),
	reason: z.string(),
	message: z.string(),
});
export const workflowDiagramResultSchema = z.union([
	z.object({
		kind: z.literal("available"),
		mode: z.literal("structure"),
		data: workflowPreviewSchema,
	}),
	workflowInstructionDiagramSchema,
	workflowUnavailableDiagramSchema,
]);

export const workflowRunInspectionSchema = workflowLifecycleSchema.extend({
	/** Explicit expansion; omission preserves the source-independent lifecycle-only read. */
	diagram: workflowDiagramResultSchema.optional(),
});
export type WorkflowRunInspection = z.infer<typeof workflowRunInspectionSchema>;
