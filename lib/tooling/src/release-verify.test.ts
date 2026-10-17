import { archiveMembers, nativePlatform } from "./release-verify.ts";
import { expect, test } from "bun:test";
import { executables } from "./release.ts";

test("native proof rejects a matrix host mismatch", () => {
	expect(nativePlatform("darwin-arm64", "darwin", "arm64")).toBe("darwin-arm64");
	expect(() => nativePlatform("darwin-arm64", "darwin", "x64")).toThrow(Error);
});

test("tar layout refuses traversal and unexpected files before extraction", () => {
	const members = ["bin/", "release.json", ...executables.map((name) => `bin/${name}`)];
	archiveMembers(members);
	expect(() => archiveMembers([...members, "../outside"])).toThrow(Error);
	expect(() => archiveMembers([...members, "bin/unexpected"])).toThrow(Error);
});
