import { assign, setup } from "xstate";
import { z } from "zod";

// Explicit nulls preserve unavailable references in JSON snapshots and specialist receipts.
/* eslint-disable unicorn/no-null */
const CHECKOUT_ROLES = 3;
const SUCCESS = 0;
const text = z.string().trim().nonempty();
const oid = z.string().regex(/^(?:[\da-f]{40}|[\da-f]{64})$/u);
const absolutePath = text.startsWith("/");
const evidenceSchema = z.object({ evidence: text });
const revisionSchema = z.object({ baseOid: oid, headOid: oid, treeOid: oid });
const candidateSchema = z.object({ baseOid: oid, sourceOid: oid, candidateOid: oid, treeOid: oid });
const requestSchema = z.object({ requestId: text, identity: text });
const consultationSchema = requestSchema.extend({
	kind: z.enum(["bookworm", "reviewer", "architect"]),
	mode: z.enum(["prose", "detailed-review", "integration-review", "unblock"]),
	revision: revisionSchema.nullable(),
	candidate: candidateSchema.nullable(),
	blockerId: text.nullable(),
});
const receiptSchema = consultationSchema.extend({
	responseId: text,
	featureId: text,
	taskId: text,
	outcome: z.enum(["approved", "follow-up", "terminal-blocker", "critical-decision"]),
});
const verdictSchema = evidenceSchema.extend({ receipt: receiptSchema, direction: text });
const setupLine = z.object({ stream: z.enum(["stdout", "stderr"]), line: z.string() });
const sourceIdentity = z.object({
	root: absolutePath,
	worktree_path: absolutePath,
	source_branch: text,
	target_branch: text,
	target_worktree_path: absolutePath,
	source_oid: oid,
});
const deliveryIdentity = sourceIdentity.extend({
	ok: z.literal(true),
	kind: z.literal("ready"),
	target_before_oid: oid,
	target_after_oid: oid,
	diagnostics: z.array(z.string()),
	setup_output: z.array(setupLine),
});
const integrationSchema = deliveryIdentity.extend({
	strategy: z.literal("ff_only"),
	integrated: z.literal(true),
	cleanup_actions: z.tuple([]),
});
const cleanupSchema = deliveryIdentity.extend({
	removed: z.literal(true),
	containment: z.literal("git_ancestry"),
	cleanup_actions: z.tuple([z.literal("remove_worktree"), z.literal("delete_branch")]),
});
const failureSchema = deliveryIdentity.partial().extend({
	ok: z.literal(false),
	kind: z.enum(["blocked", "error"]),
	reason: text,
	message: text,
	integration_attempted: z.boolean().optional(),
	integrated: z.boolean().optional(),
	cleanup_actions: z.array(text).optional(),
});
const originSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("failed-command"), receipt: failureSchema }),
	z.object({ kind: z.literal("interrupted"), evidence: text }),
]);
const observationSchema = z.object({
	identity: sourceIdentity,
	candidate: candidateSchema,
	targetOid: oid,
	sourceContained: z.literal(true),
	evidence: text,
	origin: originSchema,
});
const integrationProofSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("command-receipt"), receipt: integrationSchema }),
	observationSchema.extend({ kind: z.literal("native-observation") }),
]);
const cleanupProofSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("command-receipt"), receipt: cleanupSchema }),
	observationSchema.extend({
		kind: z.literal("native-observation"),
		worktreeAbsent: z.literal(true),
		branchAbsent: z.literal(true),
		targetUnchanged: z.literal(true),
	}),
]);
const childSchema = z.object({ taskId: text, runId: text });
const resolutionSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("current-delivery"), evidence: text }),
	childSchema.extend({
		kind: z.literal("corrective-work"),
		responseId: text,
		candidate: candidateSchema,
	}),
]);
const directionSchema = z.object({
	receipt: receiptSchema,
	direction: text,
	work: z.enum(["repair", "recovery", "corrective-work"]),
	child: childSchema.nullable(),
	resolution: resolutionSchema.nullable(),
});
const deliverySchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("unstarted") }),
	z.object({ kind: z.literal("uncertain") }),
	z.object({ kind: z.literal("integrated"), integration: integrationProofSchema }),
	z.object({
		kind: z.literal("cleaned"),
		integration: integrationProofSchema,
		cleanup: cleanupProofSchema,
	}),
]);
const callerCompletion =
	"Post-done tail owner: the SAME task driver carrying explicit sourceClosure authorization. " +
	"Busy Bee must report done with reviewed integration/cleanup proof and required child work complete. " +
	"Then, from canonicalRoot with the retained BEADS_DB, re-read source acceptance, children, claims and " +
	"reservations. Close only the satisfied source with proof when native closure permits it; only then may " +
	"dependents be released. Preserve other identities, ct/HITL reservations and pending children. Feature " +
	"acceptance remains separate. If closure fails, leave the source open, record actual effects and the next " +
	"action on source/run, and deliver a blocked handoff. Keep the completed run done; do not duplicate or " +
	"reopen its anchor. Success requires this caller tail. No tracker publication is authorized.";

export const inputSchema = z
	.object({
		feature: z.object({ id: text, brief: text }),
		source: z.object({ id: text, parentId: text, brief: text }),
		beadsDb: absolutePath.describe("Exact selected live native tracker; preserve through cleanup."),
		canonicalRoot: absolutePath.describe(
			"Stable workflow/caller checkout; keep its catalogue and control tools usable through active runs. " +
				"Never the integration destination.",
		),
		base: z.object({ path: absolutePath, branch: text }),
		isolation: z.object({ path: absolutePath, branch: text }),
		authority: z.object({
			request: text.describe(
				"Original explicit authorization and its conversation/evidence reference.",
			),
			localCommit: z.literal(true),
			featureIntegration: z.literal(true),
			sourceClosure: z.literal(true),
		}),
		previousDeliveries: z.array(
			z.object({
				taskId: text,
				requestId: text,
				responseId: text,
				summary: text,
				candidate: candidateSchema,
			}),
		),
	})
	.superRefine((input, ctx) => {
		if (
			input.feature.id === input.source.id ||
			input.base.branch === input.isolation.branch ||
			new Set([input.canonicalRoot, input.base.path, input.isolation.path]).size !== CHECKOUT_ROLES
		) {
			ctx.addIssue({
				code: "custom",
				message: "Feature, source and the three checkout roles must be distinct.",
			});
		}
	});

export const commandSchemas = {
	isolated: evidenceSchema.extend({
		identity: text,
		beadsDb: absolutePath,
		sourceParent: text,
		runParent: text,
		nativeReady: z.literal(true),
		worktree: z.object({
			kind: z.literal("regular"),
			path: absolutePath,
			branch: text,
			basePath: absolutePath,
			baseBranch: text,
		}),
		revision: revisionSchema,
	}),
	waiting: evidenceSchema,
	recheck: evidenceSchema,
	implemented: evidenceSchema.extend({
		revision: revisionSchema,
		focusedTests: z.array(text).nonempty(),
	}),
	"prose-requested": evidenceSchema.extend(requestSchema.shape),
	"prose-approved": verdictSchema.extend({ revision: revisionSchema }),
	passed: evidenceSchema.extend({
		revision: revisionSchema,
		command: z.literal("bun run check"),
		lock: z.literal("/tmp/agent-cpu.lock"),
		exitCode: z.literal(SUCCESS),
	}),
	changes: evidenceSchema,
	"review-requested": evidenceSchema.extend(requestSchema.shape),
	approved: verdictSchema,
	committed: evidenceSchema.extend({ candidate: candidateSchema, checkedHeadOid: oid }),
	"architect-requested": evidenceSchema.extend(requestSchema.shape),
	"follow-up": verdictSchema.extend({ work: z.enum(["repair", "recovery", "corrective-work"]) }),
	"terminal-blocker": verdictSchema,
	"critical-decision": verdictSchema,
	unavailable: evidenceSchema.extend({ recovery: text }),
	available: evidenceSchema.extend({ requestId: text }),
	replacement: evidenceSchema.extend({ previousRequestId: text, ...requestSchema.shape }),
	"suspected-blocker": evidenceSchema.extend({
		blockerId: text,
		revision: revisionSchema.nullable(),
	}),
	"unblock-requested": evidenceSchema.extend(requestSchema.shape),
	"new-evidence": evidenceSchema,
	stale: evidenceSchema,
	uncertain: evidenceSchema.extend({ origin: originSchema }),
	"not-integrated": evidenceSchema,
	integrated: evidenceSchema.extend({ integration: integrationProofSchema }),
	cleaned: evidenceSchema.extend({
		integration: integrationProofSchema,
		cleanup: cleanupProofSchema,
	}),
	"register-correction": evidenceSchema.extend({ directionResponseId: text, ...childSchema.shape }),
	"resolved-direction": evidenceSchema.extend({
		directionResponseId: text,
		resolution: resolutionSchema,
	}),
	reported: evidenceSchema.extend({ responseId: text }),
};

type Input = z.infer<typeof inputSchema>;
type Revision = z.infer<typeof revisionSchema>;
type Candidate = z.infer<typeof candidateSchema>;
type Consultation = z.infer<typeof consultationSchema>;
type Receipt = z.infer<typeof receiptSchema>;
type Delivery = z.infer<typeof deliverySchema>;
type Choice = keyof typeof commandSchemas;
type Event = {
	[Key in Choice]: { type: Key; data: z.infer<(typeof commandSchemas)[Key]> };
}[Choice];
interface Context extends Input {
	/** Original task bee; specialist identities must be independent. */
	taskBee: string | null;
	/** Exact work tree checked before the authorized commit. */
	revision: Revision | null;
	/** Clean committed integration candidate reviewed by Architect. */
	candidate: Candidate | null;
	/** Issued consultation identity, recorded before consuming a response. */
	consultation: Consultation | null;
	/** Consumed original reports retained across repair and refresh. */
	receipts: Receipt[];
	/** Issued requests, including replacements, retained before reports arrive. */
	requests: Consultation[];
	/** Post-attempt directions remain obligations until their explicit evidence is consumed. */
	directions: z.infer<typeof directionSchema>[];
	/**
	 * Current candidate's failure/interruption origins; cleared when quality restarts.
	 * Earlier visit results and snapshots retain historical evidence.
	 */
	origins: z.infer<typeof originSchema>[];
	/** Latest progress, directions or recovery evidence. */
	evidence: string;
	/** Suspected blocker identity retained through renewed consultation. */
	blockerId: string | null;
	/** Observed integration effects survive every consultation and hold. */
	delivery: Delivery;
}
interface Entry {
	/** Busy Bee supplies the frozen visit context at its validated boundary. */
	context: Record<string, unknown>;
}

export const resumeSchema = inputSchema.safeExtend({
	taskBee: text.nullable(),
	revision: revisionSchema.nullable(),
	candidate: candidateSchema.nullable(),
	consultation: consultationSchema.nullable(),
	receipts: z.array(receiptSchema),
	requests: z.array(consultationSchema),
	directions: z.array(directionSchema),
	origins: z.array(originSchema),
	evidence: text,
	blockerId: text.nullable(),
	delivery: deliverySchema,
});

export const inputConstraints =
	"Start beneath source.id with one driver per source; native prerequisites and Colony capacity govern admission. " +
	"Inputs record existing explicit local commit, feature integration and post-done sourceClosure authority; " +
	"booleans grant none. Use canonicalRoot as the stable control checkout: every Busy Bee operation uses " +
	"--repo CANONICAL_ROOT. Run Bee controls there and submit all specialist/corrective requests with " +
	"--cwd CANONICAL_ROOT and the retained tracker. Assign implementation/check/review work to isolation.path; " +
	"base.path/branch remain the feature destination. Keep canonical definitions, module dependencies and " +
	"control executables usable; coordinate upgrades with preflight and active-run inspection, never a silent " +
	"root switch or reset. Record request IDs in comments before saving submission outcomes; inspect effects " +
	"before repeating interrupted submissions. Verify actual response authors, producing-task/request associations " +
	"and inspected revisions before consuming receipts; schemas compare observations without external proof. " +
	"No main/default/canonical integration, push, install or service change is authorized.";

export function runBrief(input: Input): { title: string; description: string } {
	return {
		title: `Deliver feature task ${input.source.id}`,
		description: `${inputConstraints}\n\nOriginal inputs: ${JSON.stringify(input)}\n\n${callerCompletion}`,
	};
}

/** Match submitted observations to the frozen visit; Git and response inspection belong to the driver. */
// Keep the finite outcome cases together at the definition's validation boundary.
// eslint-disable-next-line max-statements
export function validateCommand(entry: Entry, command: string, data: unknown): void {
	const context = entry.context as unknown as Context;
	const event = { type: command, data } as Event;
	switch (event.type) {
		case "isolated": {
			match(event.data.beadsDb, context.beadsDb, "selected tracker");
			match(event.data.sourceParent, context.source.parentId, "native source parent");
			match(event.data.runParent, context.source.id, "run parent");
			match(event.data.revision.baseOid, event.data.revision.headOid, "latest base at isolation");
			match(event.data.worktree.path, context.isolation.path, "regular isolation path");
			match(event.data.worktree.branch, context.isolation.branch, "isolation branch");
			match(event.data.worktree.basePath, context.base.path, "isolation base checkout");
			match(event.data.worktree.baseBranch, context.base.branch, "isolation base branch");
			break;
		}
		case "prose-requested":
		case "review-requested":
		case "architect-requested":
		case "unblock-requested": {
			if (event.data.identity === context.taskBee) {
				throw new Error("Specialist consultation must be independent of the task bee.");
			}
			if (context.requests.some((request) => request.requestId === event.data.requestId)) {
				throw new Error(
					"Renewed consultation requires a new request, retaining previous responses.",
				);
			}
			if (
				event.type === "architect-requested" &&
				context.receipts.some(
					(receipt) => receipt.kind === "reviewer" && receipt.identity === event.data.identity,
				)
			) {
				throw new Error("Architect and detailed Reviewer require separate identities.");
			}
			break;
		}
		case "available": {
			match(event.data.requestId, context.consultation!.requestId, "late original request");
			break;
		}
		case "replacement": {
			match(
				event.data.previousRequestId,
				context.consultation!.requestId,
				"replacement predecessor",
			);
			if (
				context.requests.some((request) => request.requestId === event.data.requestId) ||
				event.data.identity === context.taskBee
			) {
				throw new Error("Record an actual new independent replacement, not another submission.");
			}
			break;
		}
		case "prose-approved": {
			validateReceipt(context, event.data.receipt, "approved");
			match(event.data.revision.baseOid, context.revision!.baseOid, "Bookworm base");
			match(event.data.revision.headOid, context.revision!.headOid, "Bookworm head; no commits");
			break;
		}
		case "approved":
		case "terminal-blocker":
		case "critical-decision": {
			validateReceipt(context, event.data.receipt, event.type);
			break;
		}
		case "follow-up": {
			validateReceipt(context, event.data.receipt, event.type);
			if (
				(context.delivery.kind === "integrated" || context.delivery.kind === "cleaned") &&
				event.data.work === "repair"
			) {
				throw new Error(
					"Integrated work needs recovery or a separately tracked corrective delivery.",
				);
			}
			break;
		}
		case "passed": {
			matchRevision(event.data.revision, context.revision);
			break;
		}
		case "committed": {
			match(event.data.checkedHeadOid, context.revision!.headOid, "checked precommit head");
			match(event.data.candidate.baseOid, context.revision!.baseOid, "committed base");
			match(event.data.candidate.treeOid, context.revision!.treeOid, "checked and reviewed tree");
			match(
				event.data.candidate.sourceOid,
				event.data.candidate.candidateOid,
				"isolated ff-only candidate",
			);
			break;
		}
		case "integrated": {
			validateIntegration(context, event.data.integration);
			if (context.delivery.kind === "cleaned") {
				throw new Error("Confirmed cleanup cannot become incomplete; preserve its proof.");
			}
			break;
		}
		case "cleaned": {
			validateIntegration(context, event.data.integration);
			validateCleanup(context, event.data.cleanup);
			break;
		}
		case "not-integrated": {
			if (context.delivery.kind === "integrated" || context.delivery.kind === "cleaned") {
				throw new Error(
					"Confirmed integration cannot become unintegrated; reconcile remaining effects.",
				);
			}
			break;
		}
		case "register-correction": {
			const direction = pendingDirection(context, event.data.directionResponseId);
			if (direction.work !== "corrective-work" || direction.child !== null) {
				throw new Error("Register corrective child work once for the exact outstanding direction.");
			}
			break;
		}
		case "resolved-direction": {
			const direction = pendingDirection(context, event.data.directionResponseId);
			if (direction.work === "corrective-work") {
				if (event.data.resolution.kind !== "corrective-work" || direction.child === null) {
					throw new Error("The required corrective child delivery remains outstanding.");
				}
				match(event.data.resolution.taskId, direction.child.taskId, "corrective task");
				match(event.data.resolution.runId, direction.child.runId, "corrective run");
			} else if (event.data.resolution.kind !== "current-delivery") {
				throw new Error(
					"Resolve the retained recovery direction against observed current delivery.",
				);
			}
			break;
		}
		case "reported": {
			if (context.directions.some((direction) => direction.resolution === null)) {
				throw new Error("Outstanding Architect direction prevents completion.");
			}
			break;
		}
		default: {
			break;
		}
	}
}

// Chart and task callbacks stay inline for the visualizer. The helpers below format retained facts only.
export const machine = setup({
	types: { context: {} as Context, input: {} as Input, events: {} as Event },
	actions: {
		remember: assign(({ context, event }) => remember(context, event)),
		invalidate: assign({
			revision: null,
			candidate: null,
			consultation: null,
			origins: [],
			delivery: { kind: "unstarted" },
		}),
		markUncertain: assign(({ context, event }) => ({
			delivery: { kind: "uncertain" as const },
			origins: [
				...context.origins,
				{ kind: "interrupted" as const, evidence: event.data.evidence },
			],
		})),
	},
	guards: {
		needsIsolation: ({ context }) => context.taskBee === null,
		integrationUnstarted: ({ context }) => context.delivery.kind === "unstarted",
		retryProse: ({ context }) => context.consultation!.kind === "bookworm",
		retryReview: ({ context }) => context.consultation!.kind === "reviewer",
		retryUnblock: ({ context }) => context.consultation!.mode === "unblock",
		pendingDirection: ({ context }) =>
			context.directions.some((direction) => direction.resolution === null),
	},
}).createMachine({
	id: "do-feature-task",
	context: ({ input }) => ({
		...input,
		taskBee: null,
		revision: null,
		candidate: null,
		consultation: null,
		receipts: [],
		requests: [],
		directions: [],
		origins: [],
		evidence: "No task claim or isolated checkout created yet.",
		blockerId: null,
		delivery: { kind: "unstarted" },
	}),
	initial: "prepare",
	on: { "suspected-blocker": { actions: "remember", target: ".unblock" } },
	states: {
		prepare: {
			meta: {
				title: "Verify native eligibility and isolate the task",
				commands: {
					isolated: "isolated",
					waiting: "waiting",
					"suspected-blocker": "suspected-blocker",
				},
				task: ({ context }: { context: Context }) => ({
					instructions:
						"Read full feature/source/run briefs and verify the run's control-checkout contract before claiming or " +
						"creating anything. Inspect native canonical identity, actual request recipe.cwd with bee status, and " +
						"the selected tracker. From canonicalRoot inspect the named catalogue/input schema and restore THIS " +
						"run with show/discover --repo CANONICAL_ROOT. Record the current manifest version and successful " +
						"compatible restoration. A mismatch requires explicit recovery. " +
						"Verify native ancestry: this run is rooted beneath " +
						"source.id and source.parentId belongs to the feature; preserve inherited prerequisites. Inspect native " +
						"readiness, open children, blockers, acceptance, assignments and ct/HITL reservations. Claim the source " +
						"with br update SOURCE --claim --owner ct only when eligible and either unassigned or assigned to " +
						"the supplied actor. Otherwise choose waiting with the handoff. " +
						"Record actor/run/selected tracker/worktree. Verify canonical/base/isolation identities and base branch " +
						"is distinct from the default branch and canonical checkout. Read honeycomb --help and add --help; " +
						"verify regular-worktree policy before creating a child with honeycomb --cwd BASE_PATH add --branch " +
						"TASK_BRANCH --base BASE_BRANCH --no-network --skip-command --json. Never allocate a pooled slot. " +
						"Read the latest eligible clean base immediately before creation and verify the resulting regular " +
						"path/branch/HEAD/common Git identity; initial head must equal that base. Reconcile an existing child " +
						"on retry, never create speculatively or overwrite another bee. Any changed identity needs renewed " +
						"native inspection. Choose isolated with observed pins only after eligibility and identity proof. " +
						`Keep source open.\n\n${retained(context)}`,
				}),
			},
			on: {
				isolated: { actions: "remember", target: "implement" },
				waiting: { actions: "remember", target: "readiness-hold" },
			},
		},
		"readiness-hold": {
			meta: {
				title: "Wait for native eligibility without taking reservations",
				commands: { recheck: "recheck", "suspected-blocker": "suspected-blocker" },
				task: ({ context }: { context: Context }) => ({
					instructions:
						"Keep this run unfinished and preserve native reservations and prerequisite authority. Record the " +
						"required owner action; recheck only on new native evidence. A readiness wait is not authority to " +
						`mark the source blocked or create an isolation checkout.\n\n${retained(context)}`,
				}),
			},
			on: { recheck: { actions: "remember", target: "prepare" } },
		},
		implement: {
			entry: "invalidate",
			meta: {
				title: "Implement or repair the isolated task",
				commands: { implemented: "implemented", "suspected-blocker": "suspected-blocker" },
				task: ({ context }: { context: Context }) => ({
					instructions:
						"The original task bee implements the accepted scope and focused tests in isolation.path, " +
						"never canonical. " +
						"Apply retained direction; routine repairs preserve assignment. On stale base/source, release the target " +
						"queue first, refresh the isolated branch onto the latest eligible feature base using authorized Git " +
						"work and resolve conflicts there. Keep the candidate private until review. Every repair/base refresh " +
						"invalidates prose/check/review/Architect evidence and must traverse all gates again. Consult Librarian " +
						"for required intent/seam advice using the same evidence thread. Run focused tests and test:changed; " +
						"capture exact base, current head and complete candidate tree OIDs, including intended new files. " +
						"Use suspected-blocker for every suspected implementation inability before any source blocked status. " +
						`Keep source and feature open.\n\n${retained(context)}`,
				}),
			},
			on: { implemented: { actions: "remember", target: "prose" } },
		},
		prose: {
			meta: {
				title: "Request Bookworm on the candidate prose",
				commands: {
					"prose-requested": "prose-requested",
					"suspected-blocker": "suspected-blocker",
				},
				task: ({ context }: { context: Context }) => ({
					instructions:
						"Use bee kinds and bee spawn --help to request bookworm beneath THIS run from canonicalRoot, with " +
						"--cwd CANONICAL_ROOT and an assignment targeting isolation.path. Supply original briefs, prior " +
						"deliveries, exact current revision, audience, rationale, authoritative references and explicitly scoped " +
						"writable prose including embedded prompts/help. Retain request.id and identity before consuming " +
						`its answer; full checks and code review follow the prose edits.\n\n${retained(context)}`,
				}),
			},
			on: { "prose-requested": { actions: "remember", target: "prose-result" } },
		},
		"prose-result": {
			meta: {
				title: "Read and bind Bookworm delivery",
				commands: {
					"prose-approved": "prose-approved",
					unavailable: "unavailable",
					"suspected-blocker": "suspected-blocker",
				},
				task: ({ context }: { context: Context }) => ({
					instructions:
						"Read the retained Bookworm request's response and native outcome. Verify identity, producing-task " +
						"association and coverage. Record edits and the new " +
						"complete tree while base/head stay unchanged. Prose-approved binds the inspected revision receipt " +
						"and resulting revision. Missing or invalid delivery chooses unavailable with a recovery action, never " +
						`fabricated approval.\n\n${retained(context)}`,
				}),
			},
			on: {
				"prose-approved": { actions: "remember", target: "check" },
				unavailable: { actions: "remember", target: "consultation-recovery" },
			},
		},
		check: {
			meta: {
				title: "Check the complete Bookworm-reviewed tree",
				commands: {
					passed: "passed",
					changes: "changes",
					"suspected-blocker": "suspected-blocker",
				},
				task: ({ context }: { context: Context }) => ({
					instructions:
						"In isolation.path, tidy this task's scratch/dead content. Run COMPLETE bun run check through qlock " +
						"exec --lock " +
						"/tmp/agent-cpu.lock; read qlock -h/exec --help. Hold no merge queue while checking. Passing requires " +
						"exit 0 and the same exact base/head/tree after checks. Do not change timing thresholds or allowances. " +
						"Code failures choose changes for repair; suspected inability chooses suspected-blocker before native " +
						`source blocking. Independent code review follows this passing gate.\n\n${retained(context)}`,
				}),
			},
			on: {
				passed: { actions: "remember", target: "review" },
				changes: { actions: "remember", target: "implement" },
			},
		},
		review: {
			meta: {
				title: "Request independent detailed Reviewer",
				commands: {
					"review-requested": "review-requested",
					"suspected-blocker": "suspected-blocker",
				},
				task: ({ context }: { context: Context }) => ({
					instructions:
						"Only after full checks pass, request reviewer beneath this run with --cwd CANONICAL_ROOT. Assign " +
						"detailed code/test review of isolation.path against original acceptance and this exact tree/base/head. " +
						"Reviewer remains separate from Architect; it does not rerun full checks or audit their execution " +
						"evidence. Obtain " +
						"required Librarian final-diff advice on seams in the same intent evidence thread. Retain all required " +
						`reports and resolve findings. Record exact request.id and independent identity.\n\n${retained(context)}`,
				}),
			},
			on: { "review-requested": { actions: "remember", target: "review-result" } },
		},
		"review-result": {
			meta: {
				title: "Read exact detailed review outcome",
				commands: {
					approved: "approved",
					"follow-up": "follow-up",
					unavailable: "unavailable",
					"suspected-blocker": "suspected-blocker",
				},
				task: ({ context }: { context: Context }) => ({
					instructions:
						"Wait for and read the exact Reviewer answer through bee result. Match its request/response and " +
						"inspected base/head/tree, verify all findings resolved and required Librarian advice obtained. " +
						"Choose approved only for that unchanged tree, follow-up for scoped repair, unavailable for missing " +
						`delivery. A closed request alone proves no approval.\n\n${retained(context)}`,
				}),
			},
			on: {
				approved: { actions: "remember", target: "commit" },
				"follow-up": { actions: "remember", target: "implement" },
				unavailable: { actions: "remember", target: "consultation-recovery" },
			},
		},
		commit: {
			meta: {
				title: "Commit the exact checked and reviewed tree",
				commands: {
					committed: "committed",
					changes: "changes",
					"suspected-blocker": "suspected-blocker",
				},
				task: ({ context }: { context: Context }) => ({
					instructions:
						"Use explicit localCommit authority for scoped clean Conventional Commits. Verify the resulting " +
						"commit has the exact checked/reviewed tree and expected precommit lineage and base ancestry. The " +
						"isolated branch HEAD is the combined integration candidate and Honeycomb source pin; both OIDs " +
						"must match. Ordinary commit metadata changes may retain identical-tree quality evidence; any " +
						"content/base change chooses changes and repeats every quality gate. Record the final clean source, " +
						`base, candidate and tree revisions before requesting Architect.\n\n${retained(context)}`,
				}),
			},
			on: {
				committed: { actions: "remember", target: "architect" },
				changes: { actions: "remember", target: "implement" },
			},
		},
		architect: {
			meta: {
				title: "Request Architect on the exact combined candidate",
				commands: {
					"architect-requested": "architect-requested",
					"suspected-blocker": "suspected-blocker",
				},
				task: ({ context }: { context: Context }) => ({
					instructions:
						"Read docs/agents/specialists.md#operational-architecture and bee kinds architect. Request architect " +
						"beneath this run with --cwd CANONICAL_ROOT in integration-review mode, targeting isolation.path. " +
						"Supply original feature/task briefs, authorization, previous deliveries and all current reports, " +
						"exact clean combined candidate " +
						"on the private isolated branch, feature base and task-source revisions. Verify continuity without " +
						"publishing the candidate to obtain review. Retain request.id and an identity independent of the task " +
						"bee and Reviewer. Hold " +
						`neither CPU nor merge queue while agents are pending.\n\n${retained(context)}`,
				}),
			},
			on: { "architect-requested": { actions: "remember", target: "architect-result" } },
		},
		"architect-result": {
			meta: {
				title: "Read Architect continuity direction",
				commands: {
					approved: "approved",
					"follow-up": "follow-up",
					"terminal-blocker": "terminal-blocker",
					"critical-decision": "critical-decision",
					unavailable: "unavailable",
					"suspected-blocker": "suspected-blocker",
				},
				task: ({ context }: { context: Context }) => ({
					instructions:
						"Read the retained Architect request's actual response and native outcome with bee result. Verify " +
						"author and producing-task/request association, feature/task, scope, mode, independent identity and " +
						"exact base/source/candidate/tree " +
						"against inspected evidence. Approval covers only those revisions. Follow-up returns the original bee " +
						"to scoped repair and all gates. Only evidenced terminal-blocker or explicit critical-decision supports " +
						"a native source blocked handoff. Missing or invalid delivery chooses unavailable and recovery; it " +
						`supplies no approval or verdict.\n\n${retained(context)}`,
				}),
			},
			on: {
				approved: { actions: "remember", target: "integrate" },
				"follow-up": { actions: "remember", target: "implement" },
				"terminal-blocker": { actions: "remember", target: "hold" },
				"critical-decision": { actions: "remember", target: "hold" },
				unavailable: { actions: "remember", target: "consultation-recovery" },
			},
		},
		integrate: {
			meta: {
				title: "Queue exact integration, proof and cleanup",
				commands: {
					cleaned: "cleaned",
					integrated: "integrated",
					stale: "stale",
					uncertain: "uncertain",
					"suspected-blocker": "suspected-blocker",
				},
				task: ({ context }: { context: Context }) => ({
					instructions:
						"Read qlock merge-queue instructions and Honeycomb integrate/remove help/schema. From surviving " +
						"BASE_PATH run ONE foreground critical section under qlock exec --merge-target BASE_BRANCH -- ... " +
						"covering exact live identity/freshness, integration, proof and cleanup. Queue identity does not select " +
						"the destination; --into does. Require exclusive source/target use, clean trees, same common Git dir, " +
						"eligible feature base and exact Architect-approved pins. Execute " +
						"honeycomb --cwd TASK_PATH integrate --into BASE_BRANCH --expected-target BASE_OID " +
						"--expected-source SOURCE_OID --json. Inspect actual destination HEAD/tree and native identity before " +
						"cleanup; then honeycomb --cwd TASK_PATH remove --self --integrated-into-local BASE_BRANCH " +
						"--expected-target OBSERVED_TARGET_OID --expected-source SOURCE_OID --json. Verify confirmed " +
						"remove_worktree/delete_branch actions and unchanged integrated target. After removal ALL remaining " +
						"Busy Bee commands still use --repo CANONICAL_ROOT and selected tracker; source cwd no longer exists. " +
						"If stale before mutation, release queue, choose stale and refresh/recheck/review. Before native " +
						"reconstruction, record the current candidate's uncertainty with uncertain, or suspected-blocker for " +
						"Architect direction. Any attempted or " +
						"interrupted mutation requires native reconciliation: confirmed integration chooses integrated (cleanup " +
						"remaining) or cleaned (both complete); unknown effects choose uncertain. Never blindly replay or " +
						"infer atomic rollback. Do not wait for agents/CPU while holding merge queue. " +
						`Keep source open.\n\n${retained(context)}`,
				}),
			},
			on: {
				cleaned: { actions: "remember", target: "completion-route" },
				integrated: { actions: "remember", target: "cleanup" },
				stale: { actions: "remember", target: "implement" },
				uncertain: { actions: "remember", target: "reconcile" },
				"suspected-blocker": { actions: ["markUncertain", "remember"], target: "unblock" },
			},
		},
		reconcile: {
			meta: {
				title: "Reconcile observed partial effects",
				commands: {
					"not-integrated": "not-integrated",
					integrated: "integrated",
					cleaned: "cleaned",
					uncertain: "uncertain",
					"suspected-blocker": "suspected-blocker",
				},
				task: ({ context }: { context: Context }) => ({
					instructions:
						"Inspect retained envelopes, cleanup_actions and actual native Git worktrees/refs/HEAD/tree and " +
						"task state, targeting BASE_PATH under the matching target queue for inspection/mutations only. Keep " +
						"Busy Bee/Bee control in canonicalRoot. " +
						"An absent integrated field is UNKNOWN. Confirmed integration can never become not-integrated. " +
						"Choose not-integrated only with observed unchanged base and no integration, returning through all " +
						"gates. Use native-observation proof with original failure/interruption origin and verified pins, " +
						"containment/current target and candidate tree; never manufacture a successful Honeycomb receipt. " +
						"Integrated proceeds to cleanup ONLY; cleaned proceeds through outstanding direction to report. " +
						"Preserve the original integrated candidate/proof and completed cleanup. The direction visit owns " +
						"required corrective work. Unresolved evidence keeps reconciliation active; " +
						`suspected inability routes to Architect.\n\n${retained(context)}`,
				}),
			},
			on: {
				"not-integrated": { actions: "remember", target: "implement" },
				integrated: { actions: "remember", target: "cleanup" },
				cleaned: { actions: "remember", target: "completion-route" },
				uncertain: { actions: "remember", target: "reconcile", reenter: true },
			},
		},
		cleanup: {
			meta: {
				title: "Finish only the remaining local cleanup",
				commands: {
					cleaned: "cleaned",
					uncertain: "uncertain",
					"suspected-blocker": "suspected-blocker",
				},
				task: ({ context }: { context: Context }) => ({
					instructions:
						"Integration is already confirmed. Hold qlock --merge-target BASE_BRANCH only for live proof and " +
						"remaining cleanup from surviving BASE_PATH. Inspect actual completed cleanup_actions first. If the " +
						"regular source still exists, use honeycomb --cwd TASK_PATH remove --self --integrated-into-local " +
						"BASE_BRANCH --expected-target OBSERVED_TARGET_OID --expected-source SOURCE_OID --json after native " +
						"containment/identity/cleanliness proof. If worktree removal already occurred, inspect exact remaining " +
						"branch ref and use only authorized expected-old-OID local deletion, recording observed actions; do " +
						"not rerun a command against a vanished cwd or force removal. Verify reviewed source ancestry/tree at " +
						"the current feature target and source branch/path absence. No integration replay. Preserve all partial " +
						"evidence on failure; choose uncertain for reconciliation or suspected-blocker for direction. All Busy " +
						`Bee calls use --repo CANONICAL_ROOT.\n\n${retained(context)}`,
				}),
			},
			on: {
				cleaned: { actions: "remember", target: "completion-route" },
				uncertain: { actions: "remember", target: "reconcile" },
			},
		},
		unblock: {
			meta: {
				title: "Request Architect direction before source blocking",
				commands: {
					"unblock-requested": "unblock-requested",
					"suspected-blocker": "suspected-blocker",
				},
				task: ({ context }: { context: Context }) => ({
					instructions:
						"Keep source status/reservations intact. Request Architect under this run with --cwd CANONICAL_ROOT " +
						"in unblock mode, targeting the relevant base/isolation evidence, " +
						"with blocker identity, facts, original feature/task, prior deliveries, available revisions and observed " +
						"partial integration/cleanup. Architect must investigate and try actionable direction within accepted " +
						"authority first. Unavailable revisions are explicitly null, not fabricated. Record request.id and " +
						"independent identity. Missing infrastructure supplies no terminal verdict; retain the recovery task " +
						`open if a request cannot yet be issued.\n\n${retained(context)}`,
				}),
			},
			on: { "unblock-requested": { actions: "remember", target: "unblock-result" } },
		},
		"unblock-result": {
			meta: {
				title: "Apply evidenced Architect unblock direction",
				commands: {
					"follow-up": "follow-up",
					"terminal-blocker": "terminal-blocker",
					"critical-decision": "critical-decision",
					unavailable: "unavailable",
					"suspected-blocker": "suspected-blocker",
				},
				task: ({ context }: { context: Context }) => ({
					instructions:
						"Wait for and inspect the exact retained request/response with bee result. Match blocker, scope and " +
						"available revisions and record attempted direction. Follow-up returns the original bee to eligibility " +
						"or repair, with all quality gates renewed; after an attempted integration it returns to reconciliation " +
						"and preserves confirmed effects. Source blocking requires terminal-blocker evidence showing why " +
						"authorized follow-up cannot work, or critical-decision naming ct's reserved boundary and dependency. " +
						"Routine repair never assigns ct. Unavailable consultation chooses unavailable; it is not a verdict. " +
						`Unblock has no integration approval outcome.\n\n${retained(context)}`,
				}),
			},
			on: {
				"follow-up": [
					{ guard: "needsIsolation", actions: "remember", target: "prepare" },
					{ guard: "integrationUnstarted", actions: "remember", target: "implement" },
					{ actions: "remember", target: "reconcile" },
				],
				"terminal-blocker": { actions: "remember", target: "hold" },
				"critical-decision": { actions: "remember", target: "hold" },
				unavailable: { actions: "remember", target: "consultation-recovery" },
			},
		},
		hold: {
			meta: {
				title: "Retain an unfinished Architect-directed hold",
				commands: { "new-evidence": "new-evidence", "suspected-blocker": "suspected-blocker" },
				task: ({ context }: { context: Context }) => ({
					instructions:
						"Record the exact Architect verdict/request/response and required next action on source/run. Only this " +
						"evidenced terminal or explicit critical dependency supports native source blocked state; preserve " +
						"other identities and ct/HITL reservations. Deliver an honest blocked Bee handoff with the run " +
						"UNFINISHED. Ordinary follow-up does not assign ct. New evidence returns to renewed Architect " +
						"unblock direction, never straight to integration or done; restore native eligibility only with " +
						"authorized resolution and preserved human reservations. A blocked source ancestor may prevent " +
						"Colony admitting this descendant run: name the authorized caller action needed to restore " +
						`consultation eligibility before retry, without granting implementation approval.\n\n${retained(context)}`,
				}),
			},
			on: { "new-evidence": { actions: "remember", target: "unblock" } },
		},
		"consultation-recovery": {
			meta: {
				title: "Recover missing specialist delivery",
				commands: {
					available: "available",
					replacement: "replacement",
					"suspected-blocker": "suspected-blocker",
				},
				task: ({ context }: { context: Context }) => ({
					instructions:
						"From canonicalRoot read docs/agents/spawn-requests.md and bee status --help before recovery. Preserve " +
						"canonical --cwd and the tracker for replacements. A late original response, including interrupted " +
						"finish, chooses available with the retained request ID and returns directly to its result visit. " +
						"Automatic attempts retain that ID. For a genuine explicit retry, verify the predecessor and returned " +
						"replacement request/identity, then choose replacement to bind that request before its result. " +
						"Never submit another consultation when recovering an existing one. " +
						"Preserve original evidence and " +
						"confirmed effects. No missing report authorizes source blocking, approval or quality-gate bypass. " +
						`Changed code/base requires repair and renewed gates.\n\n${retained(context)}`,
				}),
			},
			on: {
				available: [
					{ guard: "retryProse", actions: "remember", target: "prose-result" },
					{ guard: "retryReview", actions: "remember", target: "review-result" },
					{ guard: "retryUnblock", actions: "remember", target: "unblock-result" },
					{ actions: "remember", target: "architect-result" },
				],
				replacement: [
					{ guard: "retryProse", actions: "remember", target: "prose-result" },
					{ guard: "retryReview", actions: "remember", target: "review-result" },
					{ guard: "retryUnblock", actions: "remember", target: "unblock-result" },
					{ actions: "remember", target: "architect-result" },
				],
			},
		},
		"completion-route": {
			always: [{ guard: "pendingDirection", target: "direction" }, { target: "report" }],
		},
		direction: {
			meta: {
				title: "Satisfy retained post-integration Architect direction",
				commands: {
					"register-correction": "register-correction",
					"resolved-direction": "resolved-direction",
					"suspected-blocker": "suspected-blocker",
				},
				task: ({ context }: { context: Context }) => ({
					instructions:
						"Each pending direction remains an obligation keyed by its exact Architect response. For recovery " +
						"direction, inspect the observed delivery and record how it satisfies the direction. For corrective " +
						"code, create scoped child task/run beneath THIS run from canonicalRoot with --cwd CANONICAL_ROOT " +
						"and register their exact references BEFORE consuming completion. The same task bee owns that " +
						"isolated corrective delivery from the current " +
						"feature base; obtain renewed focused tests, Bookworm, complete checks, independent Reviewer, " +
						"required Librarian and exact Architect approval/integration/cleanup proof. Read and verify that " +
						"child run's done status, complete response and native acceptance against its recorded task/run, " +
						"candidate and direction before resolved-direction. A child closure alone proves no delivery. " +
						"Preserve the original delivery proof and every unresolved direction; source stays open. " +
						`All obligations must be satisfied before report.\n\n${retained(context)}`,
				}),
			},
			on: {
				"register-correction": { actions: "remember", target: "direction", reenter: true },
				"resolved-direction": { actions: "remember", target: "completion-route" },
			},
		},
		report: {
			meta: {
				title: "Deliver verified task integration before caller closure",
				commands: { reported: "reported", "suspected-blocker": "suspected-blocker" },
				task: ({ context }: { context: Context }) => ({
					instructions:
						"Verify all required child work and recovery directions complete, including any corrective delivery. " +
						"Record exact checks, Reviewer, Librarian, Architect request/response/revision bindings, actual " +
						"integration/cleanup proof and verification limits in run comments. Read all worker answers with " +
						"bee result and synthesize the complete run response before reported. Source task stays OPEN until " +
						"Busy Bee collects this visit and reports done. Continue control commands from canonicalRoot, then " +
						`follow the run brief's post-done caller tail.\n\n${retained(context)}`,
				}),
			},
			on: { reported: { actions: "remember", target: "done" } },
		},
		done: { type: "final" },
	},
});

// --- Retained observations and receipt comparisons; no external effects. ---

// One pure reducer keeps each explicit chart outcome and its retained facts together.
// eslint-disable-next-line max-statements
function remember(context: Context, event: Event): Partial<Context> {
	const { evidence } = event.data;
	switch (event.type) {
		case "isolated": {
			return { evidence, taskBee: event.data.identity, revision: event.data.revision };
		}
		case "implemented": {
			return { evidence, revision: event.data.revision };
		}
		case "prose-requested": {
			return recordConsultation(context, event.data, { kind: "bookworm", mode: "prose" });
		}
		case "review-requested": {
			return recordConsultation(context, event.data, { kind: "reviewer", mode: "detailed-review" });
		}
		case "architect-requested": {
			return recordConsultation(context, event.data, {
				kind: "architect",
				mode: "integration-review",
			});
		}
		case "unblock-requested": {
			return recordConsultation(context, event.data, { kind: "architect", mode: "unblock" });
		}
		case "replacement": {
			const replacement = {
				...context.consultation!,
				requestId: event.data.requestId,
				identity: event.data.identity,
			};
			return { evidence, consultation: replacement, requests: [...context.requests, replacement] };
		}
		case "prose-approved": {
			return {
				evidence,
				receipts: [...context.receipts, event.data.receipt],
				revision: event.data.revision,
			};
		}
		case "approved":
		case "terminal-blocker":
		case "critical-decision": {
			return {
				evidence: `${evidence}\nDirection: ${event.data.direction}`,
				receipts: [...context.receipts, event.data.receipt],
			};
		}
		case "follow-up": {
			const directions = [...context.directions];
			if (context.delivery.kind !== "unstarted") {
				directions.push({
					receipt: event.data.receipt,
					direction: event.data.direction,
					work: event.data.work,
					child: null,
					resolution: null,
				});
			}
			return {
				evidence: `${evidence}\nDirection: ${event.data.direction}`,
				receipts: [...context.receipts, event.data.receipt],
				directions,
			};
		}
		case "register-correction": {
			return {
				evidence,
				directions: context.directions.map((direction) => {
					if (direction.receipt.responseId === event.data.directionResponseId) {
						return { ...direction, child: { taskId: event.data.taskId, runId: event.data.runId } };
					}
					return direction;
				}),
			};
		}
		case "resolved-direction": {
			return {
				evidence,
				directions: context.directions.map((direction) => {
					if (direction.receipt.responseId === event.data.directionResponseId) {
						return { ...direction, resolution: event.data.resolution };
					}
					return direction;
				}),
			};
		}
		case "committed": {
			return { evidence, candidate: event.data.candidate };
		}
		case "suspected-blocker": {
			return { evidence, blockerId: event.data.blockerId, revision: event.data.revision };
		}
		case "new-evidence": {
			return { evidence, blockerId: context.blockerId ?? context.consultation!.requestId };
		}
		case "integrated": {
			if (context.delivery.kind === "integrated") {
				return { evidence };
			}
			return { evidence, delivery: { kind: "integrated", integration: event.data.integration } };
		}
		case "cleaned": {
			let { integration, cleanup } = event.data;
			if (context.delivery.kind === "integrated" || context.delivery.kind === "cleaned") {
				({ integration } = context.delivery);
			}
			if (context.delivery.kind === "cleaned") {
				({ cleanup } = context.delivery);
			}
			return {
				evidence,
				delivery: {
					kind: "cleaned",
					integration,
					cleanup,
				},
			};
		}
		case "uncertain": {
			if (context.delivery.kind === "unstarted") {
				return {
					evidence,
					delivery: { kind: "uncertain" },
					origins: [...context.origins, event.data.origin],
				};
			}
			return { evidence, origins: [...context.origins, event.data.origin] };
		}
		case "unavailable": {
			return { evidence: `${evidence}\nRecovery: ${event.data.recovery}` };
		}
		default: {
			return { evidence };
		}
	}
}

function recordConsultation(
	context: Context,
	request: z.infer<typeof requestSchema> & { evidence: string },
	role: Pick<Consultation, "kind" | "mode">,
): Partial<Context> {
	let blockerId: string | null = null;
	if (role.mode === "unblock") {
		({ blockerId } = context);
	}
	const consultation: Consultation = {
		requestId: request.requestId,
		identity: request.identity,
		...role,
		revision: context.revision,
		candidate: context.candidate,
		blockerId,
	};
	return {
		evidence: request.evidence,
		consultation,
		requests: [...context.requests, consultation],
	};
}

function validateReceipt(context: Context, receipt: Receipt, outcome: Receipt["outcome"]): void {
	match(receipt.featureId, context.feature.id, "receipt feature");
	match(receipt.taskId, context.source.id, "receipt source task");
	match(receipt.outcome, outcome, "receipt outcome");
	validateConsultation(receipt, context.consultation!);
	if (context.receipts.some((previous) => previous.responseId === receipt.responseId)) {
		throw new Error("A response already consumed by this run cannot approve another visit.");
	}
}

function validateConsultation(receipt: Receipt, request: Consultation): void {
	match(receipt.requestId, request.requestId, "consultation request");
	match(receipt.identity, request.identity, "consultation identity");
	match(receipt.kind, request.kind, "consultation role");
	match(receipt.mode, request.mode, "consultation mode");
	if (receipt.blockerId !== request.blockerId) {
		throw new Error("Mismatched blocker identity.");
	}
	matchRevision(receipt.revision, request.revision);
	matchCandidate(receipt.candidate, request.candidate);
}

function validateIntegration(
	context: Context,
	proof: z.infer<typeof integrationProofSchema>,
): void {
	if (proof.kind === "command-receipt") {
		validateDeliveryIdentity(context, proof.receipt);
		match(proof.receipt.target_before_oid, context.candidate!.baseOid, "approved integration base");
		match(
			proof.receipt.target_after_oid,
			context.candidate!.candidateOid,
			"observed integrated candidate",
		);
		return;
	}
	validateNativeObservation(context, proof);
}

function validateCleanup(context: Context, proof: z.infer<typeof cleanupProofSchema>): void {
	if (proof.kind === "command-receipt") {
		validateDeliveryIdentity(context, proof.receipt);
		match(
			proof.receipt.target_before_oid,
			proof.receipt.target_after_oid,
			"cleanup leaves target unchanged",
		);
		return;
	}
	validateNativeObservation(context, proof);
}

function validateNativeObservation(
	context: Context,
	proof: z.infer<typeof observationSchema>,
): void {
	if (context.delivery.kind === "unstarted") {
		throw new Error("Native observations require recorded uncertainty for the current candidate.");
	}
	// The shared origin schema normalizes both values' fields and order before comparison.
	if (!context.origins.some((origin) => JSON.stringify(origin) === JSON.stringify(proof.origin))) {
		throw new Error("Native observation origin must match a recorded current-candidate origin.");
	}
	validateDeliveryIdentity(context, proof.identity);
	matchCandidate(proof.candidate, context.candidate);
}

function validateDeliveryIdentity(context: Context, receipt: z.infer<typeof sourceIdentity>): void {
	match(receipt.root, context.canonicalRoot, "repository root");
	match(receipt.worktree_path, context.isolation.path, "source worktree");
	match(receipt.source_branch, context.isolation.branch, "source branch");
	match(receipt.target_branch, context.base.branch, "explicit feature destination");
	match(receipt.target_worktree_path, context.base.path, "feature checkout");
	match(receipt.source_oid, context.candidate!.sourceOid, "approved source pin");
}

function pendingDirection(context: Context, responseId: string): z.infer<typeof directionSchema> {
	const direction = context.directions.find((entry) => entry.receipt.responseId === responseId);
	if (!direction || direction.resolution !== null) {
		throw new Error("No outstanding direction matches this Architect response.");
	}
	return direction;
}

function match(actual: string, expected: string, field: string): void {
	if (actual !== expected) {
		throw new Error(`Mismatched ${field}; inspect original evidence and renew stale gates.`);
	}
}

function matchRevision(actual: Revision | null, expected: Revision | null): void {
	if (actual === null || expected === null) {
		if (actual !== expected) {
			throw new Error("Mismatched unavailable work revision.");
		}
		return;
	}
	match(actual.baseOid, expected.baseOid, "revision base");
	match(actual.headOid, expected.headOid, "revision head");
	match(actual.treeOid, expected.treeOid, "revision tree");
}

function matchCandidate(actual: Candidate | null, expected: Candidate | null): void {
	if (actual === null || expected === null) {
		if (actual !== expected) {
			throw new Error("Mismatched unavailable integration candidate.");
		}
		return;
	}
	match(actual.baseOid, expected.baseOid, "candidate base");
	match(actual.sourceOid, expected.sourceOid, "candidate source");
	match(actual.candidateOid, expected.candidateOid, "combined candidate");
	match(actual.treeOid, expected.treeOid, "candidate tree");
}

function retained(context: Context): string {
	return (
		`Control checkout: ${context.canonicalRoot}; follow the run brief's catalogue contract.\n` +
		`Original feature/task/authority/tracker/checkouts and prior deliveries: ${JSON.stringify({
			feature: context.feature,
			source: context.source,
			authority: context.authority,
			beadsDb: context.beadsDb,
			canonicalRoot: context.canonicalRoot,
			base: context.base,
			isolation: context.isolation,
			previousDeliveries: context.previousDeliveries,
		})}\nCurrent task bee: ${context.taskBee}; revision: ${JSON.stringify(context.revision)}; ` +
		`candidate: ${JSON.stringify(context.candidate)}; consultation: ${JSON.stringify(context.consultation)}; ` +
		`blocker: ${context.blockerId}; delivery: ${JSON.stringify(context.delivery)}; ` +
		`requests: ${JSON.stringify(context.requests)}; directions: ${JSON.stringify(context.directions)}; ` +
		`current candidate origins: ${JSON.stringify(context.origins)}; ` +
		`consumed reports: ${JSON.stringify(context.receipts)}.\nLatest evidence: ${context.evidence}`
	);
}
