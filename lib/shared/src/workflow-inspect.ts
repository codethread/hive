import { workflowInspectionSchema, workflowPreviewSchema } from "./workflow-preview.ts";
import { workflowLifecycleSchema } from "./workflow-lifecycle.ts";
import { z } from "zod";

const NONEMPTY = 1;
const text = z.string().min(NONEMPTY);
const choiceSchema = z.object({ choice: text, schema: z.record(z.string(), z.unknown()) });
const contextSchema = z.record(z.string(), z.unknown());
const workEntrySchema = z
	.object({
		bead: text,
		title: text,
		instructions: z.string(),
		context: contextSchema,
		commands: z.array(text),
		path: z.array(text),
		request: text.nullable(),
		choices: z.array(choiceSchema),
		constraints: z.unknown().optional(),
	})
	.passthrough();
const advanceVisitSchema = z.object({ bead: text, request: text.nullable() });

/** Executable work expansion; native lifecycle remains independently available. */
export const workflowWorkSchema = z.object({
	/** Owning workflow run. */
	id: text,
	/** Restored actor status, independent of native disposition. */
	status: text,
	/** Checkpoint sampled for this work expansion, independently of lifecycle inspection. */
	checkpoint: text,
	/** Native update time of this work expansion's own checkpoint sample. */
	savedAt: text,
	/** Published visits and their frozen briefs with author-provided outcome schemas. */
	active: z.array(workEntrySchema),
	/** General completion constraints, without claiming a reservation. */
	constraints: text,
});
export type WorkflowWork = z.infer<typeof workflowWorkSchema>;

/** One explicitly requested expansion can fail without losing native lifecycle facts. */
function expansionSchema<Value extends z.ZodType>(value: Value) {
	return z.discriminatedUnion("kind", [
		z.object({ kind: z.literal("available"), data: value }),
		z.object({
			kind: z.literal("unavailable"),
			reason: text,
			message: text,
			context: contextSchema,
		}),
	]);
}

export const workflowInstructionDiagramSchema = z.object({
	kind: z.literal("available"),
	mode: z.literal("instructions"),
	data: workflowInspectionSchema,
});
export const workflowUnavailableDiagramSchema = z.object({
	kind: z.literal("unavailable"),
	reason: text,
	message: text,
	context: z.record(z.string(), z.unknown()).optional(),
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

/** Public run inspection with optional independently classified executable expansions. */
export const workflowRunInspectionSchema = workflowLifecycleSchema.extend({
	/** Present only when the caller requests the executable work frontier. */
	work: expansionSchema(workflowWorkSchema).optional(),
	/** Present only when the caller requests a saved diagram, optionally with instructions. */
	diagram: workflowDiagramResultSchema.optional(),
});
export type WorkflowRunInspection = z.infer<typeof workflowRunInspectionSchema>;

/** Acknowledgment of result consumption or driver preparation, without task bodies or visit history. */
export const workflowAdvanceSchema = z.discriminatedUnion("mode", [
	z.object({
		mode: z.literal("results"),
		runId: text,
		status: text,
		active: z.array(advanceVisitSchema),
	}),
	z.object({
		mode: z.literal("prepare-driver"),
		runId: text,
		status: text,
		checkpoint: text,
	}),
]);
