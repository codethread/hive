import type { ColonyStatus, PolicyRevision, PolicyView } from "@hive/shared";
import type { DaemonResponse } from "./client.ts";
import type { InitializedResult } from "./producer.ts";
import { match } from "ts-pattern";
import { z } from "zod";

const SUCCESS = 0;

/** Parse the manual launcher boundary while retaining its full receipt payload. */
export const launchedResultSchema = z
	.looseObject({
		directory: z.string(),
		identity: z.string(),
		outcome: z.strictObject({ code: z.literal(SUCCESS), kind: z.literal("exited") }),
		spawnId: z.string(),
	})
	.transform((receipt) => ({ ...receipt, kind: "launched" as const }));
export type LaunchedResult = z.infer<typeof launchedResultSchema>;
interface DaemonCompletedResult {
	/** Foreground daemon completed successfully. */
	kind: "daemon_completed";
	/** Native successful process exit status. */
	exitCode: typeof SUCCESS;
}
type Result = DaemonResponse | InitializedResult | LaunchedResult | DaemonCompletedResult;

export function writeColonyResult(
	result: Result,
	json: boolean,
	stdout: (text: string) => void,
): void {
	if (json) {
		stdout(`${JSON.stringify({ ok: true, ...result })}\n`);
		return;
	}
	stdout(`${formatResult(result)}\n`);
}

// --- Private functions ---
function formatResult(result: Result): string {
	return match(result)
		.with({ kind: "initialized" }, ({ path }) => `Created canonical configuration: ${path}`)
		.with(
			{ kind: "launched" },
			({ spawnId, identity, directory }) =>
				`Launched request ${spawnId} as ${identity}; worker exited successfully.\nReceipt and logs: ${directory}`,
		)
		.with({ kind: "daemon_completed" }, () => "Foreground daemon stopped successfully.")
		.with({ kind: "stopped" }, () => "Daemon stopped.")
		.with(
			{ kind: "awake" },
			({ repository }) => `Colony awake: ${repository.root}\nBeads database: ${repository.beadsDb}`,
		)
		.with(
			{ kind: "registered" },
			({ repository }) =>
				`Colony registered: ${repository.root}\nBeads database: ${repository.beadsDb}`,
		)
		.with(
			{ kind: "slept" },
			({ repository }) =>
				`Colony asleep: ${repository.root}\nBeads database: ${repository.beadsDb}`,
		)
		.with(
			{ kind: "removed" },
			({ repository, attempts }) =>
				`Colony removed: ${repository.root}\nRetained attempts: ${attempts.length}`,
		)
		.with({ kind: "status" }, ({ id, pid, socket, state, colonies }) =>
			[
				`Daemon ${id} (PID ${pid})`,
				`Socket: ${socket}`,
				`State directory: ${state}`,
				...colonies.map((colony) => formatColony(colony)),
			].join("\n"),
		)
		.with({ kind: "config" }, ({ repository, active, history }) =>
			[
				`Repository: ${repository.root}`,
				`Beads database: ${repository.beadsDb}`,
				formatPolicy(active),
				...history.map((revision) => formatRevision(revision)),
			].join("\n"),
		)
		.with({ kind: "inspection" }, formatInspection)
		.exhaustive();
}
function formatColony(colony: ColonyStatus): string {
	const lines = [
		`Colony ${colony.repository.root}: ${colony.state} (${colony.registration}; intent ${colony.intent})`,
		`Beads database: ${colony.repository.beadsDb}`,
		`Retained attempts: ${colony.attempts.length}`,
	];
	if (colony.state === "failed") {
		lines.push(`Failure: ${colony.message}`);
	}
	if (colony.policy !== null) {
		lines.push(`Ranking: ${colony.policy.ranking}`, formatLimits(colony.policy.limits));
	}
	return lines.join("\n");
}
function formatPolicy(policy: PolicyView | null): string {
	if (policy === null) {
		return "Active policy: none";
	}
	return [
		`Active policy revision: ${policy.revisionId}`,
		`Formulas: ${policy.formulas.join(", ")}`,
		`Ranking: ${policy.ranking}`,
		formatLimits(policy.limits),
		`Retries: ${policy.maxRetries}; delay ${policy.retryDelayMs}ms`,
	].join("\n");
}
function formatLimits(limits: PolicyView["limits"]): string {
	return `Limits: colony ${limits.colony}; kind ${limits.kind}; worktree ${limits.worktree}; named kinds ${JSON.stringify(limits.kinds)}`;
}
function formatRevision(revision: PolicyRevision): string {
	return `Revision ${revision.id}: ${revision.source}; actor ${revision.actor ?? "unattributed"}; ${revision.createdAt}; formula ${revision.formulaName ?? "none"}`;
}
function formatInspection(result: Extract<DaemonResponse, { kind: "inspection" }>): string {
	const lines = [
		`Repository: ${result.repository.root}`,
		`Beads database: ${result.repository.beadsDb}`,
		`Observed at: ${result.observedAt}`,
		"Request checkpoints are last reconciled state; native tracker status is not refreshed by inspection.",
	];
	if (result.colony === null) {
		lines.push("Colony registration: absent (retained records only)");
	} else {
		lines.push(formatColony(result.colony));
	}
	for (const request of result.requests) {
		lines.push(
			`Request checkpoint ${request.id}: ${request.state}; identity ${request.identity}; tasks ${request.taskIds.join(", ")}; attempts ${request.attempts}; active attempt ${request.attemptId ?? "none"}; retry at ${request.retryAt ?? "none"}; outcome ${request.outcome ?? "none"}`,
			`Request diagnostic: ${request.message}`,
		);
	}
	for (const attempt of result.attempts) {
		lines.push(
			`Attempt ${attempt.id}: ${attempt.state}; request ${attempt.spawnId}; number ${attempt.attemptNumber}; ${attempt.createdAt}`,
			`Identity: ${attempt.identity}; recipe ${attempt.kind} / ${attempt.harness} / ${attempt.model}`,
			`Tasks: ${attempt.taskIds.join(", ")}`,
			`Execution cwd: ${attempt.cwd}`,
			`Bucket: ${attempt.bucket}`,
			`Policy revision: ${attempt.policyRevisionId ?? "none"}`,
			...Object.entries(attempt.paths).map(([name, path]) => `${name}: ${path}`),
		);
	}
	lines.push(...result.history.map((revision) => formatRevision(revision)));
	return lines.join("\n");
}
