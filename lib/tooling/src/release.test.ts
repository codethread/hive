import type { PackageHistory, ReleaseManifest } from "./release.ts";
import {
	archiveName,
	checkNextVersion,
	executables,
	homebrewFormula,
	platforms,
	previousRelease,
	releaseNotes,
} from "./release.ts";
import { expect, test } from "bun:test";

const COMMIT_LENGTH = 40;
const DIGEST_LENGTH = 64;
const FIRST = 0;
const AFTER_FIRST = 1;

const packages: PackageHistory[] = [
	{
		directory: "lib/colony",
		name: "@hive/colony",
		version: "0.5.0",
		commits: ["abc123 feat: workers"],
	},
	{ directory: "lib/beads", name: "@hive/beads", version: "0.5.0", commits: [] },
];
const manifest: ReleaseManifest = {
	version: "0.6.0",
	revision: "a".repeat(COMMIT_LENGTH),
	bunVersion: "1.4.2",
	archives: platforms.map((platform) => ({
		platform,
		file: archiveName("0.6.0", platform),
		sha256: "b".repeat(DIGEST_LENGTH),
	})),
};

test("suite history selects stable version tags, not package tags or prereleases", () => {
	expect(previousRelease(["v0.9.0", "v0.10.0", "v1.0.0-rc.1", "colony-v9.0.0", "vbad"])).toBe(
		"v0.10.0",
	);
	expect(previousRelease([])).toBeUndefined();
});

test.each(["0.4.0", "0.5.0", "0.6.0"])(
	"rejects version %s below packages or previous tag",
	(version) => {
		expect(() => checkNextVersion(version, packages, "v0.6.0")).toThrow(Error);
	},
);

test("package changelog keeps unchanged packages explicit and identifies the Git range", () => {
	checkNextVersion("0.6.0", packages, "v0.5.0");
	expect(releaseNotes("0.6.0", "v0.5.0", packages)).toBe(
		"# Hive 0.6.0\n\nChanges since v0.5.0.\n\n## @hive/colony\n\n" +
			"- abc123 feat: workers\n\n## @hive/beads\n\nNo change.\n",
	);
	expect(releaseNotes("0.6.0", undefined, packages)).toContain("Initial release; all Git history.");
});

test("formula selects immutable archives with mandatory dependencies and every companion", () => {
	const formula = homebrewFormula(manifest, "owner/releases");
	for (const platform of platforms) {
		expect(formula).toContain(
			`https://github.com/owner/releases/releases/download/v0.6.0/hive-0.6.0-${platform}.tar.gz`,
		);
	}
	for (const name of executables) {
		expect(formula).toContain(`"bin/${name}"`);
	}
	expect(formula).toContain('depends_on "dicklesworthstone/tap/br"');
	expect(formula).toContain('depends_on "dicklesworthstone/tap/bv"');
	expect(formula).not.toContain("waggle");
	expect(formula).not.toContain("post_install");
	expect(formula).not.toContain("service do");
});

test("formula rejects incomplete, duplicate or incorrectly named platform archives", () => {
	expect(() =>
		homebrewFormula({ ...manifest, archives: manifest.archives.slice(AFTER_FIRST) }, "owner/repo"),
	).toThrow(Error);
	expect(() =>
		homebrewFormula(
			{ ...manifest, archives: platforms.map(() => manifest.archives[FIRST]!) },
			"owner/repo",
		),
	).toThrow(Error);
	expect(() =>
		homebrewFormula(
			{
				...manifest,
				archives: manifest.archives.map(({ platform, sha256 }) => ({
					platform,
					sha256,
					file: "wrong.tar.gz",
				})),
			},
			"owner/repo",
		),
	).toThrow(Error);
});
