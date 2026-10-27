import { assign, setup } from "xstate";
import { z } from "zod";

const text = z.string().trim().nonempty();
const evidence = z.object({ evidence: text });
const landed = evidence.extend({ revision: z.string().regex(/^[a-f\d]{40}$/u) });

export const inputSchema = z.object({
	nextVersion: z.string().regex(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u),
	request: text.describe("Explicit user authorization to publish this version and source history."),
	releaseRepository: z
		.string()
		.regex(/^[\w.-]+\/[\w.-]+$/u)
		.describe("Public GitHub source repository and Homebrew tap."),
	canonicalRoot: text.describe("Canonical Hive checkout retained after Land cleanup."),
	beadsDb: text.describe("Permanent tracker endpoint retained after Land cleanup."),
});
export const commandSchemas = { next: evidence, landed };
type ReleaseInput = z.infer<typeof inputSchema>;
interface ReleaseContext extends ReleaseInput {
	/** Evidence carried from the last completed visit. */
	evidence: string;
	/** Exact integrated source commit recorded by Land. */
	revision: string | undefined;
}
interface ReleaseEvent {
	/** Land records the source commit; other visits supply evidence. */
	type: "NEXT" | "LANDED";
	/** Busy Bee validates the original outcome payload. */
	data: unknown;
}

export function runBrief(input: ReleaseInput): { title: string; description: string } {
	return {
		title: `Release Hive ${input.nextVersion}`,
		description:
			`User authorization: ${input.request}\nRetain ${input.canonicalRoot} and BEADS_DB ` +
			`${input.beadsDb}. ` +
			"After done, the authorized caller closes proven scope tasks " +
			"and publishes final tracker evidence once with bun run beads:sync.",
	};
}

export const machine = setup({
	types: { context: {} as ReleaseContext, input: {} as ReleaseInput, events: {} as ReleaseEvent },
	actions: {
		record: assign(({ event }) => evidence.parse(event.data)),
		recordRevision: assign(({ event }) => landed.parse(event.data)),
	},
}).createMachine({
	id: "release",
	initial: "preflight",
	context: ({ input }) => ({
		...input,
		evidence: "No release work performed.",
		revision: undefined,
	}),
	states: {
		preflight: {
			meta: {
				title: "Verify source release authorization and destination",
				commands: { next: "NEXT" },
				task: ({ context }: { context: ReleaseContext }) => ({
					instructions:
						`1. Verify public-source authorization, gh access and the destination ` +
						`${context.releaseRepository} ` +
						"under docs/releases.md#prepare-and-land-the-source.\n" +
						`2. Fetch tags and reconcile existing effects for ${context.nextVersion}, ` +
						"then prepare a clean nested Honeycomb worktree.",
				}),
			},
			on: { NEXT: { actions: "record", target: "prepare" } },
		},
		prepare: {
			meta: {
				title: "Prepare suite versions and release notes",
				commands: { next: "NEXT" },
				task: ({ context }: { context: ReleaseContext }) => ({
					instructions:
						`1. Reuse a matching unpublished preparation or prepare ${context.nextVersion} ` +
						"using bun run release --help.\n" +
						"2. Complete Bookworm's changelog and release-note review under " +
						"docs/releases.md#prepare-and-land-the-source before Land.\n\n" +
						`Previous result: ${context.evidence}`,
				}),
			},
			on: { NEXT: { actions: "record", target: "land" } },
		},
		land: {
			meta: {
				title: "Check, review and land the source release",
				commands: { landed: "LANDED" },
				task: ({ context }: { context: ReleaseContext }) => ({
					instructions:
						"1. Complete Land beneath this run with completedTasks: [], " +
						"retaining the exact integrated source commit; only verified integration and " +
						"adoption permit landed. " +
						"For draft-delivered or merged-blocked, keep this visit and source release work " +
						"open without publication.\n" +
						"2. Verify that source's notes and offline changelog commands under " +
						"docs/releases.md#prepare-and-land-the-source before publication.\n\n" +
						`Previous result: ${context.evidence}`,
				}),
			},
			on: { LANDED: { actions: "recordRevision", target: "publish" } },
		},
		publish: {
			meta: {
				title: "Publish the immutable source tag and release notes",
				commands: { next: "NEXT" },
				task: ({ context }: { context: ReleaseContext }) => ({
					instructions:
						`Publish immutable v${context.nextVersion} at ${context.revision} to ` +
						`${context.releaseRepository} ` +
						"under docs/releases.md#publish-the-source-release, verifying the release notes " +
						"and source checksum.\n\n" +
						`Previous result: ${context.evidence}`,
				}),
			},
			on: { NEXT: { actions: "record", target: "tap" } },
		},
		tap: {
			meta: {
				title: "Land and verify the host-built Homebrew formula",
				commands: { next: "NEXT" },
				task: ({ context }: { context: ReleaseContext }) => ({
					instructions:
						`Build, install-test and land Formula/hive.rb for v${context.nextVersion} ` +
						`in ${context.releaseRepository} ` +
						"under docs/releases.md#land-the-homebrew-formula, keeping the published source tag fixed.\n\n" +
						`Previous result: ${context.evidence}`,
				}),
			},
			on: { NEXT: { actions: "record", target: "done" } },
		},
		done: { type: "final" },
	},
});
