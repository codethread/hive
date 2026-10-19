/* eslint-disable require-await -- In-memory IO returns the asynchronous production contract. */
import { expect, test } from "bun:test";
import { hookSection, previousHookSection } from "../src/templates.ts";
import { installTrackerHooks, verifyTrackerInitialization } from "../src/tracker-hooks.ts";
import { BeeswaxError } from "../src/errors.ts";
import { defaultProjectConfig } from "../src/config.ts";
import { fixture } from "./support.ts";

const EMPTY = 0;
const LAST = -1;
const tracker = "/repo/.worktrees/tracker--state";
const options = {
	repository: "/repo",
	database: `${tracker}/.beads/beads.db`,
	executable: "/installed/beeswax",
	config: defaultProjectConfig("husky"),
};

test("a selected database on main cannot receive tracker hook integration", async () => {
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

test.each([
	{ body: "" },
	{ body: "echo application policy\n" },
	{ body: `${hookSection} edited` },
	{ body: previousHookSection },
])(
	"unsupported tracker hook leaves policy and local integration untouched: $body",
	async ({ body }) => {
		const fx = fixture();
		fx.files.set(`${tracker}/.husky/pre-commit`, hookSection);
		fx.files.set(`${tracker}/.husky/pre-merge-commit`, body);
		const before = new Map(fx.files);
		const failure = await installTrackerHooks(options, fx.deps).catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(BeeswaxError);
		expect(failure).toMatchObject({
			context: { nextCommand: "beeswax migrate hooks", requiresUser: true },
		});
		expect(fx.files).toEqual(before);
		expect(fx.commands.some((argv) => argv.includes("--local"))).toBe(false);
	},
);

test.each([
	{ adapter: "husky" as const, paths: ["HEAD:.husky/pre-commit", "HEAD:.husky/pre-merge-commit"] },
	{ adapter: "git" as const, paths: [] },
])(
	"initialization checks canonical HEAD for $adapter without writing files",
	async ({ adapter, paths }) => {
		const fx = fixture();
		const reads: { path: string; cwd: string }[] = [];
		fx.deps.exec = async (argv, cwd) => {
			reads.push({ path: argv.at(LAST) ?? "", cwd });
			return { exitCode: EMPTY, stdout: hookSection, stderr: "" };
		};
		await verifyTrackerInitialization(
			"/repo/.worktrees/feature",
			defaultProjectConfig(adapter),
			fx.deps,
		);
		expect(reads).toEqual(paths.map((path) => ({ path, cwd: "/repo" })));
		expect(fx.files.size).toBe(EMPTY);
	},
);
