import type {
	WorkReviewBranch,
	WorkReviewInput,
	WorkReviewRecord,
	WorkReviewRecover,
} from "@hive/shared";
import {
	commandSchemas as blockedCommands,
	inputSchema as blockedInput,
	machine as blockedMachine,
	validateCommand as validateBlocked,
} from "../../../../.workflows/blocked-review/workflow.ts";
import { expect, test } from "bun:test";
import { initialTransition, transition } from "xstate";
import {
	commandSchemas as progressCommands,
	inputSchema as progressInput,
	machine as progressMachine,
	validateCommand as validateProgress,
} from "../../../../.workflows/in-progress-review/workflow.ts";
import type { AnyStateMachine } from "xstate";

const FIRST = 0;
const definitions = [
	{
		branch: "blocked" as const,
		machine: blockedMachine,
		inputSchema: blockedInput,
		commandSchemas: blockedCommands,
		validateCommand: validateBlocked,
	},
	{
		branch: "in_progress" as const,
		machine: progressMachine,
		inputSchema: progressInput,
		commandSchemas: progressCommands,
		validateCommand: validateProgress,
	},
];
const evidence = "SIMULATED chart proof; no examined task mutation or real retry.";

test.each(definitions)(
	"$branch reviews a stale candidate without entering recovery #test-408",
	(entry) => {
		const machine: AnyStateMachine = entry.machine;
		const input = entry.inputSchema.parse(reviewInput(entry.branch));
		const [initial] = initialTransition(machine, input);
		const data = entry.commandSchemas.reviewed.parse({
			evidence,
			decisions: [{ kind: "stale", taskId: "task", fingerprint: "frozen", evidence: [evidence] }],
		});
		entry.validateCommand({ context: initial.context }, "reviewed", data);
		const [completed, effects] = transition(machine, initial, { type: "REVIEWED", data });
		expect(completed.status).toBe("done");
		expect(effects).toEqual([]);
	},
);

test.each(definitions)(
	"$branch preserves exact recovery targets through its ordinary chart #test-447",
	(entry) => {
		const machine: AnyStateMachine = entry.machine;
		const [initial] = initialTransition(
			machine,
			entry.inputSchema.parse(reviewInput(entry.branch)),
		);
		const original = recoveryData(entry.branch);
		const data = entry.commandSchemas.recover.parse(original);
		entry.validateCommand({ context: initial.context }, "recover", data);
		const [recovering, effects] = transition(machine, initial, { type: "RECOVER", data });
		expect(recovering.value).toBe("recover");
		expect(recovering.context.targets).toEqual(original.targets);
		expect(effects).toEqual([]);
	},
);

test.each(definitions)("$branch accepts only its authored input branch", (entry) => {
	let branch: WorkReviewBranch = "blocked";
	if (entry.branch === "blocked") {
		branch = "in_progress";
	}
	expect(entry.inputSchema.safeParse(reviewInput(branch)).success).toBe(false);
});

const invalidCases = [
	"omitted",
	"duplicate",
	"fingerprint",
	"token",
	"request",
	"stable-recovery",
] as const;
test.each([...invalidCases])(
	"shared contextual validation rejects %s",
	// eslint-disable-next-line max-statements -- Keep each invalid field beside its contextual rejection.
	(invalid) => {
		const data = recoveryData("blocked");
		const decision = data.decisions[FIRST]!;
		const target = data.targets[FIRST]!;
		switch (invalid) {
			case "omitted": {
				data.decisions = [];
				break;
			}
			case "duplicate": {
				data.decisions.push(decision);
				break;
			}
			case "fingerprint": {
				decision.record.fingerprint = "changed";
				break;
			}
			case "token": {
				decision.record.token = "different-review";
				break;
			}
			case "request": {
				target.requestId = "another-request";
				break;
			}
			case "stable-recovery": {
				decision.record.classification = "stable";
				break;
			}
		}
		expect(() =>
			validateBlocked({ context: { ...reviewInput("blocked"), targets: [] } }, "recover", data),
		).toThrow(Error);
	},
);

test.each(definitions)(
	"$branch completes after a deferred recovery without another attempt",
	(entry) => {
		const machine: AnyStateMachine = entry.machine;
		const context = { ...reviewInput(entry.branch), targets: recoveryData(entry.branch).targets };
		const recovering = machine.resolveState({ value: "recover", context });
		const data = entry.commandSchemas.recovered.parse({
			evidence,
			results: [
				{
					kind: "deferred",
					taskId: "task",
					requestId: "original-request",
					replacementIds: ["known-partial"],
					reopenedIds: ["known-anchor"],
					evidence: [evidence],
				},
			],
		});
		entry.validateCommand({ context }, "recovered", data);
		const [completed, effects] = transition(machine, recovering, { type: "RECOVERED", data });
		expect(completed.status).toBe("done");
		expect(effects).toEqual([]);
	},
);

function reviewInput(branch: WorkReviewBranch): WorkReviewInput {
	return {
		branch,
		token: "simulated-batch",
		controlParent: "simulated-control",
		candidates: [{ taskId: "task", fingerprint: "frozen", requestId: "original-request" }],
	};
}

function recoveryData(branch: WorkReviewBranch) {
	const record: WorkReviewRecord = {
		branch,
		token: "simulated-batch",
		taskId: "task",
		fingerprint: "frozen",
		classification: "tooling",
		diagnosis: evidence,
		nextAction: evidence,
		evidence: [evidence],
	};
	const target: WorkReviewRecover = {
		branch,
		token: "simulated-batch",
		taskId: "task",
		fingerprint: "frozen",
		requestId: "original-request",
		toolingOnly: true,
		evidence: [evidence],
		continuation: {
			requestId: "original-request",
			sourceId: "task",
			runId: "saved-run",
			closedAt: "2026-10-19T00:00:00.000Z",
			toolingPause: true,
			continue: true,
			authority: {
				requestedBy: "ct",
				taskId: "task",
				commentId: 1,
				author: "original-agent",
				quote: evidence,
			},
		},
	};
	return {
		evidence,
		decisions: [{ kind: "recorded" as const, record, receiptId: FIRST }],
		targets: [target],
	};
}
