import { BeadsGitConflictError, notifyBeadsConflict } from "@hive/shared";
import type { Command, TrackerEnvironment } from "./beads-environment.ts";
import { CommandError, createNativeBeads } from "@hive/beads";
// eslint-disable-next-line no-duplicate-imports -- Type-only imports are required separately.
import { resolveEnvironment, runCommand, trackerRoot } from "./beads-environment.ts";
import type { BeadsConflictNotificationIO } from "@hive/shared";
import type { BeadsService } from "@hive/beads";
// eslint-disable-next-line import/no-nodejs-modules -- Host identity in conflict diagnostics.
import { hostname } from "node:os";
// eslint-disable-next-line import/no-nodejs-modules -- Repository CLI filesystem paths.
import { join } from "node:path";
import { lock } from "proper-lockfile";

const snapshot = ".beads/issues.jsonl";
const publicationAttempts = 3;
const lockRetryCount = 120;
const lockRetryDelayMs = 250;
const initialAttempt = 0;
const nextAttempt = 1;
const SUCCESS = 0;

interface Tracker {
	/** Absolute runtime database selected by project configuration. */
	database: string;
	/** Remote hosting the accepted tracker branch. */
	remote: string;
	/** Full checkout retaining merge-driver and quality-hook code. */
	root: string;
}

export interface PublicationServices {
	/** Git subprocess boundary. */
	command: Command;
	/** Native sync boundary, separate from Git. */
	beads: BeadsService;
}

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
				operation: "bun run beads:sync",
				root: process.cwd(),
			},
			notificationIO,
		);
		throw error;
	}
}

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
	// Retry only an observed concurrent remote publication, never a forced push.
	/* eslint-disable no-await-in-loop */
	for (let attempt = initialAttempt; attempt < publicationAttempts; attempt += nextAttempt) {
		await checkpoint(tracker, services);
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

async function assertCleanScope(tracker: Tracker, command: Command): Promise<void> {
	const unmerged = await command(["git", "diff", "--name-only", "--diff-filter=U"], tracker.root);
	if (unmerged !== "") {
		throw new BeadsGitConflictError(unmerged);
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
}

async function reconcileDatabase(tracker: Tracker, services: PublicationServices): Promise<void> {
	await services.beads.sync.merge({
		cwd: tracker.root,
		db: tracker.database,
	});
}

async function commitSnapshot(tracker: Tracker, command: Command): Promise<void> {
	const diff = await command(["git", "diff", "HEAD", "--", snapshot], tracker.root);
	if (diff !== "") {
		await command(["git", "add", "--update", "--", snapshot], tracker.root);
		await command(["git", "commit", "-m", "chore(beads): publish tracker state"], tracker.root);
	}
}

async function checkpoint(tracker: Tracker, services: PublicationServices): Promise<void> {
	await assertCleanScope(tracker, services.command);
	await reconcileDatabase(tracker, services);
	await services.beads.sync.flush({
		cwd: tracker.root,
		db: tracker.database,
	});
	await commitSnapshot(tracker, services.command);
}

async function receive(tracker: Tracker, services: PublicationServices): Promise<string> {
	const { command } = services;
	await command(["git", "fetch", tracker.remote], tracker.root);
	const accepted = await command(["git", "rev-parse", "@{upstream}"], tracker.root);
	const ancestor = await command(["git", "merge-base", "HEAD", accepted], tracker.root);
	if (ancestor !== accepted) {
		await mergeSnapshot(tracker, accepted, command);
		await reconcileDatabase(tracker, services);
		await commitSnapshot(tracker, command);
	}
	return accepted;
}

async function mergeSnapshot(tracker: Tracker, accepted: string, command: Command): Promise<void> {
	try {
		await command(
			["git", "merge", "-m", "chore(beads): receive tracker updates", accepted],
			tracker.root,
		);
	} catch (error) {
		const unmerged = await command(["git", "diff", "--name-only", "--diff-filter=U"], tracker.root);
		if (unmerged !== "") {
			throw new BeadsGitConflictError(unmerged, { cause: error });
		}
		throw error;
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
		await command(["git", "fetch", tracker.remote], tracker.root);
		if ((await command(["git", "rev-parse", "@{upstream}"], tracker.root)) === accepted) {
			throw error;
		}
		return false;
	}
}

if (import.meta.main) {
	const environment = await resolveEnvironment(process.cwd(), runCommand);
	await withTrackerLock(environment, () =>
		syncBeads(environment, {
			beads: createNativeBeads({ execute: runPublicationCommand }),
			command: runPublicationCommand,
		}),
	);
}

/** Retain stdout diagnostics from native --json operations and visible subprocess stderr. */
async function runPublicationCommand(
	argv: readonly string[],
	cwd: string,
	env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
	const child = Bun.spawn([...argv], { cwd, env, stderr: "pipe", stdout: "pipe" });
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (stderr !== "") {
		process.stderr.write(stderr);
	}
	if (code !== SUCCESS) {
		throw new CommandError(argv.join(" "), { code, stderr, stdout });
	}
	return stdout.trim();
}
