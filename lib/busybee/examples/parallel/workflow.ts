import { setup } from "xstate";
import { z } from "zod";

export const inputSchema = z.object({});
export const commandSchemas = { approved: z.object({}), next: z.object({}), revise: z.object({}) };
export function runBrief() {
	return {
		description: "Prepare, implement and verify documentation and API branches, then hand off.",
		title: "Parallel implementation",
	};
}

// Commands are scoped to a branch: an unqualified NEXT would reach both regions.
export const machine = setup({}).createMachine({
	id: "parallel-work",
	initial: "prepare",
	states: {
		done: { type: "final" },
		handoff: {
			meta: {
				commands: { next: "REPORTED" },
				instructions: "Summarize both completed branches.",
				title: "Hand off change",
			},
			on: { REPORTED: "done" },
		},
		implementation: {
			meta: {
				instructions: "Complete both branches.",
				title: "Implementation",
			},
			onDone: "handoff",
			states: {
				api: {
					initial: "implement",
					meta: {
						instructions: "Implement and exercise the API.",
						title: "API",
					},
					states: {
						done: { type: "final" },
						implement: {
							meta: {
								commands: { next: "API.IMPLEMENTED" },
								instructions: "Make the API change.",
								title: "Implement API",
							},
							on: { "API.IMPLEMENTED": "verify" },
						},
						verify: {
							meta: {
								commands: { next: "API.VERIFIED" },
								instructions: "Exercise the API contract.",
								title: "Verify API",
							},
							on: { "API.VERIFIED": "done" },
						},
					},
				},
				docs: {
					initial: "write",
					meta: {
						instructions: "Write and check the documentation.",
						title: "Documentation",
					},
					states: {
						check: {
							meta: {
								commands: { approved: "DOCS.APPROVED", revise: "DOCS.REVISE" },
								instructions: "Try the documented command; choose revise if it fails.",
								title: "Check docs",
							},
							on: { "DOCS.APPROVED": "done", "DOCS.REVISE": "write" },
						},
						done: { type: "final" },
						write: {
							meta: {
								commands: { next: "DOCS.WRITTEN" },
								instructions: "Update the usage guide.",
								title: "Write docs",
							},
							on: { "DOCS.WRITTEN": "check" },
						},
					},
				},
			},
			type: "parallel",
		},
		prepare: {
			meta: {
				commands: { next: "PREPARED" },
				instructions: "Identify the change to implement.",
				title: "Prepare change",
			},
			on: { PREPARED: "implementation" },
		},
	},
});
