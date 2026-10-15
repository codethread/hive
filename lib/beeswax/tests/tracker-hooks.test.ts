/* eslint-disable require-await -- In-memory IO returns the asynchronous production contract. */
import { expect, test } from "bun:test";
import { BeeswaxError } from "../src/errors.ts";
import { defaultProjectConfig } from "../src/config.ts";
import { fixture } from "./support.ts";
import { installTrackerHooks } from "../src/tracker-hooks.ts";

const EMPTY = 0;
const tracker = "/repo/.worktrees/tracker--state";
const options = {
	repository: "/repo",
	database: "/repo/.worktrees/tracker--state/.beads/beads.db",
	executable: "/installed/beeswax",
	config: {
		...defaultProjectConfig("husky"),
		tracker: {
			hooks: {
				pre_commit: ".husky/_/pre-commit",
				pre_merge_commit: ".husky/_/pre-merge-commit",
				commit_msg: ".husky/_/commit-msg",
			},
		},
	},
};

test("a selected database on main cannot receive the permanent tracker runtime", async () => {
	const fx = fixture();
	const { command } = fx.deps;
	fx.deps.command = async (argv, cwd) => {
		if (argv.includes("--show-current")) {
			return "main";
		}
		return await command(argv, cwd);
	};
	await expect(installTrackerHooks(options, fx.deps)).rejects.toBeInstanceOf(BeeswaxError);
	expect(fx.files.size).toBe(EMPTY);
	expect(fx.commands).toEqual([]);
});

test.each([{ delegate: ".husky/_/commit-msg" }, { delegate: "./.husky/_/commit-msg" }])(
	"Husky wrapper $delegate does not prove that required application policy exists",
	async ({ delegate }) => {
		const fx = fixture();
		fx.files.set(`${tracker}/.husky/pre-commit`, "echo application commit\n");
		fx.files.set(`${tracker}/.husky/pre-merge-commit`, "echo application merge\n");
		fx.files.set(`${tracker}/.husky/_/commit-msg`, '#!/bin/sh\n. "$(dirname "$0")/h"');
		const before = new Map(fx.files);
		const config = {
			...options.config,
			tracker: { hooks: { ...options.config.tracker.hooks, commit_msg: delegate } },
		};
		const failure = await installTrackerHooks({ ...options, config }, fx.deps).catch(
			(error: unknown) => error,
		);
		expect(failure).toBeInstanceOf(BeeswaxError);
		expect(failure).toMatchObject({
			context: { nextCommand: "beeswax migrate hooks", requiresUser: true },
		});
		expect(fx.files).toEqual(before);
	},
);
