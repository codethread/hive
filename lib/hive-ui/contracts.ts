import { nativeWorkflowStateSchema } from "@hive/shared/workflow-lifecycle";
import { z } from "zod";
/* eslint-disable unicorn/max-nested-calls -- Boundary schemas keep complete discriminated variants visible together. */

export {
	workflowInspectionSchema,
	workflowCheckpointSchema,
	type WorkflowCheckpoint,
	workflowPreviewSchema,
	type WorkflowInspection,
	type WorkflowPreview,
} from "@hive/shared/workflow-preview";
export {
	workflowSimulationRequestSchema,
	workflowSimulationSchema,
	type WorkflowSimulationRequest,
	type WorkflowSimulation,
} from "@hive/shared/workflow-simulation";

export const PAGE_SIZE = 60;
export const ANNOTATION_BATCH = 100;
export const REQUEST_PAGE_SIZE = 50;
export const RELATION_LIMIT = 50;
export const boardScopeSchema = z.object({
	/** Zero-based completed request history page; other views use page zero. */
	requestPage: z.number().int().nonnegative().default(0),
	/** Ordinary task board, open Bee requests or completed Bee requests. */
	view: z.enum(["beads", "open", "completed"]).default("open"),
});
export const DEFAULT_BEAD_STATUSES = [
	"open",
	"in_progress",
	"blocked",
	"draft",
	"closed",
	"tombstone",
	"pinned",
];
export const beadStatusSchema = z.string().min(1);
const BACKLOG_PRIORITY = 4;

/** A view is a reusable predicate over ordinary task beads, independent of navigation. */
export const beadFilterSchema = z.object({
	/** Every exact label must occur on the same task; native --label arguments. */
	all: z.array(z.string().min(1)).default([]),
	/** At least one exact label must occur on a task; native --label-any arguments. */
	any: z.array(z.string().min(1)).default([]),
	/** Include closed tasks; an explicit Closed status also enables native --all. */
	closed: z.boolean().default(false),
	/** Hide tasks carrying any of these exact labels; native --exclude-label arguments. */
	exclude: z.array(z.string().min(1)).default([]),
	/** Any selected native priorities (0 critical through 4 backlog), intersected with other rules. */
	priorities: z.array(z.number().int().min(0).max(BACKLOG_PRIORITY)).default([]),
	/** Text passed unchanged to native br search; empty selects br list. */
	query: z.string().default(""),
	/** Any selected native statuses, intersected with priority, text and label filters. */
	statuses: z.array(beadStatusSchema).default([]),
});
export const inventoryFilterSchema = boardScopeSchema.extend(beadFilterSchema.shape);
export const boardFilterSchema = inventoryFilterSchema.extend({
	/** Zero-based page of matching ordinary or selected-request task beads. */
	page: z.number().int().nonnegative().default(0),
	/** Selected request narrows linked work; absent for ordinary beads. */
	request: z.string().optional(),
});
export const navigationSchema = boardFilterSchema.extend({
	/** Browser entry point, independent of the API's request-scope default. */
	view: boardScopeSchema.shape.view.default("beads"),
	/** One explicitly expanded ancestry chain, never a whole-history scan. */
	ancestry: z.string().optional(),
	/** Selected bead ID opens the detail inspector. */
	bead: z.string().optional(),
	/** Browser-only search over the loaded request page. */
	beeQuery: z.string().default(""),
	/** Dedicated outline of one bead and every native descendant, independent of board filters. */
	outline: z.string().optional(),
	/** Presentation of the same loaded request and ancestry data. */
	presentation: z.enum(["outline", "graph"]).default("outline"),
});
export const colonySchema = z.object({
	/** Explicit native tracker database path resolved at server startup. */
	beadsDb: z.string(),
	/** Stable server-derived identifier for the configured root/database pair. */
	id: z.string(),
	/** Configured display name used by the colony switcher. */
	name: z.string(),
	/** Resolved repository root for native reads. */
	root: z.string(),
	/** Standard UI statuses plus workflow statuses loaded from this endpoint's tracker policy. */
	statuses: z.array(beadStatusSchema),
});
export const coloniesSchema = z.object({
	/** Startup-configured endpoints available to this local UI. */
	colonies: z.array(colonySchema),
});
export const observationSchema = z.object({
	/** Original native comment timestamp, not the time this UI read it. */
	at: z.string(),
	/** Recorded comment author, without an inference about current ownership. */
	author: z.string(),
	/** Native comment body; Colony observations omit their marker prefix. */
	text: z.string(),
});
export const beeSchema = z.object({
	/** Native closure timestamp, absent while the request is open. */
	closedAt: z.string().nullable(),
	/** Harness captured in the spawn request recipe. */
	harness: z.string(),
	/** Native spawn request bead ID. */
	id: z.string(),
	/** Friendly identity recorded on this request; not globally unique. */
	identity: z.string(),
	/** Bee kind captured in the request recipe. */
	kind: z.string(),
	/** Model captured in the request recipe. */
	model: z.string(),
	/** Failed request still unresolved according to native acknowledgment/supersession facts. */
	needsAttention: z.boolean(),
	/** Latest recorded Colony observation, or null when none exists. */
	observation: observationSchema.nullable(),
	/** Outcome derived from native request status and close reason. */
	outcome: z.enum(["pending", "succeeded", "failed", "cancelled"]),
	/** Native created_by attribution, or null when unrecorded; not a parent ID. */
	requester: z.string().nullable(),
	/** Native request bead status, separate from execution observations. */
	status: z.string(),
	/** Latest stdout evidence for the published attempt; never inferred from assignment. */
	stdout: z
		.object({
			/** Published attempt identity, kept separate from request identity. */
			attemptId: z.string(),
			/** Attempt ordinal accompanying the original output evidence. */
			attemptNumber: z.number().int().positive(),
			/** Source output time; null means the published attempt has no observed output. */
			lastOutputAt: z.iso.datetime({ precision: 3 }).nullable(),
			/** Publication time, not a substitute for lastOutputAt. */
			recordedAt: z.iso.datetime({ precision: 3 }),
		})
		.nullable(),
	/** Related task bead IDs recording requested work, not current claims. */
	taskIds: z.array(z.string()),
});
export const mergeDescriptionSchema = z.object({
	/** Provider URL opened directly from the linked task. */
	url: z.url({ protocol: /^https?$/u }),
	/** Source branch recorded on the merge bead. */
	branch: z.string().min(1),
	/** Recorded resolution; draft and open requests are active. */
	resolution: z.enum(["active", "abandoned", "merged"]),
});
export const mergeLinkSchema = z.discriminatedUnion("kind", [
	mergeDescriptionSchema.extend({
		/** Successfully parsed merge record. */
		kind: z.literal("valid"),
		/** Native merge bead identity. */
		id: z.string(),
		/** Merge request title recorded on the merge bead. */
		title: z.string(),
	}),
	z.object({
		/** Malformed merge record; the task remains browsable. */
		kind: z.literal("invalid"),
		/** Native bead to open for inspection and correction. */
		id: z.string(),
		/** Recorded title retained even when the description is malformed. */
		title: z.string(),
		/** Parse or lifecycle failure displayed on the warning link. */
		problem: z.string(),
	}),
]);
export const cardSchema = z.object({
	/** Native task assignee, or null when unassigned. */
	assignee: z.string().nullable(),
	/** Native accountable human, or null when no owner is recorded. */
	owner: z.string().nullable(),
	/** Open linked requests whose identity matches this in-progress task's native assignee. */
	beeAssignments: z.array(beeSchema.pick({ id: true, kind: true, stdout: true })),
	/** Native task bead ID used for selection and detail reads. */
	id: z.string(),
	/** Native bead type, including tracker-defined custom types. */
	issueType: z.string(),
	/** Workflow-generated record (run, group or work visit) indexed by a workflow system bead. */
	isWorkflowGenerated: z.boolean(),
	/** Exact native labels retained for display and filter actions. */
	labels: z.array(z.string()),
	/** Merge records connected to this task by nonblocking relates-to edges. */
	merges: z.array(mergeLinkSchema),
	/** Native numeric task priority; lower values are more urgent. */
	priority: z.number().int(),
	/** Native task status used to group board columns. */
	status: z.string(),
	/** Native task title displayed as the card heading. */
	title: z.string(),
	/** Native last-update timestamp, retained without refreshing its meaning. */
	updatedAt: z.string(),
});
export const cardAnnotationsSchema = z.object({
	cards: z.array(
		cardSchema
			.pick({
				id: true,
				updatedAt: true,
				status: true,
				assignee: true,
				beeAssignments: true,
				merges: true,
			})
			.extend({
				/** Source-read versions retained across cached and overlapping batches. */
				sources: z.object({ merges: z.number(), assignments: z.number() }),
			}),
	),
	fetchedAt: z.string(),
});
export type CardAnnotations = z.infer<typeof cardAnnotationsSchema>;
export const hierarchySchema = z.object({
	/** Exported membership may be stale even when native card fields are current. */
	stale: z.boolean(),
	/** Full summaries in the requested native parent-child branches, including closed beads. */
	nodes: z.array(
		cardSchema.extend({
			/** Recorded parents, never inferred from dependencies or bead ID punctuation. */
			parentIds: z.array(z.string()),
		}),
	),
	/** Source-observation start time retained through native branch hydration. */
	fetchedAt: z.string(),
});
export const requestInventorySchema = z.discriminatedUnion("kind", [
	z.object({
		/** Ordinary-bead browsing does not request a Bee inventory; assignment enrichment is separate. */
		kind: z.literal("not_requested"),
	}),
	z.object({
		/** Requests in the selected, bounded inventory page. */
		bees: z.array(beeSchema),
		/** Unique all-history requester matches; render only loaded endpoints. */
		requestParents: z.array(z.object({ parent: z.string(), child: z.string() })),
		/** Candidate requests on this history page before task filtering. */
		total: z.number().int().nonnegative(),
		/** Lookahead found another completed request page. */
		hasMore: z.boolean(),
		/** Native request inventory was read for this view. */
		kind: z.literal("loaded"),
		/** Original inventory read time, retained when the cached value is reused. */
		readAt: z.string(),
	}),
]);
export const boardSchema = z.object({
	/** Matching task summaries in the current bounded page. */
	cards: z.array(cardSchema),
	/** Server timestamp when this board read completed. */
	fetchedAt: z.string(),
	/** Native lookahead found another matching task page. */
	hasMore: z.boolean(),
	/** Unique labels from this page, offered as filter suggestions. */
	labels: z.array(z.string()),
	/** Exact argv preview; the server executes it without a shell. */
	query: z.array(z.string()),
});
export const relationSchema = z.object({
	/** Exact native relation type, retained verbatim for display. */
	dependencyType: z.string(),
	/** Native ID of the other bead connected by this edge. */
	id: z.string(),
	/** Other bead's native priority from the relation summary. */
	priority: z.number().int(),
	/** Other bead's native status from the relation summary. */
	status: z.string(),
	/** Other bead's native title from the relation summary. */
	title: z.string(),
});
export const relationsSchema = z.object({
	/** Summaries already present on the selected native show, capped per direction. */
	items: z.array(relationSchema).max(RELATION_LIMIT),
	/** Full number of native edges in this direction, including omitted summaries. */
	total: z.number().int().nonnegative(),
});
export const detailSchema = z.object({
	/** Verbatim native acceptance_criteria Markdown; empty when none were recorded. */
	acceptanceCriteria: z.string(),
	/** Selected bead summary with attribution from the current raw request page. */
	card: cardSchema.extend({
		/** Requests on the loaded page that link this task; empty in ordinary Beads. */
		bees: z.array(beeSchema),
	}),
	/** Comment bodies render as Markdown; comments load only with the selected bead. */
	comments: z.array(
		observationSchema.extend({
			/** Native comment ID used to distinguish entries on the selected bead. */
			id: z.number().int(),
		}),
	),
	/** Native outgoing edges: selected bead is the edge source. */
	dependencies: relationsSchema,
	/** Native incoming edges: selected bead is the edge target. */
	dependents: relationsSchema,
	/** Native bead description rendered as Markdown in the inspector. */
	description: z.string(),
	/** Verbatim native design Markdown; empty when no design was recorded. */
	design: z.string(),
	/** Verbatim native notes Markdown; empty when no notes were recorded. */
	notes: z.string(),
	/** Server timestamp when this selected-bead read completed. */
	fetchedAt: z.string(),
});
export const provenanceSchema = z.object({
	/** First entry is the selected request; subsequent entries are name matches. */
	chain: z.array(beeSchema),
	/** Observed reason the explicit, bounded ancestry traversal stopped. */
	end: z.discriminatedUnion("kind", [
		z.object({
			/** No matching request exists, or requester attribution was absent. */
			kind: z.literal("unmatched"),
			/** Unmatched recorded name, or null when no requester was recorded. */
			requester: z.string().nullable(),
		}),
		z.object({
			/** Up to three matching request IDs demonstrating name ambiguity. */
			candidates: z.array(z.string()),
			/** Multiple requests share the recorded requester name. */
			kind: z.literal("ambiguous"),
			/** Recorded requester name used for this ambiguous native lookup. */
			requester: z.string(),
		}),
		z.object({
			/** Request ID already visited in this ancestry chain. */
			id: z.string(),
			/** Traversal encountered a repeated request before adding it again. */
			kind: z.literal("cycle"),
		}),
		z.object({
			/** Traversal reached the server's maximum ancestry depth. */
			kind: z.literal("limit"),
		}),
	]),
	/** Server timestamp when this explicit ancestry read completed. */
	fetchedAt: z.string(),
});
export const apiErrorSchema = z.object({
	/** Failure text returned by the local API for display beside retained data. */
	message: z.string(),
});

export type Hierarchy = z.infer<typeof hierarchySchema>;
export type HierarchyNode = Hierarchy["nodes"][number];
export type BoardScope = z.infer<typeof boardScopeSchema>;
export type BeadFilter = z.infer<typeof beadFilterSchema>;
export type InventoryFilter = z.infer<typeof inventoryFilterSchema>;
export type RequestInventory = z.infer<typeof requestInventorySchema>;
export type Colony = z.infer<typeof colonySchema>;
export type BoardFilter = z.infer<typeof boardFilterSchema>;
export type Navigation = z.infer<typeof navigationSchema>;
export type Bee = z.infer<typeof beeSchema>;
export type MergeLink = z.infer<typeof mergeLinkSchema>;
export type Card = z.infer<typeof cardSchema>;
export type Board = z.infer<typeof boardSchema>;
export type Detail = z.infer<typeof detailSchema>;
export type Relation = z.infer<typeof relationSchema>;
export type Provenance = z.infer<typeof provenanceSchema>;

export function boardKey(colony: string, filter: BoardFilter): string {
	return JSON.stringify([colony, filter]);
}

export function detailKey(colony: string, id: string, scope: BoardScope): string {
	return JSON.stringify([colony, scope.view, scope.requestPage, id]);
}

export function inventoryKey(colony: string, filter: InventoryFilter): string {
	return JSON.stringify([colony, inventoryFilterSchema.parse(filter)]);
}

export function annotationKey(colony: string, ids: string[]): string {
	return `${colony}/annotations/${JSON.stringify([...new Set(ids)].toSorted())}`;
}

export function hierarchyKey(colony: string, ids: string[]): string {
	return `${colony}/${JSON.stringify([...new Set(ids)].toSorted())}`;
}

export const workflowOutcomeSchema = z.object({
	runId: z.string(),
	nativeStatus: z.string(),
	updatedAt: z.string(),
	outcome: nativeWorkflowStateSchema,
	labelsCurrent: z.boolean(),
});
export type WorkflowOutcome = z.infer<typeof workflowOutcomeSchema>;
