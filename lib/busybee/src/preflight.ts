import type { ActiveEntry, Run } from "./checkpoint.ts";
import type { Definition, ResolvedTask, WorkflowActor } from "./definition.ts";
import type { Endpoint, Options, Services } from "./native.ts";
import {
	actorFor,
	childActors,
	declaresEvent,
	importDefinition,
	renderTask,
	targetActor,
} from "./definition.ts";
import { createServices, readBead, resolveEndpoint } from "./native.ts";
import type { BeadRow } from "@hive/beads";
import type { Source } from "./catalogue.ts";
import { compatibleWorkflowVersion } from "./compatibility.ts";
import { frontier } from "./runtime.ts";
// Compare declared context fields without treating schema output as a migration.
// eslint-disable-next-line import/no-nodejs-modules
import { isDeepStrictEqual } from "node:util";
import { namedDefinition } from "./catalogue.ts";
import { readCheckpoint } from "./checkpoint.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve the optional proposed entry at the CLI boundary.
import { resolve } from "node:path";
import { z } from "zod";

const EMPTY = 0;
const workflowIdentitySchema = z.object({ kind: z.string(), name: z.string().optional() });
const diagnosticIdentitySchema = z.compile(
	z.object({
		id: z.string(),
		definition: workflowIdentitySchema,
	}),
);
const taskContextSchema = z.compile(z.record(z.string(), z.unknown()));
const limits = [
	"Future states, command payloads, guards and action implementations are unchecked.",
	"Imports, snapshot restoration and task renderers execute trusted author code; this is not a sandbox.",
	"This read-only observation does not reserve runs or authorize " +
		"execution; checkpoint locks and concurrent changes require separate " +
		"inspection.",
];

export interface Finding {
	/** Independent compatibility check. */
	check: string;
	/** Unchecked means no compatibility claim for this portion. */
	status: "passed" | "failed" | "unchecked";
	/** Human-readable evidence or diagnostic. */
	message: string;
}
export interface RunAssessment {
	/** Native parent workflow run. */
	id: string;
	/** Native checkpoint inspected. */
	checkpoint: string;
	/** A passing frontier assessment never proves future compatibility. */
	status: "incompatible" | "unchecked";
	/** All findings, including failures independent of earlier failures. */
	findings: Finding[];
}
export interface PreflightReport extends Endpoint {
	/** Requested saved workflow identity. */
	name: string;
	/** Candidate entry from the catalogue or an explicit proposed module. */
	source: string;
	/** Proposed manifest version, absent for an explicit candidate module. */
	version: string | null;
	/** No report proves complete snapshot/dependency/future-path compatibility. */
	status: "incompatible" | "unchecked";
	/** Findings for unfinished runs of the requested name. */
	runs: RunAssessment[];
	/** Checkpoints whose malformed identity prevents attribution to a workflow. */
	discovery: DiscoveryDiagnostic[];
	/** Explicit boundaries of the evidence. */
	limits: string[];
}
interface DiscoveryDiagnostic {
	/** Unattributable system checkpoint. */
	checkpoint: string;
	/** Actual identity/header failure requiring inspection. */
	message: string;
}
interface AssessmentInput {
	/** Engine-owned saved run. */
	run: Run;
	/** Native machine-state record. */
	checkpoint: string;
	/** Trusted candidate definition. */
	definition: Definition;
	/** Proposed manifest version; explicit modules have none. */
	version: string | null;
}
interface PersistedActor {
	/** XState's saved child tree, used to detect dropped actor logic. */
	children?: Record<string, { snapshot: PersistedActor }>;
}

// eslint-disable-next-line max-statements -- Keep candidate resolution and read-only discovery in one ordered boundary.
export async function preflight(
	name: string,
	options: Options & { source?: string } = {},
	services: Services = createServices(),
): Promise<PreflightReport> {
	const endpoint = await resolveEndpoint(options, services);
	const { candidate, version } = await candidateSource(name, options, endpoint, services);
	const { source } = candidate;
	const definition = await importDefinition(source, services);
	const listing = await services.beads.list(
		{ cwd: endpoint.repo, db: endpoint.db },
		{ labels: ["system", "busybee-checkpoint"], all: true, limit: EMPTY },
	);
	const runs: RunAssessment[] = [];
	const discovery: DiscoveryDiagnostic[] = [];
	for (const record of listing.issues) {
		// eslint-disable-next-line no-await-in-loop -- Preserve deterministic native discovery and per-run diagnostics.
		const assessment = await inspectCheckpoint(
			record,
			{ definition, discovery, endpoint, name, version },
			services,
		);
		if (assessment) {
			runs.push(assessment);
		}
	}
	return {
		...endpoint,
		discovery,
		limits,
		name,
		runs,
		source,
		status: reportStatus(runs, discovery),
		version,
	};
}

/** Assess one engine-owned run against a candidate without starting or sending to actors. */
// eslint-disable-next-line max-statements -- Preserve independent findings after version or structural incompatibility.
export function assessRun({
	run,
	checkpoint,
	definition,
	version,
}: AssessmentInput): RunAssessment {
	const findings: Finding[] = [];
	if (version === null) {
		findings.push({
			check: "version",
			message:
				"Explicit proposed module has no manifest version; version compatibility is unchecked.",
			status: "unchecked",
		});
	} else {
		check(findings, "version", () => {
			if (
				run.definition.kind !== "named" ||
				!compatibleWorkflowVersion(run.definition.version, version)
			) {
				throw new Error(`Saved workflow version cannot resume against ${version}`);
			}
		});
	}
	const restored: { root: WorkflowActor | undefined } = { root: undefined };
	check(findings, "snapshot_restore", () => {
		restored.root = actorFor(definition, { snapshot: structuredClone(run.snapshot) });
		verifyActorTree(restored.root, run.snapshot as PersistedActor);
	});
	const { root } = restored;
	if (root && root.getSnapshot().status !== "error") {
		findings.push(
			assessResumeContext(
				(run.snapshot as Run["snapshot"] & { context: unknown }).context,
				definition.resumeSchema,
			),
		);
		if (childActors(root).length > EMPTY) {
			findings.push({
				check: "child_contexts",
				message:
					"resumeSchema validates the root context only; child context shapes are unchecked.",
				status: "unchecked",
			});
		}
		assessFrontier({ active: run.active, root, definition }, findings);
	} else {
		findings.push({
			check: "current_frontier",
			message: "Snapshot restoration failed; active states and rendering could not be checked.",
			status: "unchecked",
		});
	}
	findings.push({ check: "future_execution", message: limits[EMPTY]!, status: "unchecked" });
	return { checkpoint, findings, id: run.id, status: assessmentStatus(findings) };
}

/** Validate raw persisted root data without using schema output as a migration. */
export function assessResumeContext(
	rawContext: unknown,
	resumeSchema: Definition["resumeSchema"],
): Finding {
	const finding: Finding = {
		check: "context:root",
		message: "No resumeSchema supplied; restored context is unchecked.",
		status: "unchecked",
	};
	if (!resumeSchema) {
		return finding;
	}
	try {
		const parsed = resumeSchema.parse(structuredClone(rawContext));
		const output = taskContextSchema.safeParse(parsed);
		if (
			!output.success ||
			Object.entries(output.data).some(
				([key, value]) => !isDeepStrictEqual(value, (rawContext as Record<string, unknown>)[key]),
			)
		) {
			return {
				...finding,
				message:
					"resumeSchema changes declared persisted fields through defaults or " +
					"transforms; the unchanged context remains unchecked.",
			};
		}
		return { ...finding, message: "Passed for this saved frontier.", status: "passed" };
	} catch (error) {
		return { ...finding, message: message(error), status: "failed" };
	}
}

/** Saved choices retain their events and candidate schemas; new choices are permitted. */
export function verifyCommands(
	saved: ResolvedTask["commands"],
	proposed: ResolvedTask["commands"],
	commandSchemas: Definition["commandSchemas"],
): void {
	if (Object.entries(saved ?? {}).some(([choice, event]) => proposed?.[choice] !== event)) {
		throw new Error("Frozen command mapping changed");
	}
	for (const choice of Object.keys(saved ?? {})) {
		if (!commandSchemas[choice]) {
			throw new Error(`No candidate command schema for ${choice}`);
		}
	}
}

// --- Private functions ---

// eslint-disable-next-line max-params -- Source selection needs the request, endpoint and injected services together.
async function candidateSource(
	name: string,
	options: Options & { source?: string },
	endpoint: Endpoint,
	services: Services,
): Promise<{ candidate: Source; version: string | null }> {
	if (options.source !== undefined) {
		// eslint-disable-next-line unicorn/no-null -- Report the unknown proposed module version explicitly in JSON.
		return {
			candidate: { kind: "file", source: resolve(services.cwd, options.source) },
			// eslint-disable-next-line unicorn/no-null -- JSON distinguishes an unknown proposed version.
			version: null,
		};
	}
	const selected = await namedDefinition(name, endpoint.repo, services);
	return { candidate: selected, version: selected.metadata.version };
}

// Filter identity and native completion before decoding or assessing candidate state.
// eslint-disable-next-line max-statements
async function inspectCheckpoint(
	record: BeadRow,
	candidate: {
		definition: Definition;
		discovery: DiscoveryDiagnostic[];
		endpoint: Endpoint;
		name: string;
		version: string | null;
	},
	services: Services,
): Promise<RunAssessment | undefined> {
	const { id } = record;
	const identity = checkpointIdentity(record.description, id, candidate.discovery);
	if (
		!identity ||
		identity.definition.kind !== "named" ||
		identity.definition.name !== candidate.name
	) {
		return undefined;
	}
	const parent = await readBead(candidate.endpoint, identity.id, services);
	if (parent.status === "closed") {
		return undefined;
	}
	let result: RunAssessment = {
		checkpoint: id,
		findings: [],
		id: identity.id,
		status: "unchecked",
	};
	try {
		const run = readCheckpoint(record);
		result = assessRun({
			run,
			checkpoint: id,
			definition: candidate.definition,
			version: candidate.version,
		});
	} catch (error) {
		result = {
			checkpoint: id,
			findings: [{ check: "checkpoint_header", message: message(error), status: "failed" }],
			id: identity.id,
			status: "incompatible",
		};
	}
	check(result.findings, "checkpoint_relation", () => {
		if (!parent.dependencies.some((edge) => edge.id === id && edge.dependency_type === "related")) {
			throw new Error(
				`Run ${parent.id} has no related edge to checkpoint ${id}; inspect partial initialization or native provenance`,
			);
		}
	});
	if (record.notes.trim()) {
		result.findings.push({
			check: "checkpoint_lock",
			message:
				`Checkpoint ownership is retained: ${record.notes}` +
				". Inspect its owner and any uncertain effects before execution.",
			status: "unchecked",
		});
	}
	result.status = assessmentStatus(result.findings);
	return result;
}

// eslint-disable-next-line max-statements -- Render the frontier once, then assess each independent frozen visit.
function assessFrontier(
	input: { active: ActiveEntry[]; root: WorkflowActor; definition: Definition },
	findings: Finding[],
): void {
	const { active, root, definition } = input;
	let entries: ReturnType<typeof frontier> = [];
	check(findings, "current_frontier", () => {
		entries = frontier(root);
	});
	const currentEntries = new Map(entries.map((entry) => [entry.key, entry]));
	const savedEntries = new Map(active.map((entry) => [entry.key, entry]));
	const rendered = new Map<string, ResolvedTask>();
	for (const entry of entries) {
		check(findings, `task_render:${entry.key}`, () => {
			const saved = savedEntries.get(entry.key);
			const context = structuredClone(saved?.context ?? entry.context);
			rendered.set(entry.key, renderTask(entry.meta, context));
		});
	}
	for (const entry of active) {
		const current = currentEntries.get(entry.key);
		check(findings, `active_state:${entry.bead}`, () => {
			if (
				!current ||
				current.node !== entry.node ||
				current.path.length !== entry.path.length ||
				current.path.some((segment, index) => segment !== entry.path[index])
			) {
				throw new Error(
					`Saved active node ${entry.node} at ${entry.path.join("/")} is absent from the proposed frontier`,
				);
			}
		});
		if (current) {
			check(findings, `event_contract:${entry.bead}`, () => {
				const actor = targetActor(root, entry.path);
				const node = actor.getSnapshot().machine.getStateNodeById(entry.node);
				for (const event of Object.values(entry.meta.commands ?? {})) {
					if (!declaresEvent(node, event)) {
						throw new Error(
							`Frozen event ${event} is absent from active node ${entry.node} and its ancestors`,
						);
					}
				}
			});
		}
		const proposed = rendered.get(entry.key);
		if (proposed) {
			check(findings, `command_contract:${entry.bead}`, () =>
				verifyCommands(entry.meta.commands, proposed.commands, definition.commandSchemas),
			);
		} else {
			findings.push({
				check: `command_contract:${entry.bead}`,
				message: "No proposed task could be rendered; frozen command mapping is unchecked.",
				status: "unchecked",
			});
		}
	}
}

// Keep restoration failures and one indexed traversal of saved children together.
// eslint-disable-next-line max-statements
function verifyActorTree(actor: WorkflowActor, saved: PersistedActor): void {
	const snapshot = actor.getSnapshot();
	if (snapshot.status === "error") {
		throw snapshot.error;
	}
	const savedChildren = Object.entries(saved.children ?? {});
	if (savedChildren.length === EMPTY) {
		return;
	}
	const children = new Map(childActors(actor).map((child) => [child.id, child]));
	for (const [id, child] of savedChildren) {
		const restored = children.get(id);
		if (!restored) {
			throw new Error(`Saved child actor ${id} has no proposed actor logic`);
		}
		verifyActorTree(restored, child.snapshot);
	}
}

function checkpointIdentity(
	description: string,
	checkpoint: string,
	discovery: DiscoveryDiagnostic[],
): z.infer<typeof diagnosticIdentitySchema> | undefined {
	try {
		const identity = diagnosticIdentitySchema.parse(JSON.parse(description) as unknown);
		if (
			identity.definition.kind !== "source" &&
			(identity.definition.kind !== "named" || !identity.definition.name)
		) {
			throw new Error("Cannot establish saved workflow identity");
		}
		return identity;
	} catch (error) {
		discovery.push({
			checkpoint,
			message: `Cannot attribute checkpoint to a workflow: ${message(error)}`,
		});
		// TypeScript requires an explicit return at this failed decode boundary.
		// eslint-disable-next-line no-useless-return
		return undefined;
	}
}

function reportStatus(
	runs: RunAssessment[],
	discovery: DiscoveryDiagnostic[],
): PreflightReport["status"] {
	if (discovery.length > EMPTY || runs.some((run) => run.status === "incompatible")) {
		return "incompatible";
	}
	return "unchecked";
}

function check(findings: Finding[], name: string, operation: () => void): void {
	try {
		operation();
		findings.push({ check: name, message: "Passed for this saved frontier.", status: "passed" });
	} catch (error) {
		findings.push({ check: name, message: message(error), status: "failed" });
	}
}

function assessmentStatus(findings: Finding[]): RunAssessment["status"] {
	if (findings.some((finding) => finding.status === "failed")) {
		return "incompatible";
	}
	return "unchecked";
}

function message(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}
