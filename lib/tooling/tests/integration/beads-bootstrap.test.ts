import { bootstrapBeads, localBootstrapServices } from "../../src/beads-bootstrap.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Fixture paths.
import { dirname, join } from "node:path";
import { expect, test } from "bun:test";
// eslint-disable-next-line import/no-nodejs-modules -- Isolated native Git and Beads fixtures.
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import type { Command } from "../../src/beads-environment.ts";
// eslint-disable-next-line import/no-nodejs-modules -- System temporary directory.
import { tmpdir } from "node:os";

const timeout = 15_000;
const success = 0;
const trackedEnvironment = `[env]\nBEADS_DB = "{{ exec(command='git rev-parse --path-format=absolute --git-common-dir') | dirname }}/.worktrees/tracker--state/.beads/beads.db"\n`;
const defaultMiseConfig = await Bun.file(new URL("../../../../mise.toml", import.meta.url)).text();

type History = "present" | "missing-snapshot" | "missing-branch";

async function temporaryRoot(): Promise<string> {
	const path = await mkdtemp(join(tmpdir(), "hive-bootstrap-"));
	return await realpath(path);
}

function fixtureCommand(tmp: string, calls: string[][]): Command {
	return async (argv, cwd) => {
		calls.push([...argv]);
		const child = Bun.spawn([...argv], {
			cwd,
			env: {
				...process.env,
				BD_ACTOR: "pi",
				BEADS_DB: undefined,
				BEADS_DIR: undefined,
				BEADS_JSONL: undefined,
				GIT_AUTHOR_EMAIL: "test@example.test",
				GIT_AUTHOR_NAME: "Test",
				GIT_COMMITTER_EMAIL: "test@example.test",
				GIT_COMMITTER_NAME: "Test",
				GIT_CONFIG_GLOBAL: "/dev/null",
				GIT_CONFIG_NOSYSTEM: "1",
				HOME: tmp,
				HUSKY: "0",
				// The fixture's fresh mise data has no shims; select the Bun already running this test.
				MISE_BUN_VERSION: `path:${dirname(dirname(process.execPath))}`,
				MISE_CACHE_DIR: join(tmp, "mise-cache"),
				MISE_CONFIG_DIR: join(tmp, "mise-config"),
				MISE_DATA_DIR: join(tmp, "mise-data"),
				MISE_TRUSTED_CONFIG_PATHS: tmp,
				WK_ROOT: undefined,
				XDG_CONFIG_HOME: join(tmp, "config"),
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
	await command(["git", "init", "--initial-branch=main"], seed);
	await Bun.write(join(seed, "package.json"), '{"name":"bootstrap-fixture","private":true}\n');
	await Bun.write(join(seed, "mise.toml"), trackedEnvironment);
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
	const issue = JSON.parse(
		await command([...br, "create", "--title", "Shared history", "--owner", "ct", "--json"], seed),
	);
	await command([...br, "sync", "--flush-only"], seed);
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
	await command(["git", "clone", "--bare", seed, remote], tmp);
	await command(["git", "clone", remote, root], tmp);
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
	"fresh bootstrap imports shared history; reruns preserve local work without publishing",
	// eslint-disable-next-line max-statements -- Verify the native fresh-to-repeat lifecycle in one disposable clone.
	async () => {
		const tmp = await temporaryRoot();
		try {
			const { calls, command, database, issue, remote, root, tracker } = await fixture(tmp);
			const services = { ...localBootstrapServices, command };
			const accepted = await command(["git", "rev-parse", "tracker/state"], remote);
			expect(await bootstrapBeads(root, services)).toBe(database);
			expect(await command(["git", "rev-parse", "--abbrev-ref", "@{upstream}"], tracker)).toBe(
				"origin/tracker/state",
			);
			const br = ["br", "--actor", "pi", "--db", database];
			const [imported] = JSON.parse(await command([...br, "show", issue.id, "--json"], root));
			expect(imported.title).toBe("Shared history");
			expect(await Bun.file(join(root, ".beads", "beads.db")).exists()).toBe(false);
			expect(await Bun.file(join(root, "mise.local.toml")).text()).toContain(database);
			expect(await Bun.file(join(tracker, ".codex", "config.toml")).text()).toContain(database);
			const local = JSON.parse(
				await command(
					[...br, "create", "--title", "Unpublished local work", "--owner", "ct", "--json"],
					root,
				),
			);
			const snapshot = await Bun.file(join(tracker, ".beads", "issues.jsonl")).text();
			calls.length = 0;
			expect(await bootstrapBeads(root, services)).toBe(database);
			expect(
				calls.some(
					(argv) =>
						argv.includes("--import-only") ||
						argv.includes("--flush-only") ||
						argv.includes("fetch"),
				),
			).toBe(false);
			expect(await Bun.file(join(tracker, ".beads", "issues.jsonl")).text()).toBe(snapshot);
			const [preserved] = JSON.parse(await command([...br, "show", local.id, "--json"], root));
			expect(preserved.title).toBe("Unpublished local work");
			expect(await command(["git", "rev-parse", "tracker/state"], remote)).toBe(accepted);
		} finally {
			await rm(tmp, { force: true, recursive: true });
		}
	},
	timeout,
);

test(
	"mise default installs dependencies and binaries, builds and bootstraps on repeated runs",
	// eslint-disable-next-line max-statements -- Exercise the checked-in task twice against one real disposable clone.
	async () => {
		const tmp = await temporaryRoot();
		try {
			const { command, database, issue, remote, root, tracker } = await fixture(tmp);
			await Bun.write(join(root, "mise.toml"), defaultMiseConfig);
			const bootstrap = `bun ${JSON.stringify(join(import.meta.dir, "../../src/beads-bootstrap.ts"))}`;
			const prepare = `bun ${JSON.stringify(join(import.meta.dir, "../../src/beads-setup-auto.ts"))}`;
			await Bun.write(
				join(root, "package.json"),
				JSON.stringify({
					name: "bootstrap-fixture",
					private: true,
					scripts: { "beads:bootstrap": bootstrap, prepare },
					workspaces: ["lib/*"],
				}),
			);
			await Bun.write(
				join(root, "lib/fixture/package.json"),
				JSON.stringify({
					name: "fixture-workspace",
					scripts: {
						build: "echo built >> builds.log",
						"install:bin": "echo installed >> installs.log",
					},
				}),
			);
			const accepted = await command(["git", "rev-parse", "tracker/state"], remote);
			await command(["mise", "run"], root);
			const snapshot = await Bun.file(join(tracker, ".beads/issues.jsonl")).text();
			await command(["mise", "run"], root);
			expect(await Bun.file(join(root, "lib/fixture/builds.log")).text()).toBe("built\nbuilt\n");
			expect(await Bun.file(join(root, "lib/fixture/installs.log")).text()).toBe(
				"installed\ninstalled\n",
			);
			expect(await Bun.file(join(tracker, ".beads/issues.jsonl")).text()).toBe(snapshot);
			const [imported] = JSON.parse(
				await command(["br", "--db", database, "show", issue.id, "--json"], root),
			);
			expect(imported.title).toBe("Shared history");
			expect(await command(["git", "rev-parse", "tracker/state"], remote)).toBe(accepted);
		} finally {
			await rm(tmp, { force: true, recursive: true });
		}
	},
	timeout,
);

test.each(["missing-snapshot", "missing-branch"] as const)(
	"bootstrap refuses %s without initializing a private tracker",
	async (history) => {
		const tmp = await temporaryRoot();
		try {
			const { command, database, root } = await fixture(tmp, history);
			await expect(
				bootstrapBeads(root, { ...localBootstrapServices, command }),
			).rejects.toBeInstanceOf(Error);
			expect(await Bun.file(database).exists()).toBe(false);
			expect(await Bun.file(join(root, ".beads", "beads.db")).exists()).toBe(false);
		} finally {
			await rm(tmp, { force: true, recursive: true });
		}
	},
	timeout,
);

test(
	"prepare hints at explicit bootstrap without creating a database",
	async () => {
		const tmp = await temporaryRoot();
		try {
			const { command, database, root } = await fixture(tmp);
			const output = await command(
				["bun", join(import.meta.dir, "../../src/beads-setup-auto.ts")],
				root,
			);
			expect(output).toContain("mise run");
			expect(await Bun.file(database).exists()).toBe(false);
			await Bun.write(
				join(root, "mise.local.toml"),
				`[env]\nBEADS_DB = ${JSON.stringify(database)}\n`,
			);
			expect(
				await command(["bun", join(import.meta.dir, "../../src/beads-setup-auto.ts")], root),
			).toContain("mise run");
		} finally {
			await rm(tmp, { force: true, recursive: true });
		}
	},
	timeout,
);

test(
	"bootstrap refuses a different selected endpoint before creating the tracker",
	async () => {
		const tmp = await temporaryRoot();
		try {
			const { command, database, root } = await fixture(tmp);
			const selection = `[env]\nBEADS_DB = ${JSON.stringify(join(tmp, "other", ".beads", "beads.db"))}\n`;
			await Bun.write(join(root, "mise.local.toml"), selection);
			await expect(
				bootstrapBeads(root, { ...localBootstrapServices, command }),
			).rejects.toBeInstanceOf(Error);
			expect(await Bun.file(database).exists()).toBe(false);
			expect(await Bun.file(join(root, "mise.local.toml")).text()).toBe(selection);
		} finally {
			await rm(tmp, { force: true, recursive: true });
		}
	},
	timeout,
);

test(
	"bootstrap does not let setup auto-import an unreconciled incoming snapshot",
	// eslint-disable-next-line max-statements -- Exercise a changed snapshot against the existing native database.
	async () => {
		const tmp = await temporaryRoot();
		try {
			const { command, database, issue, root, tracker } = await fixture(tmp);
			const services = { ...localBootstrapServices, command };
			await bootstrapBeads(root, services);
			const snapshot = join(tracker, ".beads", "issues.jsonl");
			const exported = await Bun.file(snapshot).text();
			const incoming = JSON.parse(exported.trim());
			incoming.title = "Incoming unreconciled title";
			incoming.updated_at = "2099-01-01T00:00:00Z";
			const contents = `${JSON.stringify(incoming)}\n`;
			await Bun.write(snapshot, contents);
			await expect(bootstrapBeads(root, services)).rejects.toBeInstanceOf(Error);
			const [preserved] = JSON.parse(
				await command(
					[
						"br",
						"--db",
						database,
						"--no-auto-import",
						"--no-auto-flush",
						"show",
						issue.id,
						"--json",
					],
					root,
				),
			);
			expect(preserved.title).toBe("Shared history");
			expect(await Bun.file(snapshot).text()).toBe(contents);
		} finally {
			await rm(tmp, { force: true, recursive: true });
		}
	},
	timeout,
);
