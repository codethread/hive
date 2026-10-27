/* eslint-disable max-statements -- Real Git/native fixtures exercise complete cross-clone publication. */
// eslint-disable-next-line import/no-nodejs-modules -- Disposable native/Git fixture files.
import { cp, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { expect, test } from "bun:test";
import { createNativeBeads } from "@hive/beads";
// eslint-disable-next-line import/no-nodejs-modules -- Disposable native/Git fixture paths.
import { join } from "node:path";
import { runCommand } from "./environment.ts";
import { syncBeads } from "./publish.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Disposable native/Git fixture root.
import { tmpdir } from "node:os";

const TIMEOUT = 30_000;
const COMMAND = 1;
const actor = "olive-maximum-amphibian";
const noNotifications = { notify: () => Promise.resolve(), report: () => {} };

test(
	"publication preserves independent work and comments while native writers and remote publishers advance #test-648",
	async () => {
		const fixture = await prepare();
		const { first, second, native, scope, parent } = fixture;
		try {
			const local = await native.create(scope(first), { title: "Local work", parent });
			const remote = await native.create(scope(second), { title: "Remote work", parent });
			await native.comments.add(scope(first), parent, "local comment");
			await native.comments.add(scope(second), parent, "remote comment");
			await Bun.write(join(first, ".bv/recipes.yaml"), "local recipe\n");
			await Bun.write(join(second, ".bv/recipes.yaml"), "remote recipe\n");
			await runCommand(["git", "add", ".bv/recipes.yaml"], second);
			await expect(fixture.sync(second)).rejects.toThrow("staged configuration changes");
			expect(await runCommand(["git", "show", ":.bv/recipes.yaml"], second)).toBe("remote recipe");
			await runCommand(["git", "restore", "--staged", ".bv/recipes.yaml"], second);
			await fixture.sync(second);
			let duringReceive = false;
			let concurrentPush = false;
			let afterCapture = false;
			await fixture.sync(first, async (argv) => {
				if (argv[COMMAND] === "show" && !duringReceive) {
					duringReceive = true;
					await native.comments.add(scope(first), parent, "writer during receive");
				}
				if (argv[COMMAND] === "push" && !concurrentPush) {
					concurrentPush = true;
					await native.comments.add(scope(second), parent, "concurrent remote publication");
					await fixture.sync(second);
				}
				if (argv[COMMAND] === "update-index" && concurrentPush && !afterCapture) {
					afterCapture = true;
					await native.comments.add(scope(first), local.id, "late write after capture");
				}
			});
			await fixture.sync(second);
			expect(await native.comments.list(scope(second), local.id)).toEqual([]);
			/* eslint-disable no-await-in-loop -- Verify each native endpoint without competing reads. */
			for (const cwd of [first, second]) {
				const comments = await native.comments.list(scope(cwd), parent);
				expect(comments.map(({ text }) => text).toSorted()).toEqual([
					"concurrent remote publication",
					"local comment",
					"remote comment",
					"writer during receive",
				]);
				for (const id of [local.id, remote.id]) {
					const bead = await native.show(scope(cwd), id);
					expect(bead.dependencies).toEqual(
						expect.arrayContaining([
							expect.objectContaining({ id: parent, dependency_type: "parent-child" }),
						]),
					);
				}
				expect(await native.sync.status(scope(cwd))).toMatchObject({
					jsonl_newer: false,
					dirty_count: 0,
				});
			}
			/* eslint-enable no-await-in-loop */
			expect(await Bun.file(join(first, ".bv/recipes.yaml")).text()).toBe("local recipe\n");
			expect(await Bun.file(join(second, ".bv/recipes.yaml")).text()).toBe("remote recipe\n");
			expect(await runCommand(["git", "show", "HEAD:.bv/recipes.yaml"], first)).toBe(
				"accepted recipe",
			);
			await native.comments.add(scope(first), local.id, "ordinary write after sync");
			await fixture.sync(first);
			await fixture.sync(second);
			const finalComments = await native.comments.list(scope(second), local.id);
			expect(finalComments.map(({ text }) => text).toSorted()).toEqual([
				"late write after capture",
				"ordinary write after sync",
			]);
			expect(duringReceive && concurrentPush && afterCapture).toBe(true);
		} finally {
			await fixture.remove();
		}
	},
	TIMEOUT,
);

test(
	"publication retains a real same-field dispute without replacing the live export or advancing Git #test-649",
	async () => {
		const fixture = await prepare();
		const { first, second, native, scope, parent } = fixture;
		try {
			await native.update(scope(first), [parent], { title: "local decision" });
			await native.update(scope(second), [parent], { title: "remote decision" });
			await fixture.sync(second);
			const before = await Bun.file(join(first, ".beads/issues.jsonl")).text();
			const head = await runCommand(["git", "rev-parse", "HEAD"], first);
			await expect(fixture.sync(first)).rejects.toMatchObject({
				nativeError: {
					code: "CONFIG_ERROR",
					message: expect.stringContaining("Merge conflicts detected:"),
				},
			});
			expect(await Bun.file(join(first, ".beads/issues.jsonl")).text()).toBe(before);
			expect(await runCommand(["git", "rev-parse", "HEAD"], first)).toBe(head);
			const retained = await native.show(scope(first), parent);
			expect(retained.title).toBe("local decision");
			expect(await Bun.file(join(first, ".beads/hive-sync-incoming.jsonl")).text()).toContain(
				"remote decision",
			);
		} finally {
			await fixture.remove();
		}
	},
	TIMEOUT,
);

test.each(["hash-object", "read-tree", "push"])(
	"publication resumes after interruption before %s without losing either host's later work #test-650",
	async (boundary) => {
		const fixture = await prepare();
		const { first, second, native, scope, parent } = fixture;
		try {
			await native.comments.add(scope(second), parent, "remote before interruption");
			await fixture.sync(second);
			await native.comments.add(scope(first), parent, "local before interruption");
			let refAdvanced = false;
			await expect(
				fixture.sync(first, (argv) => {
					if (argv[COMMAND] === "update-ref") {
						refAdvanced = true;
					}
					if (argv[COMMAND] === boundary && (boundary !== "read-tree" || refAdvanced)) {
						throw new Error("Injected publication interruption");
					}
				}),
			).rejects.toThrow("Injected publication interruption");
			await native.comments.add(scope(first), parent, "local after interruption");
			await native.comments.add(scope(second), parent, "remote after interruption");
			await fixture.sync(second);
			await fixture.sync(first);
			await fixture.sync(second);
			const comments = await native.comments.list(scope(second), parent);
			expect(comments.map(({ text }) => text).toSorted()).toEqual([
				"local after interruption",
				"local before interruption",
				"remote after interruption",
				"remote before interruption",
			]);
		} finally {
			await fixture.remove();
		}
	},
	TIMEOUT,
);

async function prepare() {
	const temporary = await mkdtemp(join(tmpdir(), "hive-publication-"));
	const root = await realpath(temporary);
	const first = join(root, "first");
	const second = join(root, "second");
	const remote = join(root, "remote.git");
	const scope = (cwd: string) => ({ cwd, db: join(cwd, ".beads/beads.db"), actor });
	const execute = (argv: string[], cwd: string) =>
		runCommand(argv, cwd, {
			...process.env,
			BEADS_DB: scope(cwd).db,
			BD_ACTOR: actor,
		});
	const native = createNativeBeads({ execute });
	await mkdir(first);
	await runCommand(["git", "init", "--template=", "--bare", remote], root);
	await runCommand(["git", "init", "--template=", "-b", "tracker/state"], first);
	await configureGit(first);
	await execute(
		["br", "init", "--prefix", "probe", "--db", scope(first).db, "--actor", actor],
		first,
	);
	const { id: parent } = await native.create(scope(first), { title: "Shared parent", owner: "ct" });
	await Bun.write(join(first, ".gitignore"), ".beads/*\n!.beads/issues.jsonl\n");
	await Bun.write(join(first, ".bv/recipes.yaml"), "accepted recipe\n");
	await runCommand(["git", "add", "."], first);
	await runCommand(["git", "commit", "-m", "initial tracker"], first);
	await runCommand(["git", "remote", "add", "origin", remote], first);
	await runCommand(["git", "push", "-u", "origin", "tracker/state"], first);
	await runCommand(
		["git", "clone", "--template=", "--branch", "tracker/state", remote, second],
		root,
	);
	await configureGit(second);
	// Seed equal native baselines only in this disposable fixture; publication never copies DBs.
	await cp(join(first, ".beads"), join(second, ".beads"), { recursive: true });
	const sync = (cwd: string, beforeCommand?: (argv: readonly string[]) => Promise<void> | void) =>
		syncBeads(
			{ BEADS_DB: scope(cwd).db },
			{
				beads: native,
				write: async (path, contents) => {
					await Bun.write(path, contents);
				},
				command: async (argv, directory, index) => {
					await beforeCommand?.(argv);
					const environment = { ...process.env };
					if (index !== undefined) {
						environment.GIT_INDEX_FILE = index;
					}
					return runCommand(argv, directory, environment);
				},
			},
			noNotifications,
		);
	return {
		first,
		second,
		native,
		scope,
		parent,
		sync,
		remove: () => rm(root, { recursive: true, force: true }),
	};
}

async function configureGit(cwd: string): Promise<void> {
	const path = join(cwd, ".git/config");
	await Bun.write(
		path,
		`${await Bun.file(path).text()}\n[user]\n\tname = Tracker fixture\n` +
			"\temail = tracker@example.test\n[commit]\n\tgpgsign = false\n",
	);
}
