import type { Platform, ReleaseManifest } from "./release.ts";
import {
	archiveName,
	executables,
	platformSchema,
	platforms,
	releaseManifestSchema,
} from "./release.ts";
import { z } from "zod";

const FIRST = 0;
export const revisionSchema = z.string().regex(/^[a-f\d]{40}$/u);
const embeddedSchema = releaseManifestSchema.omit({ archives: true }).extend({
	platform: platformSchema,
	executables: z.array(z.string()),
});

/** Accept one complete candidate whose manifest and checksum index name the same bytes. */
// eslint-disable-next-line max-statements -- Keep the candidate identity contract together.
export function candidateManifest(value: unknown, sums: string, revision: string): ReleaseManifest {
	const manifest = releaseManifestSchema.parse(value);
	if (manifest.revision !== revision) {
		throw new Error("Candidate revision differs from the requested commit.");
	}
	if (
		manifest.archives.length !== platforms.length ||
		new Set(manifest.archives.map(({ platform }) => platform)).size !== platforms.length
	) {
		throw new Error("Candidate requires exactly one archive for each supported platform.");
	}
	for (const archive of manifest.archives) {
		if (archive.file !== archiveName(manifest.version, archive.platform)) {
			throw new Error(`Archive filename differs from its release identity: ${archive.file}`);
		}
	}
	const expected = manifest.archives.map(({ file, sha256 }) => `${sha256}  ${file}`).toSorted();
	const actual = sums.trim().split("\n").toSorted();
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error("SHA256SUMS differs from the complete manifest.");
	}
	return manifest;
}

/** Reject cross-architecture execution claims before launching candidate executables. */
export function nativePlatform(expected: Platform, os: string, arch: string): Platform {
	const actual = platformSchema.parse(`${os}-${arch}`);
	if (actual !== expected) {
		throw new Error(`Native host ${actual} differs from requested ${expected}.`);
	}
	return actual;
}

/** Validate the extracted metadata and exact companion placement against the outer manifest. */
export function embeddedRelease(
	value: unknown,
	{ manifest, platform, names }: { manifest: ReleaseManifest; platform: Platform; names: string[] },
): void {
	const embedded = embeddedSchema.parse(value);
	if (
		embedded.version !== manifest.version ||
		embedded.revision !== manifest.revision ||
		embedded.bunVersion !== manifest.bunVersion ||
		embedded.platform !== platform ||
		!sameNames(embedded.executables, executables) ||
		!sameNames(names, executables)
	) {
		throw new Error("Embedded release identity or executable placement differs from the manifest.");
	}
}

/** Inspect tar member names before extraction so only the canonical release layout is accepted. */
export function archiveMembers(members: string[]): void {
	const files = members.filter((name) => name !== "bin/" && name !== "bin");
	if (!sameNames(files, ["release.json", ...executables.map((name) => `bin/${name}`)])) {
		throw new Error("Archive members differ from the canonical release layout.");
	}
}

// --- Private functions ---

function sameNames(left: string[], right: string[]): boolean {
	return (
		left.length > FIRST && JSON.stringify(left.toSorted()) === JSON.stringify(right.toSorted())
	);
}
