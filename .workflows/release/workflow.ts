import { assign, setup } from "xstate";
import { z } from "zod";

const text = z.string().trim().nonempty();
const repository = z.string().regex(/^[\w.-]+\/[\w.-]+$/u);
const revision = z.string().regex(/^[a-f\d]{40}$/u);
const evidence = z.object({ evidence: text });
const landed = evidence.extend({ revision });

export const inputSchema = z.object({
	nextVersion: z.string().regex(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u),
	request: text.describe(
		"Explicit user authorization to publish this version to these destinations.",
	),
	releaseRepository: repository.describe(
		"Existing GitHub repository serving public release archives.",
	),
	tapRepository: repository.describe(
		"Existing GitHub tap repository; an explicit tap URL also supports a source repository.",
	),
	tapCheckout: text.describe("Clean local checkout of that tap; formula path is Formula/hive.rb."),
	canonicalRoot: text.describe("Canonical Hive checkout retained after Land cleanup."),
	beadsDb: text.describe("Permanent tracker endpoint, retained after Land cleanup."),
	artifactDirectory: text.describe(
		"Absolute output directory outside the disposable release worktree; must not exist.",
	),
});

export const commandSchemas = { next: evidence, landed, changes: evidence };
type ReleaseInput = z.infer<typeof inputSchema>;
interface ReleaseContext extends ReleaseInput {
	/** Evidence carried from the last completed visit. */
	evidence: string;
	/** Landed source commit; absent until Land completes. */
	revision: string | undefined;
}
interface ReleaseEvent {
	/** Only the Land visit supplies a source commit. */
	type: "NEXT" | "LANDED" | "CHANGES";
	/** Original payload is validated by Busy Bee before transition. */
	data: unknown;
}

export function runBrief(input: ReleaseInput): { title: string; description: string } {
	return {
		title: `Release Hive ${input.nextVersion}`,
		description:
			`${input.request}\nPublish v${input.nextVersion} to ${input.releaseRepository}; ` +
			`update ${input.tapRepository} from ${input.tapCheckout}. Retain ${input.canonicalRoot}, ` +
			`${input.beadsDb} and artifacts ${input.artifactDirectory}. This is a separately invoked release; ` +
			"Land never starts it automatically. All packages advance together; Waggle is excluded from archives. " +
			"Record evidence on visits, record-result before closure, then collect. Busy Bee closes the run. " +
			"After done, the authorized caller closes proven scope tasks and publishes final tracker evidence once. " +
			"On retry inspect existing tags, releases and tap commits; " +
			"never replace published artifacts or replay closed work.",
	};
}

export const machine = setup({
	types: { context: {} as ReleaseContext, input: {} as ReleaseInput, events: {} as ReleaseEvent },
	actions: {
		record: assign(({ event }) => evidence.parse(event.data)),
		recordRevision: assign(({ event }) => landed.parse(event.data)),
		clearRevision: assign({ revision: undefined }),
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
				title: "Verify release authorization and destinations",
				commands: { next: "NEXT" },
				task: ({ context }: { context: ReleaseContext }) => ({
					instructions:
						`Read docs/releases.md. Verify actual user authorization: ${context.request}. ` +
						`Version ${context.nextVersion} must exceed every package and latest reachable stable vX.Y.Z tag. ` +
						`Verify gh authentication and write access to existing ${context.releaseRepository} and ` +
						`${context.tapRepository}; public archive URLs must work without credentials. Do not create ` +
						"repositories or change visibility without explicit authorization. Pushing the source tag also " +
						"publishes its reachable source history; authorization must cover that disclosure. " +
						"Fetch tags and inspect " +
						"any existing tag/release before proceeding; an already published version requires reconciliation, " +
						"not replacement. Verify the clean tap checkout remote and default branch. Verify br/bv upstream " +
						"formulae and consumed dependency contract; record versions. Retain canonical checkout and tracker. " +
						"Use Honeycomb to create a nested release worktree for the version commit. Missing authorization, " +
						"credentials, destinations or incompatible dependencies keep this visit open with a precise next action. " +
						`Artifact destination: ${context.artifactDirectory}.`,
				}),
			},
			on: { NEXT: { actions: "record", target: "prepare" } },
		},
		prepare: {
			meta: {
				title: "Prepare suite versions and package changelogs",
				commands: { next: "NEXT" },
				task: ({ context }: { context: ReleaseContext }) => ({
					instructions:
						`In the clean release worktree run bun run release prepare ${context.nextVersion}. ` +
						"Inspect the resulting manifest/lockfile diff and releases/vVERSION.md against Git history since " +
						"the latest reachable stable suite tag. All workspace packages, including unchanged packages and " +
						"Waggle, get the same version; unchanged packages explicitly say No change. CLI versions read " +
						"their package manifests. Busy Bee manifest compatibility versions remain independent. " +
						"If interrupted, inspect partial file effects before restoring only owned edits and rerunning. " +
						`Record branch, prior tag and notes path. Prior evidence: ${context.evidence}`,
				}),
			},
			on: { NEXT: { actions: "record", target: "land" } },
		},
		land: {
			meta: {
				title: "Check, review and land the release preparation",
				commands: { landed: "LANDED" },
				task: ({ context }: { context: ReleaseContext }) => ({
					instructions:
						"Use the existing named Land workflow for the prepared version/changelog change, " +
						"parented beneath this Release run with completedTasks: []. Supply the actual publishing " +
						"authorization as landing context. Resume an already-created Land run on retry; do not duplicate it. " +
						"Wait for Land status done, including check, review, integration, local build/install and cleanup. " +
						"Defer tracker publication until this surrounding release completes. Read canonical main and " +
						"record its exact 40-character integrated commit as revision; verify suite versions and notes " +
						`there. Canonical ${context.canonicalRoot}; BEADS_DB ${context.beadsDb}. ${context.evidence}`,
				}),
			},
			on: { LANDED: { actions: "recordRevision", target: "build" } },
		},
		build: {
			meta: {
				title: "Build immutable release archives and formula",
				commands: { next: "NEXT", changes: "CHANGES" },
				task: ({ context }: { context: ReleaseContext }) => ({
					instructions:
						`From ${context.canonicalRoot}, run bun run release build --revision ${context.revision} ` +
						`--output ${context.artifactDirectory}. Omit --target to build all four macOS/Linux arm64/x64 archives. ` +
						"The command extracts the commit and installs frozen dependencies without repository setup hooks. " +
						"Inspect manifest.json, SHA256SUMS and each embedded release.json for the same source revision, " +
						`version ${context.nextVersion}, nine executables and no Waggle. Then run bun run release formula ` +
						`--artifacts ${context.artifactDirectory} --repository ${context.releaseRepository} ` +
						`--output ${context.artifactDirectory}/hive.rb. Validate Ruby syntax. On interruption inspect any ` +
						"partial output and move owned unpublished output aside before retrying the same path. " +
						"Never overwrite published artifacts. Choose changes for a source defect " +
						"requiring repair and renewed Land.",
				}),
			},
			on: {
				NEXT: { actions: "record", target: "verify" },
				CHANGES: { actions: "record", target: "repair" },
			},
		},
		verify: {
			meta: {
				title: "Verify archives on every advertised platform",
				commands: { next: "NEXT", changes: "CHANGES" },
				task: ({ context }: { context: ReleaseContext }) => ({
					instructions:
						"Follow docs/releases.md verification. Check SHA256SUMS before extraction on native " +
						"macOS arm64/x64 and Linux arm64/x64 runners. All nine --version outputs must equal " +
						`${context.nextVersion}. Exercise public --help commands outside any checkout, qlock status, ` +
						"Busy Bee loading a disposable installed-dependency workflow, and Hive UI embedded assets. " +
						"Verify Colony companion resolution; do not launch production services. Check br/bv consumed " +
						"contracts and Homebrew installation/test with local archive URLs in a disposable tap. " +
						"Record platform-specific evidence; cross-compilation alone is not a native execution test. " +
						"Missing runners keep this visit open. Choose changes for a source defect; the repair route " +
						"requires a forward fix, renewed Land and fresh archives before verification. " +
						`Artifacts: ${context.artifactDirectory}; source ${context.revision}.`,
				}),
			},
			on: {
				NEXT: { actions: "record", target: "publish" },
				CHANGES: { actions: "record", target: "repair" },
			},
		},
		repair: {
			entry: "clearRevision",
			meta: {
				title: "Repair the unpublished release candidate",
				commands: { next: "NEXT" },
				task: ({ context }: { context: ReleaseContext }) => ({
					instructions:
						`Repair the source defect in a new nested worktree: ${context.evidence}. ` +
						`Keep the unpublished suite version ${context.nextVersion}; do not repeat its version bump. ` +
						"Refresh its package changelog sections against the previous release tag to include the fix. " +
						"Record focused verification and the repair branch. Prove no tag/release has been published, " +
						`then move owned artifacts at ${context.artifactDirectory} aside with their failed-candidate ` +
						"evidence so the original output path is free for the new build. External publication already " +
						"present or mismatched effects block this repair; never replace a published version. " +
						"Choose next to run Land again and capture the new integrated source revision.",
				}),
			},
			on: { NEXT: { actions: "record", target: "land" } },
		},
		publish: {
			meta: {
				title: "Publish the verified Git tag and GitHub release",
				commands: { next: "NEXT" },
				task: ({ context }: { context: ReleaseContext }) => ({
					instructions:
						`Reconfirm authorization and verified artifact evidence: ${context.evidence}. ` +
						`Publish annotated tag v${context.nextVersion} pointing exactly at ${context.revision} to ` +
						`${context.releaseRepository}, following docs/releases.md. Create a draft GitHub release, ` +
						"upload only the four archives, manifest.json, SHA256SUMS and hive.rb from the saved artifact " +
						"directory and use releases/vVERSION.md for notes. Download draft assets and compare bytes before " +
						"publishing the draft. Verify anonymous URLs and SHA-256 again after publication. " +
						"On retry inspect existing tag target, release/draft and asset digests. Continue matching partial " +
						"effects only; mismatched tags/assets block. Never force a tag or clobber an uploaded asset. " +
						"Record actual release URL, source/tag and verified hashes; submission alone is not publication.",
				}),
			},
			on: { NEXT: { actions: "record", target: "tap" } },
		},
		tap: {
			meta: {
				title: "Update and verify the Homebrew tap",
				commands: { next: "NEXT" },
				task: ({ context }: { context: ReleaseContext }) => ({
					instructions:
						`In clean ${context.tapCheckout}, verify remote ${context.tapRepository} and fetch ` +
						"its default branch. Copy the generated hive.rb to Formula/hive.rb without changing URLs/hashes. " +
						"Run brew style, brew audit and an actual install/test against the published assets; verify all " +
						"nine executable versions, mandatory br/bv dependencies and no install-time tracker or service " +
						"startup. Follow that repository's commit/review/push policy. Wait for actual merged/pushed " +
						"tap revision and verify clean-install availability using its fully qualified formula name. " +
						"On retry retain matching existing formula/tap commits rather than duplicating updates. " +
						"Comment on the Release run with source/tag, release URL, hashes, native tests, tap commit, " +
						"installation and cleanup evidence. Missing credentials or failed install keeps this visit open. " +
						"After saving/closing/collecting this result Busy Bee closes the run; the caller performs final " +
						"scope closure and tracker publication. " +
						`Published evidence: ${context.evidence}`,
				}),
			},
			on: { NEXT: { actions: "record", target: "done" } },
		},
		done: { type: "final" },
	},
});
