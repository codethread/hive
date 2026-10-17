import { checkNextVersion, releaseNotes } from "./release.ts";
import { expect, test } from "bun:test";
import type { PackageHistory } from "./release.ts";

const packages: PackageHistory[] = [
	{
		directory: "lib/colony",
		name: "@hive/colony",
		version: "0.5.0",
		commits: ["abc123 feat: workers"],
	},
	{ directory: "lib/beads", name: "@hive/beads", version: "0.5.0", commits: [] },
];
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
