import type { Command, TrackerEnvironment } from "./beads-environment.ts";
// eslint-disable-next-line no-duplicate-imports -- Type-only imports are required separately.
import { resolveEnvironment, runCommand, trackerRoot } from "./beads-environment.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Repository CLI filesystem paths.
import { join } from "node:path";
import { lock } from "proper-lockfile";
// eslint-disable-next-line import/no-nodejs-modules -- Remove only the owned freshness marker.
import { rm } from "node:fs/promises";
import { z } from "zod";

interface Tracker {
	/** Absolute runtime database selected by project configuration. */
	database: string;
	/** Native executable, bypassing the coordinated br entrypoint internally. */
	native: string;
	/** Remote hosting the accepted tracker branch. */
	remote: string;
	/** Full checkout retaining merge-driver and quality-hook code. */
	root: string;
}

const snapshot = ".beads/issues.jsonl";
const publicationAttempts = 3;
const lockRetryCount = 120;
const lockRetryDelayMs = 250;
const initialAttempt = 0;
const nextAttempt = 1;
const freshnessIntervalMs = 30_000;
const successSchema = z.object({ checkedAt: z.number() });

const successPath = (environment: TrackerEnvironment): string =>
	join(trackerRoot(environment.BEADS_DB), ".beads/.hive-sync-success");

const invalidateSuccess = async (environment: TrackerEnvironment): Promise<void> => {
	await rm(successPath(environment), { force: true });
};

const recordSuccess = async (environment: TrackerEnvironment): Promise<void> => {
	await Bun.write(successPath(environment), JSON.stringify({ checkedAt: Date.now() }));
};

const readSuccess = async (environment: TrackerEnvironment): Promise<number> => {
	const file = Bun.file(successPath(environment));
	if (await file.exists()) {
		return successSchema.parse(await file.json()).checkedAt;
	}
	return initialAttempt;
};

const selectTracker = async (
	environment: TrackerEnvironment,
	command: Command,
): Promise<Tracker> => {
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
	return { database: environment.BEADS_DB, native: environment.HIVE_BR_BIN, remote, root };
};

const assertCleanScope = async (tracker: Tracker, command: Command): Promise<void> => {
	const unmerged = await command(["git", "diff", "--name-only", "--diff-filter=U"], tracker.root);
	if (unmerged !== "") {
		throw new Error(
			`BEADS CONFLICT: unresolved tracker merge in ${tracker.root}: ${unmerged}. Resolve it before continuing.`,
		);
	}
	const changes = await command(["git", "status", "--porcelain"], tracker.root);
	if (
		changes
			.split("\n")
			.filter(Boolean)
			.some((line) => !line.endsWith(` ${snapshot}`))
	) {
		throw new Error(
			`Tracker checkout has changes outside ${snapshot}; review them before synchronization.`,
		);
	}
};

const reconcileDatabase = async (tracker: Tracker, command: Command): Promise<void> => {
	await command([tracker.native, "--db", tracker.database, "sync", "--merge"], tracker.root);
};

const commitSnapshot = async (tracker: Tracker, command: Command): Promise<void> => {
	const diff = await command(["git", "diff", "HEAD", "--", snapshot], tracker.root);
	if (diff !== "") {
		await command(["git", "add", "--update", "--", snapshot], tracker.root);
		await command(["git", "commit", "-m", "chore(beads): publish tracker state"], tracker.root);
	}
};

const checkpoint = async (tracker: Tracker, command: Command): Promise<void> => {
	await assertCleanScope(tracker, command);
	await reconcileDatabase(tracker, command);
	await command([tracker.native, "--db", tracker.database, "sync", "--flush-only"], tracker.root);
	await commitSnapshot(tracker, command);
};

const receive = async (tracker: Tracker, command: Command): Promise<string> => {
	await command(["git", "fetch", tracker.remote], tracker.root);
	const accepted = await command(["git", "rev-parse", "@{upstream}"], tracker.root);
	const ancestor = await command(["git", "merge-base", "HEAD", accepted], tracker.root);
	if (ancestor !== accepted) {
		await command(
			["git", "merge", "-m", "chore(beads): receive tracker updates", accepted],
			tracker.root,
		);
		await reconcileDatabase(tracker, command);
		await commitSnapshot(tracker, command);
	}
	return accepted;
};

const pushSnapshot = async (
	tracker: Tracker,
	accepted: string,
	command: Command,
): Promise<boolean> => {
	const head = await command(["git", "rev-parse", "HEAD"], tracker.root);
	if (head === accepted) {
		return true;
	}
	try {
		await command(["git", "push", tracker.remote, "HEAD:refs/heads/tracker/state"], tracker.root);
		return true;
	} catch (error) {
		await command(["git", "fetch", tracker.remote], tracker.root);
		if ((await command(["git", "rev-parse", "@{upstream}"], tracker.root)) === accepted) {
			throw error;
		}
		return false;
	}
};

const syncBeads = async (environment: TrackerEnvironment, command: Command): Promise<void> => {
	const tracker = await selectTracker(environment, command);
	await invalidateSuccess(environment);
	// Retry only an observed concurrent remote publication, never a forced push.
	/* eslint-disable no-await-in-loop */
	for (let attempt = initialAttempt; attempt < publicationAttempts; attempt += nextAttempt) {
		await checkpoint(tracker, command);
		const accepted = await receive(tracker, command);
		if (await pushSnapshot(tracker, accepted, command)) {
			await recordSuccess(environment);
			return;
		}
	}
	/* eslint-enable no-await-in-loop */
	throw new Error(
		"Tracker remote changed repeatedly. Local state is retained; retry synchronization before working.",
	);
};

const checkBeadsHealth = async (
	environment: TrackerEnvironment,
	command: Command,
): Promise<void> => {
	const tracker = await selectTracker(environment, command);
	await assertCleanScope(tracker, command);
	await reconcileDatabase(tracker, command);
	const pending = await command(["git", "diff", "HEAD", "--", snapshot], tracker.root);
	const lastSuccess = await readSuccess(environment);
	if (pending !== "" || Date.now() - lastSuccess >= freshnessIntervalMs) {
		await syncBeads(environment, command);
	}
};

const withTrackerLock = async <Result>(
	environment: TrackerEnvironment,
	action: () => Promise<Result>,
): Promise<Result> => {
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
};

if (import.meta.main) {
	const environment = await resolveEnvironment(process.cwd(), runCommand);
	await withTrackerLock(environment, () => syncBeads(environment, runCommand));
}

export { checkBeadsHealth, syncBeads, withTrackerLock };
