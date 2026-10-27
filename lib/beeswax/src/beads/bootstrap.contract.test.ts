import { bootstrapBeads, createTrackerCheckout, localBootstrapServices } from "./bootstrap.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Isolated native Git and Beads fixtures.
import { chmod, mkdir, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { defaultProjectConfig, writeProjectConfig } from "../config.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Fixture paths.
import { dirname, join } from "node:path";
import { expect, test } from "bun:test";
import type { Command } from "./environment.ts";
import { createNativeBeads } from "@hive/beads";
import { fixture as projectFixture } from "../../tests/support.ts";
// eslint-disable-next-line import/no-nodejs-modules -- System temporary directory.
import { tmpdir } from "node:os";
import { writeProjectLock } from "../project.ts";

const timeout = 15_000;
const success = 0;
const executableMode = 0o755;

type History = "present" | "missing-snapshot" | "missing-branch";

async function temporaryRoot(): Promise<string> {
	const temporary = await mkdtemp(join(tmpdir(), "hive-bootstrap-"));
	const path = await realpath(temporary);
	const honeycomb = join(path, "bin/honeycomb");
	const entry = new URL("../../../honeycomb/bin/honeycomb.ts", import.meta.url).pathname;
	await Bun.write(
		honeycomb,
		`#!/bin/sh\nexec ${Bun.$.escape(process.execPath)} ${Bun.$.escape(entry)} "$@"\n`,
	);
	await chmod(honeycomb, executableMode);
	return path;
}

function fixtureCommand(tmp: string, calls: string[][]): Command {
	// eslint-disable-next-line max-statements -- Validate scratch config before the isolated native command.
	return async (argv, cwd) => {
		calls.push([...argv]);
		const configArg = argv.find((arg) => arg.startsWith("XDG_CONFIG_HOME="));
		if (configArg !== undefined) {
			const configHome = configArg.slice("XDG_CONFIG_HOME=".length);
			expect(configHome.startsWith(join(tmp, "state/hive/beeswax/tracker-bootstrap-"))).toBe(true);
			expect(await Bun.file(join(configHome, "hive/honeycomb.toml")).text()).toBe(
				'worktree_location = "nested"\n',
			);
			expect(await Bun.file(join(configHome, "honeycomb.toml")).exists()).toBe(false);
		}
		const child = Bun.spawn([...argv], {
			cwd,
			env: {
				...process.env,
				BD_ACTOR: "pi",
				BEADS_DB: undefined,
				BEADS_DIR: undefined,
				BEADS_JSONL: undefined,
				BD_LOCK_TIMEOUT: undefined,
				BD_DB: undefined,
				BD_DATABASE: undefined,
				GIT_AUTHOR_EMAIL: "test@example.test",
				GIT_AUTHOR_NAME: "Test",
				GIT_COMMITTER_EMAIL: "test@example.test",
				GIT_COMMITTER_NAME: "Test",
				GIT_CONFIG_GLOBAL: "/dev/null",
				GIT_CONFIG_NOSYSTEM: "1",
				HOME: tmp,
				HUSKY: "0",
				PATH: `${join(tmp, "bin")}:${process.env.PATH}`,
				// The fixture's fresh mise data has no shims; select the Bun already running this test.
				MISE_BUN_VERSION: `path:${dirname(dirname(process.execPath))}`,
				MISE_CACHE_DIR: join(tmp, "mise-cache"),
				MISE_CONFIG_DIR: join(tmp, "mise-config"),
				MISE_DATA_DIR: join(tmp, "mise-data"),
				MISE_TRUSTED_CONFIG_PATHS: tmp,
				WK_ROOT: undefined,
				XDG_CONFIG_HOME: join(tmp, "config"),
				XDG_STATE_HOME: join(tmp, "state"),
			},
			stderr: "pipe",
			stdout: "pipe",
		});
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		if (exitCode !== success) {
			throw new Error(`${argv.join(" ")} failed (${exitCode})\n${stdout}\n${stderr}`);
		}
		return stdout.trim();
	};
}

// eslint-disable-next-line max-statements -- Create one real remote snapshot and a genuinely fresh clone.
async function fixture(tmp: string, history: History = "present") {
	const seed = join(tmp, "seed");
	const root = join(tmp, "clone");
	const remote = join(tmp, "origin.git");
	const calls: string[][] = [];
	const command = fixtureCommand(tmp, calls);
	await mkdir(seed);
	await command(["git", "init", "--template=", "--initial-branch=main"], seed);
	await Bun.write(join(seed, "package.json"), '{"name":"bootstrap-fixture","private":true}\n');
	await Bun.write(join(seed, "mise.toml"), "");
	await Bun.write(
		join(seed, ".gitignore"),
		".beads/\n.worktrees/\nnode_modules/\nmise.local.toml\n.codex/config.toml\n",
	);
	await command(["git", "add", "."], seed);
	await command(["git", "commit", "-m", "initial"], seed);
	await command(["git", "checkout", "-b", "tracker/state"], seed);
	const seedDatabase = join(seed, ".beads", "beads.db");
	const br = ["br", "--actor", "pi", "--db", seedDatabase];
	await command([...br, "init", "--prefix", "test"], seed);
	const beads = createNativeBeads({ execute: (argv, cwd) => command(argv, cwd) });
	const scope = { actor: "pi", cwd: seed, db: seedDatabase };
	const issue = await beads.create(scope, { title: "Shared history", owner: "ct" });
	await beads.sync.flush(scope);
	await command(
		["git", "add", "--force", ".beads/issues.jsonl", ".beads/config.yaml", ".beads/metadata.json"],
		seed,
	);
	await command(["git", "commit", "-m", "tracker snapshot"], seed);
	if (history === "missing-snapshot") {
		await command(["git", "rm", ".beads/issues.jsonl"], seed);
		await command(["git", "commit", "-m", "remove snapshot"], seed);
	}
	await command(["git", "checkout", "main"], seed);
	if (history === "missing-branch") {
		await command(["git", "branch", "-D", "tracker/state"], seed);
	}
	await command(["git", "clone", "--template=", "--bare", seed, remote], tmp);
	await command(["git", "clone", "--template=", remote, root], tmp);
	await command(["git", "config", "core.hooksPath", "/dev/null"], root);
	const tracker = join(root, ".worktrees", "tracker--state");
	return {
		calls,
		command,
		database: join(tracker, ".beads", "beads.db"),
		issue,
		remote,
		root,
		tracker,
	};
}

test(
	"fresh bootstrap imports shared history; reruns preserve local work without publishing #test-1",
	// eslint-disable-next-line max-statements -- Verify the native fresh-to-repeat lifecycle in one disposable clone.
	async () => {
		const tmp = await temporaryRoot();
		try {
			const { calls, command, database, issue, remote, root, tracker } = await fixture(tmp);
			const services = nativeServices(command, tmp);
			const accepted = await command(["git", "rev-parse", "tracker/state"], remote);
			expect(
				await bootstrapBeads(root, services, undefined, {
					beads: { lock_timeout: 300_000 },
					adopt: false,
				}),
			).toBe(database);
			expect(await readdir(join(tmp, "state/hive/beeswax"))).toEqual([]);
			expect(
				await services.beads.config.project({ cwd: root, db: database, actor: "pi" }),
			).toMatchObject({ lock_timeout: "300000" });
			const configured = calls.findIndex(
				(argv) => argv.includes("set") && argv.includes("lock_timeout"),
			);
			const importedAt = calls.findIndex((argv) => argv.includes("--import-only"));
			expect(configured).toBeGreaterThanOrEqual(success);
			expect(configured).toBeLessThan(importedAt);
			expect(await command(["git", "rev-parse", "--abbrev-ref", "@{upstream}"], tracker)).toBe(
				"origin/tracker/state",
			);
			const scope = { actor: "pi", cwd: root, db: database };
			const imported = await services.beads.show(scope, issue.id);
			expect(imported.title).toBe("Shared history");
			expect(await Bun.file(join(root, ".beads", "beads.db")).exists()).toBe(false);
			expect(await Bun.file(join(root, "mise.local.toml")).text()).toContain(database);
			expect(await Bun.file(join(tracker, ".codex", "config.toml")).text()).toContain(database);
			const local = await services.beads.create(scope, {
				title: "Unpublished local work",
				owner: "ct",
			});
			const snapshot = await Bun.file(join(tracker, ".beads", "issues.jsonl")).text();
			calls.length = 0;
			expect(
				await bootstrapBeads(root, services, undefined, {
					beads: { lock_timeout: 300_000 },
					adopt: false,
				}),
			).toBe(database);
			expect(
				calls.some(
					(argv) =>
						argv.includes("--import-only") ||
						argv.includes("--flush-only") ||
						argv.includes("fetch") ||
						(argv.includes("config") && argv.includes("set")),
				),
			).toBe(false);
			expect(await Bun.file(join(tracker, ".beads", "issues.jsonl")).text()).toBe(snapshot);
			const preserved = await services.beads.show(scope, local.id);
			expect(preserved.title).toBe("Unpublished local work");
			expect(await command(["git", "rev-parse", "tracker/state"], remote)).toBe(accepted);
		} finally {
			await rm(tmp, { force: true, recursive: true });
		}
	},
	timeout,
);

test.each(["missing-snapshot", "missing-branch"] as const)(
	"bootstrap refuses %s without initializing a private tracker #test-3",
	async (history) => {
		const tmp = await temporaryRoot();
		try {
			const { command, database, root } = await fixture(tmp, history);
			await expect(bootstrapBeads(root, nativeServices(command, tmp))).rejects.toBeInstanceOf(
				Error,
			);
			expect(await Bun.file(database).exists()).toBe(false);
			expect(await Bun.file(join(root, ".beads", "beads.db")).exists()).toBe(false);
		} finally {
			await rm(tmp, { force: true, recursive: true });
		}
	},
	timeout,
);

test(
	"bootstrap refuses a different selected endpoint before creating the tracker #test-5",
	async () => {
		const tmp = await temporaryRoot();
		try {
			const { command, database, root } = await fixture(tmp);
			const selection = `[env]\nBEADS_DB = ${JSON.stringify(join(tmp, "other", ".beads", "beads.db"))}\n`;
			await Bun.write(join(root, "mise.local.toml"), selection);
			await expect(bootstrapBeads(root, nativeServices(command, tmp))).rejects.toBeInstanceOf(
				Error,
			);
			expect(await Bun.file(database).exists()).toBe(false);
			expect(await Bun.file(join(root, "mise.local.toml")).text()).toBe(selection);
		} finally {
			await rm(tmp, { force: true, recursive: true });
		}
	},
	timeout,
);

test(
	"bootstrap does not let setup auto-import an unreconciled incoming snapshot #test-6",
	// eslint-disable-next-line max-statements -- Exercise a changed snapshot against the existing native database.
	async () => {
		const tmp = await temporaryRoot();
		try {
			const { command, database, issue, root, tracker } = await fixture(tmp);
			const services = nativeServices(command, tmp);
			await bootstrapBeads(root, services);
			const snapshot = join(tracker, ".beads", "issues.jsonl");
			const exported = await Bun.file(snapshot).text();
			const incoming = JSON.parse(exported.trim());
			incoming.title = "Incoming unreconciled title";
			incoming.updated_at = "2099-01-01T00:00:00Z";
			const contents = `${JSON.stringify(incoming)}\n`;
			await Bun.write(snapshot, contents);
			await expect(bootstrapBeads(root, services)).rejects.toBeInstanceOf(Error);
			const preserved = await services.beads.show(
				{ actor: "pi", cwd: root, db: database, noAutoImport: true, noAutoFlush: true },
				issue.id,
			);
			expect(preserved.title).toBe("Shared history");
			expect(await Bun.file(snapshot).text()).toBe(contents);
		} finally {
			await rm(tmp, { force: true, recursive: true });
		}
	},
	timeout,
);

test(
	"direct bootstrap CLI requires accepted policy before creating or importing the tracker #test-656",
	// eslint-disable-next-line max-statements -- Exercise drift refusal and accepted reproduction on one fresh clone.
	async () => {
		const tmp = await temporaryRoot();
		try {
			const { command, database, root } = await fixture(tmp);
			const project = projectFixture();
			await writeProjectConfig("/repo", defaultProjectConfig("none"), project.deps);
			await writeProjectLock("/repo", project.deps);
			await writeProjectConfig(
				"/repo",
				{ ...defaultProjectConfig("none"), beads: { lock_timeout: 300_000 } },
				project.deps,
			);
			for (const [path, contents] of project.files) {
				// eslint-disable-next-line no-await-in-loop -- Copy this project's portable contract into the disposable clone.
				await Bun.write(path.replace("/repo", root), contents);
			}
			const argv = [
				process.execPath,
				join(import.meta.dir, "../../bin/beeswax.ts"),
				"beads",
				"bootstrap",
				"--repo",
				root,
				"--environment",
				"none",
				"--no-codex",
				"--json",
			];
			await expect(command(argv, root)).rejects.toBeInstanceOf(Error);
			expect(await Bun.file(database).exists()).toBe(false);
			await writeProjectLock("/repo", project.deps);
			await Bun.write(
				join(root, ".hive/beeswax/meta/lock.json"),
				project.files.get("/repo/.hive/beeswax/meta/lock.json") ?? "",
			);
			expect(JSON.parse(await command(argv, root))).toMatchObject({
				ok: true,
				kind: "tracker_bootstrapped",
				result: { database },
			});
			expect(
				await nativeServices(command, tmp).beads.config.project({
					actor: "pi",
					cwd: root,
					db: database,
				}),
			).toMatchObject({ lock_timeout: "300000" });
			expect(await Bun.file(join(root, ".beads", "config.yaml")).exists()).toBe(false);
		} finally {
			await rm(tmp, { force: true, recursive: true });
		}
	},
	timeout,
);

function nativeServices(command: Command, tmp: string) {
	return {
		...localBootstrapServices,
		actor: "pi",
		createTracker: (root: string, base?: string) =>
			createTrackerCheckout(root, { command, stateHome: join(tmp, "state") }, base),
		beads: createNativeBeads({ execute: (argv, cwd) => command(argv, cwd) }),
		command,
	};
}
