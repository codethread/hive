import { BeadsGitConflictError, notifyBeadsConflict } from "@hive/shared";
import type { Command, TrackerEnvironment } from "./environment.ts";
import type { BeadsConflictNotificationIO } from "@hive/shared";
import type { BeadsService } from "@hive/beads";
// eslint-disable-next-line import/no-nodejs-modules -- Host identity in conflict diagnostics.
import { hostname } from "node:os";
// eslint-disable-next-line import/no-nodejs-modules -- Repository CLI filesystem paths.
import { join } from "node:path";
import { lock } from "proper-lockfile";
import { trackerRoot } from "./environment.ts";
import { validateStagedSnapshot } from "../git/validate.ts";

const snapshot = ".beads/issues.jsonl";
const publicationAttempts = 3;
const lockRetryCount = 120;
const lockRetryDelayMs = 250;
const initialAttempt = 0;
const nextAttempt = 1;

interface Tracker {
	/** Absolute runtime database selected by project configuration. */
	database: string;
	/** Remote hosting the accepted tracker branch. */
	remote: string;
	/** Permanent checkout retaining the local runtime and live export. */
	root: string;
}

export interface PublicationServices {
	/** Git subprocess boundary; an explicit index isolates publication staging. */
	command: (argv: readonly string[], cwd: string, index?: string) => Promise<string>;
	/** Native sync boundary, separate from Git. */
	beads: BeadsService;
	/** Write the two Git inputs consumed by native synchronization. */
	write: (path: string, contents: string) => Promise<void>;
}

/** Reconcile through native br, then publish its export without a Git checkout merge. */
export async function syncBeads(
	environment: TrackerEnvironment,
	services: PublicationServices,
	notificationIO?: BeadsConflictNotificationIO,
): Promise<void> {
	const tracker = await selectTracker(environment, services.command);
	try {
		await publishTracker(tracker, services);
	} catch (error) {
		await notifyBeadsConflict(
			error,
			{
				beadsDb: tracker.database,
				host: hostname(),
				operation: "beeswax beads sync",
				root: process.cwd(),
			},
			notificationIO,
		);
		throw error;
	}
}

/** Serialize local Hive publishers; native br coordinates with ordinary tracker writers. */
export async function withTrackerLock<Result>(
	environment: TrackerEnvironment,
	action: () => Promise<Result>,
): Promise<Result> {
	const release = await lock(environment.BEADS_DB, {
		lockfilePath: join(trackerRoot(environment.BEADS_DB), ".beads/.hive-sync.lock"),
		retries: {
			factor: nextAttempt,
			maxTimeout: lockRetryDelayMs,
			minTimeout: lockRetryDelayMs,
			retries: lockRetryCount,
		},
	});
	try {
		return await action();
	} finally {
		await release();
	}
}
// --- Private functions ---

async function publishTracker(tracker: Tracker, services: PublicationServices): Promise<void> {
	await assertIndexReady(tracker, services.command);
	/* eslint-disable no-await-in-loop -- Retry only an observed concurrent remote publication. */
	for (let attempt = initialAttempt; attempt < publicationAttempts; attempt += nextAttempt) {
		const accepted = await receive(tracker, services);
		if (await pushSnapshot(tracker, accepted, services.command)) {
			return;
		}
	}
	/* eslint-enable no-await-in-loop */
	throw new Error(
		"Tracker remote changed repeatedly. Local state is retained; retry synchronization before working.",
	);
}

async function selectTracker(environment: TrackerEnvironment, command: Command): Promise<Tracker> {
	const root = trackerRoot(environment.BEADS_DB);
	const branch = await command(["git", "branch", "--show-current"], root);
	if (branch !== "tracker/state") {
		throw new Error(`Expected tracker/state at ${root}; found ${branch}.`);
	}
	const remote = await command(["git", "config", "--get", "branch.tracker/state.remote"], root);
	const mergeRef = await command(["git", "config", "--get", "branch.tracker/state.merge"], root);
	if (remote === "." || mergeRef !== "refs/heads/tracker/state") {
		throw new Error("tracker/state must track a remote tracker/state branch.");
	}
	return { database: environment.BEADS_DB, remote, root };
}

async function assertIndexReady(tracker: Tracker, command: Command): Promise<void> {
	const unmerged = await command(["git", "diff", "--name-only", "--diff-filter=U"], tracker.root);
	if (unmerged !== "") {
		throw new BeadsGitConflictError(unmerged);
	}
	const staged = await command(["git", "diff", "--cached", "--name-only"], tracker.root);
	if (
		staged
			.split("\n")
			.filter(Boolean)
			.some((path) => path !== snapshot)
	) {
		throw new Error(
			"Tracker has staged configuration changes; finish that work before publication.",
		);
	}
}

// eslint-disable-next-line max-statements -- Keep native reconciliation between Git input and publication.
async function receive(tracker: Tracker, services: PublicationServices): Promise<string> {
	const { command, beads } = services;
	await command(["git", "fetch", tracker.remote, "tracker/state"], tracker.root);
	const head = await command(["git", "rev-parse", "HEAD"], tracker.root);
	const accepted = await command(["git", "rev-parse", "@{upstream}"], tracker.root);
	// Git ancestry supplies the shared base; the last local native export does not.
	const ancestor = await command(["git", "merge-base", head, accepted], tracker.root);
	const base = join(tracker.root, ".beads/hive-sync-base.jsonl");
	const from = join(tracker.root, ".beads/hive-sync-incoming.jsonl");
	await Promise.all([
		writeGitSnapshot(tracker, { revision: ancestor, path: base }, services),
		writeGitSnapshot(tracker, { revision: accepted, path: from }, services),
	]);
	await beads.sync.merge({ cwd: tracker.root, db: tracker.database }, { base, from });
	await commitSnapshot(tracker, { head, accepted, ancestor }, command);
	return accepted;
}

async function writeGitSnapshot(
	tracker: Tracker,
	input: { revision: string; path: string },
	services: PublicationServices,
): Promise<void> {
	const contents = await services.command(
		["git", "show", `${input.revision}:${snapshot}`],
		tracker.root,
	);
	await services.write(input.path, contents);
}

// eslint-disable-next-line max-statements -- Stage one export blob and retain both histories without checkout.
async function commitSnapshot(
	tracker: Tracker,
	revisions: { head: string; accepted: string; ancestor: string },
	command: PublicationServices["command"],
): Promise<void> {
	const { head, accepted, ancestor } = revisions;
	const index = join(tracker.root, ".beads/hive-sync.index");
	const blob = await command(["git", "hash-object", "-w", "--", snapshot], tracker.root);
	// Preserve accepted non-snapshot files without publishing local configuration edits.
	await command(["git", "read-tree", accepted], tracker.root, index);
	await command(
		["git", "update-index", "--add", "--cacheinfo", `100644,${blob},${snapshot}`],
		tracker.root,
		index,
	);
	await validateStagedSnapshot(tracker.root, (argv, cwd) => command(argv, cwd, index));
	const tree = await command(["git", "write-tree"], tracker.root, index);
	const acceptedTree = await command(["git", "rev-parse", `${accepted}^{tree}`], tracker.root);
	let commit = accepted;
	if (tree !== acceptedTree || ancestor !== head) {
		const parents = ["-p", head];
		if (ancestor !== accepted) {
			parents.push("-p", accepted);
		}
		commit = await command(
			["git", "commit-tree", tree, ...parents, "-m", "chore(beads): synchronize tracker state"],
			tracker.root,
		);
	}
	if (commit !== head) {
		await command(["git", "update-ref", "refs/heads/tracker/state", commit, head], tracker.root);
		await command(["git", "read-tree", commit], tracker.root);
	}
}

async function pushSnapshot(
	tracker: Tracker,
	accepted: string,
	command: Command,
): Promise<boolean> {
	const head = await command(["git", "rev-parse", "HEAD"], tracker.root);
	if (head === accepted) {
		return true;
	}
	try {
		await command(["git", "push", tracker.remote, "HEAD:refs/heads/tracker/state"], tracker.root);
		return true;
	} catch (error) {
		await command(["git", "fetch", tracker.remote, "tracker/state"], tracker.root);
		if ((await command(["git", "rev-parse", "@{upstream}"], tracker.root)) === accepted) {
			throw error;
		}
		return false;
	}
}
