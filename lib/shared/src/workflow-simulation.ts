import { workflowInspectionSchema } from "./workflow-preview.ts";
import { z } from "zod";

const FORMAT_VERSION = 1;
const text = z.string().nonempty();
// JSON has no undefined value. Unlike z.unknown(), json() also requires field presence.
const payload = z.json();
const savedStartSchema = z.strictObject({ kind: z.literal("saved") });
const initialStartSchema = z.strictObject({ kind: z.literal("initial"), input: payload });
const eventSchema = z.strictObject({ node: text, command: text, data: payload });
const choiceSchema = z.object({
	node: text,
	title: text,
	command: text,
	event: text,
	schema: z.record(z.string(), z.unknown()),
});

/** Stateless replay against a specific saved checkpoint and current definition. */
export const workflowSimulationRequestSchema = z.strictObject({
	checkpoint: text,
	savedAt: text,
	definitionHash: text,
	actorId: text,
	start: z.discriminatedUnion("kind", [savedStartSchema, initialStartSchema]),
	events: z.array(eventSchema),
});

/** Public simulation projection; private context and executable metadata stay in Busy Bee. */
export const workflowSimulationSchema = z.object({
	formatVersion: z.literal(FORMAT_VERSION),
	runId: text,
	actor: workflowInspectionSchema.shape.actors.element,
	choices: z.array(choiceSchema),
	inputSchema: z.record(z.string(), z.unknown()),
});

export type WorkflowSimulationRequest = z.infer<typeof workflowSimulationRequestSchema>;
export type WorkflowSimulation = z.infer<typeof workflowSimulationSchema>;
