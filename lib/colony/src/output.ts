import type { ColonyStatus, PolicyRevision, PolicyView } from "@hive/shared";
import type { AssessmentsResult } from "./assessments.ts";
import type { DaemonResponse } from "./client.ts";
import type { Explanation } from "./explain.ts";
import type { HistoryResult } from "./history.ts";
import type { InitializedResult } from "./producer.ts";
import type { RestartedDaemon } from "./daemon-lifecycle.ts";
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
type Result =
	| AssessmentsResult
	| Explanation
	| HistoryResult
	| DaemonResponse
	| InitializedResult
	| LaunchedResult
	| RestartedDaemon
	| DaemonCompletedResult;

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
			{ kind: "restarted" },
			({ daemon, supervisor }) =>
				`Daemon restarted: ${daemon.id} (PID ${daemon.pid})\n` +
				`Supervisor: ${supervisor.service}\nRecovered repositories: ${daemon.colonies.length}`,
		)
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
		.with({ kind: "recovering" }, ({ id }) => `Daemon repository recovery pending: ${id}`)
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
		.with({ kind: "explanation" }, formatExplanation)
		.with({ kind: "assessments" }, formatAssessments)
		.with({ kind: "events" }, formatHistory)
		.with({ kind: "inspection" }, formatInspection)
		.with(
			{ kind: "request-inspection" },
			({ repository, checkpoint, attempts }) =>
				`Repository: ${repository.root}\nRequest: ${checkpoint?.id ?? "No checkpoint"}\n` +
				`Retained attempts: ${attempts.length}`,
		)
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
	let workReviews = "disabled";
	if (policy.autoWorkReviews !== null) {
		workReviews = `${policy.autoWorkReviews.kind}; parent ${policy.autoWorkReviews.parent}`;
	}
	return [
		`Active policy revision: ${policy.revisionId}`,
		`Formulas: ${policy.formulas.join(", ")}`,
		`Ranking: ${policy.ranking}`,
		formatLimits(policy.limits),
		`Retries: ${policy.maxRetries}; delay ${policy.retryDelayMs}ms`,
		`Inactivity drone: ${policy.inactivityDrone ?? "disabled"}`,
		`Post-run drone: ${policy.postRunDrone ?? "disabled"}`,
		`Automatic work reviews: ${workReviews}`,
	].join("\n");
}
function formatLimits(limits: PolicyView["limits"]): string {
	return (
		`Limits: colony ${limits.colony}; kind ${limits.kind}; worktree ` +
		`${limits.worktree}; named kinds ${JSON.stringify(limits.kinds)}`
	);
}
function formatRevision(revision: PolicyRevision): string {
	return (
		`Revision ${revision.id}: ${revision.source}; actor ` +
		`${revision.actor ?? "unattributed"}; ${revision.createdAt}; formula ` +
		`${revision.formulaName ?? "none"}`
	);
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
			`Request checkpoint ${request.id}: ${request.state}; identity ` +
				`${request.identity}; tasks ${request.taskIds.join(", ")}; attempts ` +
				`${request.attempts}; active attempt ${request.attemptId ?? "none"}; ` +
				`retry at ${request.retryAt ?? "none"}; outcome ` +
				`${request.outcome ?? "none"}`,
			`Request diagnostic: ${request.message}`,
		);
	}
	for (const attempt of result.attempts) {
		lines.push(
			`Attempt ${attempt.id}: ${attempt.state}; request ${attempt.spawnId}; ` +
				`number ${attempt.attemptNumber}; ${attempt.createdAt}`,
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

function formatExplanation(result: Explanation): string {
	return [
		`Request ${result.id}: ${result.repository.root}`,
		`Beads database: ${result.repository.beadsDb}`,
		...result.diagnostics.map(
			(item) =>
				`${item.kind} [${item.code}]: ${item.message}\nNext transition: ` +
				`${item.nextTransition}\nEvidence: ${item.evidence.join(", ")}`,
		),
		...(["tracker", "runtime", "capacity"] as const).map(
			(name) => `${name}: ${JSON.stringify(result[name])}`,
		),
		...result.processes.map(
			(item) => `processes:${item.attemptId}: ${JSON.stringify(item.evidence)}`,
		),
	].join("\n");
}

function formatHistory(result: HistoryResult): string {
	return [
		`Operation history: ${result.repository.root}; retained limits ` +
			`${result.retention} finished / ${result.unfinishedRetention} ` +
			`unfinished across daemon`,
		"Start sequence order; unfinished means completion unknown. Checkpoints are historical, not refreshed.",
		...result.events.flatMap((event) => [
			`#${event.sequence} ${event.startedAt} ${event.operation} ` +
				`${event.requestId ?? result.repository.root}: ${event.status}`,
			`Last boundary: ${event.step.operation} ${event.step.target}`,
			`Before: ${JSON.stringify(event.before)}; after (last recorded): ${JSON.stringify(event.after)}`,
			`Known completed effects: ${JSON.stringify(event.completedEffects)}`,
			// eslint-disable-next-line no-ternary -- Optional failure contributes one human diagnostic line.
			...(event.failure
				? [
						`Failure at ${event.failure.step.operation} ` +
							`${event.failure.step.target}: ${event.failure.code ?? "unknown"} ` +
							`(exit ${event.failure.exitCode ?? "unknown"}): ` +
							`${event.failure.message}`,
					]
				: []),
			...event.evidence.map((path) => `Evidence: ${path}`),
		]),
	].join("\n");
}

function formatAssessments({ assessments }: AssessmentsResult): string {
	return (
		assessments
			.map((item) => {
				const lines = [
					`${item.requestId} ${item.id}: ${item.summary}`,
					`Source: ${item.sourcePath ?? "queued"}`,
				];
				if (item.result) {
					lines.push(JSON.stringify(item.result));
				}
				return lines.join("\n");
			})
			.join("\n") || "No matching assessments."
	);
}
