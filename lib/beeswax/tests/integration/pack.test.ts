import { expect, test } from "bun:test";
// eslint-disable-next-line import/no-nodejs-modules -- Native fixture paths.
import { join, relative, sep } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Real temporary Git repository fixture.
import { mkdtemp, readFile, readdir, realpath, rm, utimes } from "node:fs/promises";
import { runCommand } from "../../src/beads/environment.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Isolated temporary repository.
import { tmpdir } from "node:os";

const prefixStart = 0;
const hashDirectoryLength = 2;
const snapshotLines = 100;
const cli = new URL("../../bin/beeswax.ts", import.meta.url).pathname;
const oldObjectTime = new Date("2000-01-01T00:00:00Z");

test(
	"public Git packing preserves all objects, reflogs, refs and tracker files across " +
		"worktrees #test-235",
	// eslint-disable-next-line max-statements -- Verify native retention across one shared store.
	async () => {
		const temporary = await mkdtemp(join(tmpdir(), "beeswax pack "));
		const root = await realpath(temporary);
		const linked = join(root, "tracker");
		const environment = {
			...process.env,
			GIT_CONFIG_GLOBAL: "/dev/null",
			GIT_CONFIG_NOSYSTEM: "1",
			GIT_AUTHOR_NAME: "Test",
			GIT_AUTHOR_EMAIL: "test@example.test",
			GIT_COMMITTER_NAME: "Test",
			GIT_COMMITTER_EMAIL: "test@example.test",
			BEADS_DB: join(linked, ".beads/beads.db"),
		};
		const run = (argv: string[], cwd = root) => runCommand(argv, cwd, environment);
		const git = (...args: string[]) => run(["git", ...args]);
		try {
			await git("init", "--template=", "--initial-branch=main");
			await Bun.write(join(root, "document"), "retained snapshot\n".repeat(snapshotLines));
			await git("add", "document");
			await git("commit", "-m", "initial");
			await Bun.write(join(root, "packed-unreachable"), "packed recovery evidence");
			const packed = await git("hash-object", "-w", "packed-unreachable");
			await git("repack", "-a", "-d", "--keep-unreachable", "--no-cruft", "-n");
			expect(await Bun.file(objectPath(root, packed)).exists()).toBe(false);
			await Bun.write(join(root, "loose-unreachable"), "loose recovery evidence");
			const loose = await git("hash-object", "-w", "loose-unreachable");
			await utimes(objectPath(root, loose), oldObjectTime, oldObjectTime);
			await git("commit", "--allow-empty", "-m", "reflog-only recovery commit");
			const reflogOnly = await git("rev-parse", "HEAD");
			await git("reset", "--hard", "HEAD^");
			await git("worktree", "add", "-b", "tracker/state", linked);
			const config = join(root, ".git/config");
			await Bun.write(
				config,
				`${await Bun.file(config).text()}\n[gc]\npruneExpire = now\nreflogExpire = now\n` +
					"reflogExpireUnreachable = now\nrepackFilter = blob:none\nrepackFilterTo = missing-filter-store\n",
			);
			const sentinels = [
				".beads/beads.db",
				".beads/issues.jsonl",
				".beads/beads.base.jsonl",
				".beads/.br_history/old-snapshot.jsonl",
				".beads/.br_recovery/old-database.bak",
			].map((path) => join(linked, path));
			await Promise.all(
				sentinels.map((file) => Bun.write(file, `untouched tracker evidence: ${file}\n`)),
			);
			const contents = await Promise.all(sentinels.map((file) => readFile(file)));
			const metadata = await nonObjectMetadata(root);
			const objectsBefore = await allObjects(git);
			expect(objectsBefore).toContain(`${packed} blob`);
			expect(objectsBefore).toContain(`${loose} blob`);
			expect(objectsBefore).toContain(`${reflogOnly} commit`);
			const output = JSON.parse(
				await run([process.execPath, cli, "--repo", linked, "git", "pack", "--json"], linked),
			);
			expect(output).toMatchObject({
				ok: true,
				kind: "git_packed",
				repository: linked,
				commonDirectory: join(root, ".git"),
			});
			expect(output.after.looseObjects).toBeLessThan(output.before.looseObjects);
			expect(await allObjects(git)).toEqual(objectsBefore);
			expect(await nonObjectMetadata(root)).toEqual(metadata);
			expect(await Promise.all(sentinels.map((file) => readFile(file)))).toEqual(contents);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	},
);

// eslint-disable-next-line max-statements -- Verify independent local retention despite a borrowed duplicate.
test("packing retains a local object even when it is also available from an alternate #test-236", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "beeswax alternate "));
	const root = await realpath(temporary);
	const borrowed = join(root, "borrowed.git");
	const environment = {
		...process.env,
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_NOSYSTEM: "1",
	};
	const git = (...args: string[]) => runCommand(["git", ...args], root, environment);
	try {
		await git("init", "--template=", "--initial-branch=main");
		await git("init", "--template=", "--bare", borrowed);
		const contents = "independently retained local recovery evidence";
		await Bun.write(join(root, "evidence"), contents);
		const id = await git("hash-object", "-w", "evidence");
		await git("--git-dir", borrowed, "hash-object", "-w", join(root, "evidence"));
		await git("repack", "-a", "-d", "--keep-unreachable", "--no-cruft", "-n");
		const alternate = join(root, ".git/objects/info/alternates");
		await Bun.write(alternate, `${join(borrowed, "objects")}\n`);
		const output = await runCommand(
			[process.execPath, cli, "--repo", root, "git", "pack", "--json"],
			root,
			environment,
		);
		expect(JSON.parse(output)).toMatchObject({ ok: true, kind: "git_packed" });
		await rm(alternate);
		expect(await git("cat-file", "-p", id)).toBe(contents);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

// --- Private functions ---

function objectPath(root: string, id: string): string {
	return join(
		root,
		".git/objects",
		id.slice(prefixStart, hashDirectoryLength),
		id.slice(hashDirectoryLength),
	);
}

async function allObjects(git: (...args: string[]) => Promise<string>): Promise<string[]> {
	const output = await git(
		"cat-file",
		"--batch-all-objects",
		"--batch-check=%(objectname) %(objecttype)",
	);
	return output.split("\n").toSorted();
}

async function nonObjectMetadata(root: string): Promise<Record<string, Buffer>> {
	const directory = join(root, ".git");
	const entries = await readdir(directory, { recursive: true, withFileTypes: true });
	const files = entries
		.filter((entry) => entry.isFile())
		.map((entry) => relative(directory, join(entry.parentPath, entry.name)))
		.filter((path) => !path.startsWith(`objects${sep}`))
		.toSorted();
	return Object.fromEntries(
		await Promise.all(files.map(async (path) => [path, await readFile(join(directory, path))])),
	);
}
