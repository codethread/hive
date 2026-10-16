/* eslint-disable require-await -- Test doubles return the production promise contract without real IO. */
import { BeeswaxError, EXIT } from "../../src/errors.ts";
import { expect, test } from "bun:test";
import { fixture } from "../support.ts";
import { hookSection } from "../../src/templates.ts";
import { runCli } from "../../src/cli.ts";

const SINGLE = 1;
const EMPTY = 0;

test("headless setup uses explicit flags, shared defaults and one silent JSON receipt", async () => {
	const fx = preparedHead();
	fx.deps.context.tty = true;
	const code = await runCli(
		[
			"setup",
			"--tracker",
			"init",
			"--prefix",
			"app",
			"--owner",
			"operator",
			"--hooks",
			"none",
			"--environment",
			"none",
			"--no-codex",
			"--json",
		],
		fx.deps,
	);
	expect(code).toBe(EXIT.success);
	expect(fx.errors).toEqual([]);
	expect(fx.output).toHaveLength(SINGLE);
	expect(JSON.parse(fx.output.join(""))).toMatchObject({
		ok: true,
		kind: "repository_setup",
		database: "/repo/.worktrees/tracker--state/.beads/beads.db",
		completed: [
			"local_excludes",
			"tracker",
			"configuration",
			"local_binding",
			"merge_driver",
			"tracker_hooks",
			"hooks",
			"project_lock",
		],
	});
	expect(fx.trackers).toHaveLength(SINGLE);
	expect(fx.trackers.at(EMPTY)).toMatchObject({
		tracker: "init",
		prefix: "app",
		owner: "operator",
		codex: false,
		environment: "none",
	});
});

test("interactive choices and explicit options reach the same deterministic setup", async () => {
	const fx = fixture();
	fx.deps.context.tty = true;
	fx.deps.wizard = async () => ({
		tracker: "none",
		hooks: "husky",
		executable: "/opt/bin/beeswax",
	});
	expect(await runCli(["setup"], fx.deps)).toBe(EXIT.success);
	expect(fx.trackers).toEqual([]);
	expect(fx.files.get("/repo/.git/beeswax/cli")).toContain("exec '/opt/bin/beeswax'");
	expect(fx.files.get("/repo/.husky/pre-commit")).toContain("git rev-parse --git-path beeswax/cli");
	expect(fx.files.get("/repo/.husky/_/h")).toContain("node_modules/.bin");
	expect(fx.commands).toContainEqual(["git", "config", "--local", "core.hooksPath", ".husky/_"]);
});

test("headless setup with no known tracker asks for a concrete flag before writes", async () => {
	const fx = fixture();
	expect(await runCli(["setup", "--yes", "--json"], fx.deps)).toBe(EXIT.usage);
	expect(fx.files.size).toBe(EXIT.success);
	expect(JSON.parse(fx.output.join(""))).toMatchObject({
		ok: false,
		reason: "needs_input",
		missingOptions: ["--tracker"],
	});
});

test("existing endpoint is adopted by default without creating tracker history", async () => {
	const fx = fixture();
	fx.deps.context.beadsDb = "/custom/.beads/beads.db";
	fx.files.set("/custom/.beads/beads.db", "database");
	fx.files.set("/custom/.husky/pre-commit", hookSection);
	fx.files.set("/custom/.husky/pre-merge-commit", hookSection);
	expect(await runCli(["setup", "--hooks", "none", "--json"], fx.deps)).toBe(EXIT.success);
	expect(fx.trackers.at(EMPTY)).toMatchObject({
		tracker: "adopt",
		beadsDb: "/custom/.beads/beads.db",
	});
});

test("setup failure retains confirmed phases and never claims completion", async () => {
	const fx = preparedHead();
	fx.files.set("/repo/.husky/pre-commit", "custom hook\n");
	expect(await runCli(["setup", "--tracker", "init", "--json"], fx.deps)).toBe(EXIT.failure);
	expect(JSON.parse(fx.output.join(""))).toMatchObject({
		ok: false,
		reason: "setup_failed",
		completed: ["local_excludes", "tracker", "configuration", "local_binding", "merge_driver"],
	});
	expect(fx.files.get("/repo/.husky/pre-commit")).toBe("custom hook\n");
});

test.each([{ args: ["--unknown", "--json"] }, { args: ["setup", "--tracker", "wrong", "--json"] }])(
	"usage failure is one JSON document without stderr: $args",
	async ({ args }) => {
		const fx = fixture();
		expect(await runCli(args, fx.deps)).toBe(EXIT.usage);
		expect(fx.output).toHaveLength(SINGLE);
		expect(fx.errors).toEqual([]);
		expect(JSON.parse(fx.output.join(""))).toMatchObject({ ok: false, reason: "usage" });
	},
);

test("cancelled wizard does not start setup effects", async () => {
	const fx = fixture();
	fx.deps.context.tty = true;
	fx.deps.wizard = async () => {
		throw new BeeswaxError("cancelled", "Cancelled", { exitCode: EXIT.cancelled });
	};
	expect(await runCli(["setup"], fx.deps)).toBe(EXIT.cancelled);
	expect(fx.files.size).toBe(EXIT.success);
	expect(fx.trackers).toEqual([]);
});

test("bundled instructions and resources work without any repository operations", async () => {
	const fx = fixture();
	expect(await runCli(["skills", "get", "repository-setup", "--json"], fx.deps)).toBe(EXIT.success);
	const result = JSON.parse(fx.output.join(""));
	expect(result.content).toStartWith("Use `beeswax setup --help`");
	expect(result.content).not.toContain("---\nname:");
	expect(fx.commands).toEqual([]);
	fx.output.length = EMPTY;
	expect(
		await runCli(
			["skills", "file", "repository-setup", "references/publication.md", "--json"],
			fx.deps,
		),
	).toBe(EXIT.success);
	expect(JSON.parse(fx.output.join("")).content).toContain("beeswax beads sync");
});

test("hook migration prints user-guided outcomes without performing repository operations", async () => {
	const fx = fixture();
	expect(await runCli(["migrate", "hooks", "--json"], fx.deps)).toBe(EXIT.success);
	expect(JSON.parse(fx.output.join(""))).toMatchObject({
		ok: true,
		kind: "migration_instructions",
		requiresUser: true,
	});
	expect(JSON.parse(fx.output.join("")).content).toContain("Walk the user through");
	expect(fx.commands).toEqual([]);
	expect(fx.files.size).toBe(EMPTY);
});

test("initialization refuses an unprepared canonical HEAD before any setup effects", async () => {
	const fx = fixture();
	expect(await runCli(["setup", "--tracker", "init", "--json"], fx.deps)).toBe(EXIT.failure);
	expect(JSON.parse(fx.output.join(""))).toMatchObject({
		nextCommand: "beeswax migrate hooks",
		requiresUser: true,
		completed: [],
	});
	expect(fx.trackers).toEqual([]);
	expect(fx.files.size).toBe(EMPTY);
});

test("git packing selects --repo without tracker selection and emits one focused JSON receipt", async () => {
	const fx = fixture();
	const selected: string[] = [];
	fx.deps.command = async (_argv, cwd) => cwd;
	fx.deps.git.pack = async (repository) => {
		selected.push(repository);
		return {
			repository,
			commonDirectory: "/shared/.git",
			before: { looseObjects: 20, looseKiB: 80, packedObjects: 3, packs: 2, packedKiB: 16 },
			after: { looseObjects: 0, looseKiB: 0, packedObjects: 23, packs: 1, packedKiB: 12 },
		};
	};
	expect(await runCli(["git", "pack", "--repo", "/linked", "--json"], fx.deps)).toBe(EXIT.success);
	expect(selected).toEqual(["/linked"]);
	expect(fx.output).toHaveLength(SINGLE);
	expect(fx.errors).toEqual([]);
	expect(JSON.parse(fx.output.join(""))).toMatchObject({
		ok: true,
		kind: "git_packed",
		repository: "/linked",
		commonDirectory: "/shared/.git",
	});
	expect(fx.files.size).toBe(EMPTY);
});

test("git packing failure preserves its native diagnostics in one JSON document", async () => {
	const fx = fixture();
	fx.deps.git.pack = async () => {
		throw new BeeswaxError("command_failed", "Git repack failed", {
			context: { command: ["git", "repack"], stderr: "original Git diagnostics" },
		});
	};
	expect(await runCli(["git", "pack", "--json"], fx.deps)).toBe(EXIT.failure);
	expect(fx.output).toHaveLength(SINGLE);
	expect(fx.errors).toEqual([]);
	expect(JSON.parse(fx.output.join(""))).toMatchObject({
		ok: false,
		kind: "error",
		reason: "command_failed",
		stderr: "original Git diagnostics",
	});
});

function preparedHead() {
	const fx = fixture();
	fx.files.set("/repo/.worktrees/tracker--state/.husky/pre-commit", hookSection);
	fx.files.set("/repo/.worktrees/tracker--state/.husky/pre-merge-commit", hookSection);
	const { exec } = fx.deps;
	fx.deps.exec = async (argv, cwd) => {
		if (argv.includes("show")) {
			return { exitCode: EXIT.success, stdout: hookSection, stderr: "" };
		}
		return await exec(argv, cwd);
	};
	return fx;
}
