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
			`${input.request}\nPublish source tag v${input.nextVersion} and release notes to ` +
			`${input.releaseRepository}, then land its source-building Formula/hive.rb in the ` +
			`same repository. Follow docs/releases.md. Retain ${input.canonicalRoot} and ` +
			`${input.beadsDb}. After done, the authorized caller ` +
			`closes proven scope tasks and publishes final tracker evidence once.`,
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
						`Follow the authorization guidance in docs/releases.md#prepare-and-land-the-source ` +
						`for the actual user request: ${context.request}. ` +
						`Verify gh authentication, write access and anonymous source access for ` +
						`${context.releaseRepository}; confirm the canonical checkout remote is this ` +
						`repository. Fetch tags and inspect existing release/tag/formula effects before ` +
						`continuing. Version ${context.nextVersion} must exceed the latest stable suite tag. ` +
						`For new preparation it must also exceed every package; an already-prepared ` +
						`unpublished matching version may be reused. Verify the maintained Bun, br and bv ` +
						`Homebrew dependencies. Create a nested Honeycomb release worktree; retain ` +
						`${context.canonicalRoot} and permanent BEADS_DB ${context.beadsDb}. Missing ` +
						`authorization or credentials keeps this visit open with its next action.`,
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
						`Follow docs/releases.md#prepare-and-land-the-source and bun run release --help ` +
						`to prepare ${context.nextVersion}. If all manifests already equal the unpublished ` +
						`version, reconcile the existing preparation and refresh notes and changelog drafts without rerunning ` +
						`the version bump. ` +
						`Review all package versions and lockfiles. Validate declared changelog blocks under ` +
						`docs/releases.md#author-tool-changelog-records. Have bookworm complete the guide's review of ` +
						`generated per-tool changelogs and releases/vVERSION.md before Land; retain its response ` +
						`and coverage in the evidence. On interruption inspect partial changes ` +
						`before restoring only owned edits and retrying. Record the worktree and prior tag. ` +
						`Prior evidence: ${context.evidence}`,
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
						`Follow docs/releases.md#prepare-and-land-the-source to start or resume ordinary ` +
						`Land. Wait for done and record the exact integrated source commit. Complete the guide's ` +
						`verification of that source and its offline changelog commands before publication. ` +
						`Canonical ${context.canonicalRoot}; BEADS_DB ${context.beadsDb}. ${context.evidence}`,
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
						`Follow docs/releases.md#publish-the-source-release to publish annotated ` +
						`v${context.nextVersion} pointing exactly at ${context.revision} in ` +
						`${context.releaseRepository}, using that source's releases/v${context.nextVersion}.md. ` +
						`Complete the guide's publication verification and record the release URL, exact ` +
						`source and source checksum. ${context.evidence}`,
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
						`Follow docs/releases.md#land-the-homebrew-formula to land Formula/hive.rb for ` +
						`v${context.nextVersion} in ${context.releaseRepository}, anchored at ` +
						`${context.canonicalRoot}. Complete the guide's build, installation verification ` +
						`and Land steps, retaining v${context.nextVersion} on ${context.revision}. Record ` +
						`the required release, formula, installation and cleanup evidence on this run. ` +
						`Published evidence: ${context.evidence}`,
				}),
			},
			on: { NEXT: { actions: "record", target: "done" } },
		},
		done: { type: "final" },
	},
});
