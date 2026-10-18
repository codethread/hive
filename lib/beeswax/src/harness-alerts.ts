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
				"Stop Beads workflows and ordinary tracker operations on this endpoint; do not merge. " +
				"Unrelated non-Beads work and explicitly user-authorized recovery may continue. " +
				"Poll or background bounded alert wait; announce verified clearance before resuming."
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
		return activeContext(
			database,
			previous.id,
			"Verified clearance is unavailable; the observed hold remains.",
		);
	}
	await io.write(
		path,
		JSON.stringify({ database, id: alert.id, generation: alert.generation, state: alert.state }),
	);
	return (
		`Beeswax tracker alert ${alert.id} for ${database}: verified cleared. ` +
		`Announce clearance before resuming ordinary tracker work. Recovery evidence: ${alert.evidence}`
	);
}

function activeContext(database: string, id: string, reason: string): string {
	const endpoint = shellQuote(database);
	return (
		`Beeswax tracker alert ${id} for ${database} is active. ` +
		"Stop Beads workflows and ordinary tracker operations on this endpoint; do not merge. " +
		"Unrelated non-Beads work may continue. Only an agent explicitly authorized by the user may " +
		"inspect or recover native tracker state; a new session grants no authority. " +
		`Use beeswax beads recover --beads-db ${endpoint} for the handoff. ` +
		`Poll beeswax beads alert status --beads-db ${endpoint} --json or background a bounded ` +
		`beeswax beads alert wait --beads-db ${endpoint} --timeout 60 --json. ` +
		"A failed check or missing receipt is not clearance. Announce verified clearance before resuming. " +
		"This guidance does not establish writer quiescence.\n" +
		`Diagnostics: ${reason}`
	);
}

function unavailable(error: unknown): string {
	return (
		"Beeswax tracker alert check failed. " +
		"Stop Beads workflows and ordinary tracker operations on the selected endpoint; do not merge. " +
		"Unrelated non-Beads work and explicitly user-authorized native tracker inspection/recovery may continue. " +
		"Recheck independent alert status. With no known hold, a healthy check of this endpoint " +
		"with no active incident restores baseline; do not announce clearance. " +
		"Clearance is unverified for any known hold, including a handoff or sync failure. " +
		"A failed check or missing receipt cannot release it. " +
		"Announce verified matching or newer clearance before resuming that work.\n" +
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
