/* eslint-disable unicorn/no-null -- Match the public JSON provenance contract. */
import { expect, test } from "bun:test";
import { installationInfo } from "./info.ts";
import { version } from "../package.json";

const HASH_LENGTH = 40;
const revision = "a".repeat(HASH_LENGTH);
const release = JSON.stringify({ version, revision, executables: ["beeswax"] });

test("installation info uses the packaged revision and points to exact source without guessing a clone", async () => {
	const paths: string[] = [];
	const result = await installationInfo("/cellar/hive/bin/beeswax", {
		read: (path) => {
			paths.push(path);
			return Promise.resolve(release);
		},
	});
	expect(result).toMatchObject({
		version,
		revision,
		metadata: "/cellar/hive/share/hive/release.json",
		source: { status: "not_installed", ref: revision },
	});
	expect(paths).toEqual(["/cellar/hive/share/hive/release.json"]);
});

test("missing metadata reports unknown revision and a version-pinned route", async () => {
	const result = await installationInfo("/bin/beeswax", { read: () => Promise.resolve("") });
	expect(result).toMatchObject({
		version,
		revision: null,
		metadata: null,
		source: {
			status: "not_installed",
			ref: `v${version}`,
			url: `https://github.com/codethread/hive/tree/v${version}`,
		},
	});
});

test("mismatched release metadata fails rather than attributing another revision", async () => {
	await expect(
		installationInfo("/bin/beeswax", {
			read: () =>
				Promise.resolve(JSON.stringify({ version: "0.0.0", revision, executables: ["beeswax"] })),
		}),
	).rejects.toMatchObject({ reason: "invalid_release_metadata" });
});
