import { BeeswaxError, errorMessage } from "../errors.ts";
import type { WorkspaceIO } from "../services.ts";

const minimumCount = 0;

export interface ObjectStorage {
	/** Number of loose Git objects. */
	looseObjects: number;
	/** Loose-object disk usage reported by Git, in KiB. */
	looseKiB: number;
	/** Number of packed object representations, including duplicates. */
	packedObjects: number;
	/** Number of object packs. */
	packs: number;
	/** Pack and index disk usage reported by Git, in KiB. */
	packedKiB: number;
}

export interface PackingResult {
	/** Checkout used as the working directory for Git commands. */
	repository: string;
	/** Common Git metadata directory; object-directory overrides can point elsewhere. */
	commonDirectory: string;
	/** Storage observed before packing; concurrent Git writes can change it. */
	before: ObjectStorage;
	/** Storage observed after packing, not an atomic repository snapshot. */
	after: ObjectStorage;
}

/** Repack Git objects, retaining unreachable objects and removing only redundant copies. */
export async function packRepository(
	repository: string,
	command: WorkspaceIO["command"],
): Promise<PackingResult> {
	const commonDirectory = await command(
		["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
		repository,
	);
	const before = await inspectStorage(repository, command);
	await command(
		[
			"git",
			"--no-lazy-fetch",
			"-c",
			"gc.auto=0",
			"-c",
			"maintenance.auto=false",
			"repack",
			"-a",
			"-d",
			"--keep-unreachable",
			"--no-cruft",
			"--no-filter",
			"-n",
			"--threads=2",
			"--window-memory=256m",
		],
		repository,
	);
	try {
		const after = await inspectStorage(repository, command);
		return { repository, commonDirectory, before, after };
	} catch (error) {
		throw new BeeswaxError(
			"packing_observation_failed",
			`Git repack completed, but storage inspection failed: ${errorMessage(error)}`,
			{ context: { repository, commonDirectory, before, repackCompleted: true } },
		);
	}
}

// --- Private functions ---

async function inspectStorage(
	repository: string,
	command: WorkspaceIO["command"],
): Promise<ObjectStorage> {
	const output = await command(["git", "count-objects", "-v"], repository);
	const fields: Record<string, string> = Object.fromEntries(
		output.split("\n").map((line) => line.split(": ")),
	);
	const count = (field: string): number => {
		const value = Number(fields[field]);
		if (!Number.isSafeInteger(value) || value < minimumCount) {
			throw new Error(`Invalid git count-objects value for ${field}: ${fields[field]}`);
		}
		return value;
	};
	return {
		looseObjects: count("count"),
		looseKiB: count("size"),
		packedObjects: count("in-pack"),
		packs: count("packs"),
		packedKiB: count("size-pack"),
	};
}
