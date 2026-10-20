/* eslint-disable unicorn/no-null -- Match explicit nulls in public command responses. */
/* eslint-disable require-await -- Test doubles return the production promise contract without real IO. */
import { BeeswaxError, EXIT } from "../../src/errors.ts";
import { expect, test } from "bun:test";
import { fixture } from "../support.ts";
import { hookSection } from "../../src/templates.ts";
import { runCli } from "../../src/cli.ts";

const SINGLE = 1;
const EMPTY = 0;

test("headless setup uses explicit flags, shared defaults and one silent JSON receipt #test-349", async () => {
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

test.each([
	{
		args: ["prepare", "--source", "/source"],
		kind: "checkout_prepared",
		call: ["/repo", "/source"],
	},
	{
		args: ["git", "merge", "base", "ours", "theirs"],
		kind: "merged",
		call: [{ ancestor: "base", current: "ours", other: "theirs" }],
	},
	{ args: ["git", "validate-staged"], kind: "snapshot_valid", call: ["/repo"] },
	{
		args: ["beads", "session-start", "--environment-file", "/session.env"],
		kind: "session_configured",
		call: [{ cwd: "/worker" }, "/session.env"],
	},
])(
	"system $args preserves its protocol and forwards inputs #test-525",
	// eslint-disable-next-line max-statements -- Verify each adapter through the CLI with captured inputs.
	async ({ args, kind, call }) => {
		const fx = fixture();
		const calls: (readonly unknown[])[] = [];
		fx.deps.beads.automatic = (root, source) => {
			calls.push([root, source]);
			return Promise.resolve("/tracker/beads.db");
		};
		fx.deps.git.merge = (paths) => {
			calls.push([paths]);
			return Promise.resolve({ kind: "merged", contents: "" });
		};
		fx.deps.git.validate = (root) => {
			calls.push([root]);
			return Promise.resolve();
		};
		fx.deps.stdin = () => Promise.resolve(JSON.stringify({ cwd: "/worker" }));
		fx.deps.beads.sessionStart = (input, file) => {
			calls.push([input, file]);
			return Promise.resolve();
		};
		expect(await runCli(["system", ...args, "--json"], fx.deps)).toBe(EXIT.success);
		expect(calls).toEqual([call]);
		expect(fx.output).toHaveLength(SINGLE);
		expect(JSON.parse(fx.output.join(""))).toMatchObject({ ok: true, kind });
		expect(fx.errors).toEqual([]);
	},
);

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

test("headless setup with no known tracker asks for a concrete flag before writes #test-515", async () => {
	const fx = fixture();
	expect(await runCli(["setup", "--yes", "--json"], fx.deps)).toBe(EXIT.usage);
	expect(fx.files.size).toBe(EXIT.success);
	expect(JSON.parse(fx.output.join(""))).toMatchObject({
		ok: false,
		reason: "needs_input",
		missingOptions: ["--tracker"],
	});
});

test(
	"workflow skill installation requires harnesses and preserves existing content " +
		"before setup writes #test-377",
	async () => {
		const fx = fixture();
		expect(
			await runCli(["setup", "--tracker", "none", "--install-workflow-skill", "--json"], fx.deps),
		).toBe(EXIT.usage);
		expect(fx.files.size).toBe(EMPTY);
		fx.output.length = EMPTY;
		fx.files.set("/repo/.agents/skills/hive/SKILL.md", "custom workflow");
		fx.deps.list = async () => ["hive"];
		const before = new Map(fx.files);
		expect(
			await runCli(
				["setup", "--tracker", "none", "--harness", "codex", "--install-workflow-skill", "--json"],
				fx.deps,
			),
		).toBe(EXIT.failure);
		expect(fx.files).toEqual(before);
		expect(JSON.parse(fx.output.join(""))).toMatchObject({
			ok: false,
			cause: "workflow_skill_exists",
			completed: [],
		});
	},
);

test.each([false, true])(
	"setup skill installation is explicit even with --yes and harnesses: %j #test-376",
	// eslint-disable-next-line max-statements -- Verify invocation, receipt and nonpersistent setup intent together.
	async (install) => {
		const fx = fixture();
		const installers: string[][] = [];
		const installFlags: string[] = [];
		if (install) {
			installFlags.push("--install-workflow-skill");
		}
		fx.deps.list = async (path) => {
			if (fx.files.has(`${path}/hive/SKILL.md`)) {
				return ["hive"];
			}
			return [];
		};
		fx.deps.exec = async (argv) => {
			if (argv.at(EMPTY) === "npx") {
				installers.push([...argv]);
				fx.files.set("/repo/.agents/skills/hive/SKILL.md", "installed workflow");
				return {
					exitCode: 0,
					stdout: JSON.stringify([
						{
							name: "hive",
							status: "installed",
							scope: "project",
							agents: ["Codex"],
							path: "/repo/.agents/skills/hive",
						},
					]),
					stderr: "progress",
				};
			}
			return { exitCode: 1, stdout: "", stderr: "" };
		};
		expect(
			await runCli(
				["setup", "--tracker", "none", "--harness", "codex", "--yes", "--json", ...installFlags],
				fx.deps,
			),
		).toBe(EXIT.success);
		expect(installers).toHaveLength(Number(install));
		expect(fx.output).toHaveLength(SINGLE);
		expect(fx.errors).toEqual([]);
		const receipt = JSON.parse(fx.output.join(""));
		expect(receipt.completed.includes("workflow_skill")).toBe(install);
		expect(fx.files.get("/repo/.hive/beeswax/config.toml")).not.toContain("install_workflow");
		expect(fx.files.get("/repo/.hive/beeswax/meta/lock.json")).not.toContain("workflowSkill");
	},
);

test("installer failure keeps setup phases and partial effects in one JSON receipt #test-399", async () => {
	const fx = fixture();
	const execute = fx.deps.exec;
	fx.deps.exec = async (argv, cwd) => {
		if (argv.at(EMPTY) === "npx") {
			return { exitCode: 1, stdout: "[]", stderr: "child failed" };
		}
		return execute(argv, cwd);
	};
	expect(
		await runCli(
			["setup", "--tracker", "none", "--harness", "codex", "--install-workflow-skill", "--json"],
			fx.deps,
		),
	).toBe(EXIT.failure);
	expect(fx.output).toHaveLength(SINGLE);
	expect(fx.errors).toEqual([]);
	expect(JSON.parse(fx.output.join(""))).toMatchObject({
		ok: false,
		cause: "workflow_skill_failed",
		completed: expect.arrayContaining(["project_lock"]),
		installer: { exitCode: 1, stderr: "child failed", effects: "unknown" },
	});
});

test("existing endpoint is adopted by default without creating tracker history #test-500", async () => {
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

test("setup failure retains confirmed phases and never claims completion #test-499", async () => {
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

test("setup preserves nested tracker effects in its public failure receipt", async () => {
	const fx = preparedHead();
	const database = "/repo/.worktrees/tracker--state/.beads/beads.db";
	fx.deps.operations.tracker = async () => {
		throw new BeeswaxError("tracker_setup_failed", "flush failed", {
			context: { database, trackerEffects: { completed: ["checkout", "database_initialized"] } },
		});
	};
	expect(await runCli(["setup", "--tracker", "init", "--json"], fx.deps)).toBe(EXIT.failure);
	expect(JSON.parse(fx.output.join(""))).toMatchObject({
		ok: false,
		database,
		completed: ["local_excludes"],
		trackerEffects: { completed: ["checkout", "database_initialized"] },
	});
	expect(fx.output).toHaveLength(SINGLE);
	expect(fx.errors).toEqual([]);
});

test("setup runs tracker preflight before writing local exclusions #test-468", async () => {
	const fx = fixture();
	fx.deps.operations.preflight = async () => {
		throw new BeeswaxError("tracker_exists", "existing store");
	};
	expect(await runCli(["setup", "--tracker", "init", "--json"], fx.deps)).toBe(EXIT.failure);
	expect(fx.files.size).toBe(EMPTY);
	expect(fx.trackers).toEqual([]);
	expect(JSON.parse(fx.output.join(""))).toMatchObject({ completed: [] });
});

test("setup reports reused Honeycomb policy separately from deliberate execution steps #test-351", async () => {
	const fx = fixture();
	const { exec } = fx.deps;
	fx.deps.exec = async (argv, cwd) => {
		if (argv.at(EMPTY) === "honeycomb") {
			return {
				exitCode: 0,
				stderr: "",
				stdout: JSON.stringify({
					ok: true,
					kind: "config_explain",
					root: "/canonical",
					worktree_location: "nested",
					command: { source: "global:project", value: "bootstrap" },
					matched_rules: [],
					project: { root: "/canonical" },
					local_config: null,
					add: { policy: "fresh_canonical" },
					finish: { push: false },
				}),
			};
		}
		return await exec(argv, cwd);
	};
	expect(await runCli(["setup", "--tracker", "none", "--json"], fx.deps)).toBe(EXIT.success);
	const result = JSON.parse(fx.output.join(""));
	expect(result.readiness).toMatchObject({
		execution: "not_verified",
		honeycomb: {
			status: "review_effective_policy",
			effective: { command: { source: "global:project" }, local_config: null },
		},
	});
	expect(result.readiness.next.map((entry: { area: string }) => entry.area)).toEqual([
		"repository_policy",
		"worktrees",
		"bee_bv",
		"colony_configuration",
		"workflow_dependencies",
		"activation",
		"first_execution",
	]);
	expect(fx.commands.some((argv) => argv.includes("wake"))).toBe(false);
});

test("info emits one document outside a repository without checkout discovery #test-387", async () => {
	const fx = fixture();
	fx.deps.installationInfo = async () => ({
		ok: true,
		kind: "installation_info",
		version: "0.5.0",
		revision: null,
	});
	expect(await runCli(["info", "--json"], fx.deps)).toBe(EXIT.success);
	expect(fx.output).toHaveLength(SINGLE);
	expect(fx.errors).toEqual([]);
	expect(fx.commands).toEqual([]);
});

test.each([{ args: ["--unknown", "--json"] }, { args: ["setup", "--tracker", "wrong", "--json"] }])(
	"usage failure is one JSON document without stderr: $args #test-350",
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

test.each([
	{
		name: "repository-setup",
		start: "Use `beeswax setup --help`",
		reference: "references/publication.md",
	},
	{
		name: "tracker-recovery",
		start: "Stop ordinary tracker operations",
		reference: "references/manual-recovery.md",
	},
])(
	"bundled $name and its reference need no repository operations #test-487",
	async ({ name, start, reference }) => {
		const fx = fixture();
		expect(await runCli(["skills", "get", name, "--json"], fx.deps)).toBe(EXIT.success);
		const result = JSON.parse(fx.output.join(""));
		expect(result.content).toStartWith(start);
		expect(result.content).not.toContain("---\nname:");
		fx.output.length = EMPTY;
		expect(await runCli(["skills", "file", name, reference, "--json"], fx.deps)).toBe(EXIT.success);
		expect(JSON.parse(fx.output.join("")).content).toContain("beeswax beads sync");
		expect([...fx.commands, ...fx.trackers]).toEqual([]);
		expect(fx.files.size).toBe(EMPTY);
	},
);

test("hook migration prints user-guided outcomes without performing repository operations #test-490", async () => {
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
