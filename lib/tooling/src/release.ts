import { z } from "zod";

const FIRST = 0;
const TAG_PREFIX_LENGTH = 1;

export const versionSchema = z.string().regex(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u);
export interface PackageHistory {
	/** Repository-relative directory; dot names the root package. */
	directory: string;
	/** Package name from its manifest. */
	name: string;
	/** Current package version, before the suite bump. */
	version: string;
	/** Git's abbreviated commit ID and subject, newest first. */
	commits: string[];
}

/** Choose the newest stable suite tag reachable from the release source. */
export function previousRelease(tags: string[]): string | undefined {
	return tags
		.filter(
			(tag) => tag.startsWith("v") && versionSchema.safeParse(tag.slice(TAG_PREFIX_LENGTH)).success,
		)
		.toSorted((left, right) =>
			Bun.semver.order(right.slice(TAG_PREFIX_LENGTH), left.slice(TAG_PREFIX_LENGTH)),
		)[FIRST];
}

/** Refuse duplicate/downgrade releases before changing any files. */
export function checkNextVersion(
	next: string,
	packages: PackageHistory[],
	previous: string | undefined,
): void {
	const current = packages.map((pkg) => pkg.version);
	if (previous !== undefined) {
		current.push(previous.slice(TAG_PREFIX_LENGTH));
	}
	if (current.some((version) => Bun.semver.order(next, version) <= FIRST)) {
		throw new Error(
			`Next suite version ${next} must exceed every package and previous release version.`,
		);
	}
}

/** Every package gets an entry, including packages with no commits in this release. */
export function releaseNotes(
	version: string,
	previous: string | undefined,
	packages: PackageHistory[],
): string {
	let range = "Initial release; all Git history.";
	if (previous !== undefined) {
		range = `Changes since ${previous}.`;
	}
	const sections = packages.map((pkg) => {
		let changes = "No change.";
		if (pkg.commits.length > FIRST) {
			changes = pkg.commits.map((commit) => `- ${commit}`).join("\n");
		}
		return `## ${pkg.name}\n\n${changes}`;
	});
	return `# Hive ${version}\n\n${range}\n\n${sections.join("\n\n")}\n`;
}
