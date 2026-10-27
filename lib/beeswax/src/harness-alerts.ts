/* eslint-disable unicorn/no-null -- Null represents an absent alert, never clearance. */
import type { Command } from "commander";
import type { TrackerAlertObservation } from "./beads/alerts.ts";
import type { WorkspaceIO } from "./services.ts";
import { errorMessage } from "./errors.ts";
import { shellQuote } from "./hooks.ts";
import { z } from "zod";

const harnessSchema = z.enum(["claude", "codex", "pi"]);
const NONEMPTY = 1;
const inputSchema = z.compile(
	z.object({
		session_id: z.string().min(NONEMPTY),
		cwd: z.string().min(NONEMPTY),
		hook_event_name: z.enum(["SessionStart", "UserPromptSubmit", "PostToolUse", "context"]),
	}),
);
const receiptSchema = z.compile(
	z.strictObject({
		database: z.string(),
		id: z.string(),
		generation: z.number().int().positive(),
		state: z.enum(["active", "cleared"]),
	}),
);
type Harness = z.infer<typeof harnessSchema>;
type HookInput = z.infer<typeof inputSchema>;

export interface HarnessAlertDependencies extends Pick<WorkspaceIO, "read" | "write"> {
	/** Observe the explicitly selected/configured endpoint without invoking native Beads. */
	observe: (cwd: string) => Promise<TrackerAlertObservation | undefined>;
	/** Durable user-state path keyed by selected endpoint and native session, outside tracker files. */
	receiptPath: (database: string, session: { harness: string; id: string }) => string;
	/** Native hook input, not CLI arguments or model context. */
	stdin: () => Promise<string>;
	/** Vendor protocol output, never an ordinary CLI envelope. */
	stdout: (text: string) => void;
}

/** Register a dedicated vendor-protocol command; prime remains offline. */
export function addAlertHooks(program: Command, deps: HarnessAlertDependencies): void {
	program
		.command("harness-alert")
		.description("Deliver selected-tracker recovery guidance through a native harness callback")
		.requiredOption("--harness <name>", "claude, codex or pi")
		.option("--input <json>", "Pi context callback payload (other harnesses use stdin)")
		.action(async function hook(this: Command) {
			const options = this.opts<{ harness: string; input?: string }>();
			const harness = harnessSchema.parse(options.harness);
			const output = await runHarnessAlert(harness, options.input ?? (await deps.stdin()), deps);
			deps.stdout(`${JSON.stringify(output)}\n`);
		});
}

/** Observe once per callback and retain only the session's latest incident observation. */
export async function runHarnessAlert(
	harness: Harness,
	input: string,
	deps: Pick<HarnessAlertDependencies, "observe" | "read" | "write" | "receiptPath">,
): Promise<object> {
	let event: HookInput = { session_id: "", cwd: "", hook_event_name: "SessionStart" };
	try {
		event = inputSchema.parse(JSON.parse(input));
		const observed = await deps.observe(event.cwd);
		if (observed === undefined) {
			return hookOutput(harness, event.hook_event_name, "");
		}
		const context = await sessionContext({ harness, id: event.session_id }, observed, deps);
		return hookOutput(harness, event.hook_event_name, context);
	} catch (error) {
		return hookOutput(harness, event.hook_event_name, unavailable(error));
	}
}

// --- Private functions ---

// eslint-disable-next-line max-statements -- Keep the receipt and observation transition together.
async function sessionContext(
	session: { harness: string; id: string },
	observation: TrackerAlertObservation,
	io: Pick<HarnessAlertDependencies, "read" | "write" | "receiptPath">,
): Promise<string> {
	const { database, alert } = observation;
	const path = io.receiptPath(database, session);
	const contents = await io.read(path);
	let previous: z.infer<typeof receiptSchema> | undefined = undefined;
	if (contents !== "") {
		previous = receiptSchema.parse(JSON.parse(contents));
	}
	if (previous && previous.database !== database) {
		throw new Error("Session alert receipt belongs to another tracker");
	}
	if (
		previous &&
		alert?.state === "active" &&
		(alert.generation < previous.generation ||
			(alert.generation === previous.generation && alert.id !== previous.id))
	) {
		throw new Error("Cannot accept an older or unrelated active alert observation");
	}
	if (alert?.state === "active") {
		if (
			previous?.state === "active" &&
			previous.id === alert.id &&
			previous.generation === alert.generation
		) {
			return (
				`Beeswax tracker alert ${alert.id} for ${database} remains active. ` +
				"Keep Beads work and merges involving this endpoint paused; independent non-Beads work may continue. " +
				"Follow beeswax skills get tracker-recovery to wait for verified clearance."
			);
		}
		await io.write(
			path,
			JSON.stringify({ database, id: alert.id, generation: alert.generation, state: alert.state }),
		);
		return activeContext(database, alert.id, alert.reason);
	}
	if (previous?.state !== "active") {
		return "";
	}
	if (
		alert?.state !== "cleared" ||
		alert.generation < previous.generation ||
		(alert.generation === previous.generation && alert.id !== previous.id)
	) {
		return (
			`Beeswax tracker hold ${previous.id} for ${database} remains: verified clearance is unavailable. ` +
			"Keep Beads work and merges involving this endpoint paused; independent non-Beads work may continue. " +
			"Follow beeswax skills get tracker-recovery to recheck; missing state does not release this hold."
		);
	}
	await io.write(
		path,
		JSON.stringify({ database, id: alert.id, generation: alert.generation, state: alert.state }),
	);
	return (
		`Beeswax tracker alert ${alert.id} for ${database}: verified cleared. ` +
		"Stop polling this incident, announce clearance once, " +
		"and resume ordinary Beads work and merges involving this endpoint."
	);
}

function activeContext(database: string, id: string, reason: string): string {
	const endpoint = shellQuote(database);
	return (
		`Beeswax tracker alert ${id} for ${database} is active. ` +
		"Pause Beads workflows, ordinary tracker operations and merges involving this endpoint. " +
		"Independent non-Beads work may continue. " +
		"Read beeswax skills get tracker-recovery for waiting or explicitly user-authorized recovery. " +
		`Use beeswax beads recover --beads-db ${endpoint} for the incident handoff.\n` +
		`Diagnostics: ${reason}`
	);
}

function unavailable(error: unknown): string {
	return (
		"Beeswax tracker alert check failed; the selected endpoint's incident state is unverified. " +
		"Pause Beads work and merges involving this endpoint; independent non-Beads work may continue. " +
		"This failure does not establish a new incident or clear a known hold. " +
		"Read beeswax skills get tracker-recovery to recheck status and decide when work can resume.\n" +
		`Diagnostics: ${errorMessage(error)}`
	);
}

function hookOutput(harness: Harness, event: string, context: string): object {
	if (harness === "pi") {
		return { context };
	}
	if (context === "") {
		return {};
	}
	return { hookSpecificOutput: { hookEventName: event, additionalContext: context } };
}
