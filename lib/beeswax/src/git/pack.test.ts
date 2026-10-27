/* eslint-disable require-await -- Injected native-command fixtures do no real IO. */
import { expect, test } from "bun:test";
import { BeeswaxError } from "../errors.ts";
import { packRepository } from "./pack.ts";

const before = "count: 20\nsize: 80\nin-pack: 3\npacks: 2\nsize-pack: 16\ngarbage: 0";
const after = "count: 0\nsize: 0\nin-pack: 23\npacks: 1\nsize-pack: 12\ngarbage: 0";

test("packing retains unreachable objects and reports explicitly sized storage observations #test-726", async () => {
	const commands: (readonly string[])[] = [];
	const remaining = ["/repo/.git", before, "", after];
	const result = await packRepository("/repo", async (argv, cwd) => {
		expect(cwd).toBe("/repo");
		commands.push(argv);
		return remaining.shift() ?? "";
	});
	expect(result).toEqual({
		repository: "/repo",
		commonDirectory: "/repo/.git",
		before: { looseObjects: 20, looseKiB: 80, packedObjects: 3, packs: 2, packedKiB: 16 },
		after: { looseObjects: 0, looseKiB: 0, packedObjects: 23, packs: 1, packedKiB: 12 },
	});
	expect(commands).toEqual([
		["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
		["git", "count-objects", "-v"],
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
		["git", "count-objects", "-v"],
	]);
});

test("a failed repack stops before the after observation and retains the original failure", async () => {
	const failure = new Error("native repack failed");
	const remaining = ["/repo/.git", before];
	const calls: string[] = [];
	const pending = packRepository("/repo", async () => {
		calls.push("native command");
		const output = remaining.shift();
		if (output === undefined) {
			throw failure;
		}
		return output;
	});
	await expect(pending).rejects.toBe(failure);
	expect(calls).toEqual(["native command", "native command", "native command"]);
});

test("failed final inspection reports the already completed repack", async () => {
	const remaining = ["/repo/.git", before, ""];
	const pending = packRepository("/repo", async () => {
		const output = remaining.shift();
		if (output === undefined) {
			throw new Error("inspection failed");
		}
		return output;
	});
	await expect(pending).rejects.toBeInstanceOf(BeeswaxError);
	await expect(pending).rejects.toMatchObject({
		reason: "packing_observation_failed",
		context: {
			repository: "/repo",
			commonDirectory: "/repo/.git",
			repackCompleted: true,
			before: { looseObjects: 20, looseKiB: 80, packedObjects: 3, packs: 2, packedKiB: 16 },
		},
	});
});
