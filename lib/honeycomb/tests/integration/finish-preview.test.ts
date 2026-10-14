import { EXIT_CODES, dispatch } from "../../src/index";
// oxlint-disable-next-line import/no-nodejs-modules -- Integration fixtures exercise real filesystem IO.
import { chmod, readFile, writeFile } from "node:fs/promises";
import {
	commitFile,
	commitOnRemoteDefault,
	deps,
	pathExists,
	useOriginFixture,
	writeConfig,
} from "./support.ts";
import { expect, test } from "bun:test";
import { finishArgs, finishPolicy, readCheckoutState, readFinishState } from "./finish-helpers.ts";
import { gitOut, gitSucceeds, useTmpHome } from "./lifecycle-helpers.ts";
// oxlint-disable-next-line import/no-nodejs-modules -- Integration fixtures exercise real filesystem IO.
import { join } from "node:path";

const tmp = useTmpHome("honeycomb-finish-preview-test-");
const { initRepoWithOrigin } = useOriginFixture();
const EXECUTABLE_MODE = 0o755;

test.each([
	{ key: "branch.main.mergeOptions", value: "-s resolve", strategy: "squash" },
	{ key: "pull.twohead", value: "resolve", strategy: "merge_commit" },
])("$strategy refuses unpreviewable $key before mutation", async ({ key, value, strategy }) => {
	const fixture = await prepareRenameConflict(key, value, strategy);
	const before = await readFinishState(fixture);
	const result = await dispatch("finish", finishArgs(fixture.worktreePath, strategy), deps);
	expect(result.exitCode).toBe(EXIT_CODES.BLOCKED);
	expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
		reason: "blocked",
		integrated: false,
		cleanup_actions: [],
		message: expect.stringContaining(key.toLowerCase()),
	});
	expect(await readFinishState(fixture)).toEqual(before);
});

test("external merge drivers are refused before their preview side effects", async () => {
	const fixture = await prepareDriverConflict();
	const before = await readFinishState(fixture);
	const sourceBefore = await readCheckoutState(fixture.worktreePath);
	const result = await dispatch("finish", finishArgs(fixture.worktreePath, "squash"), deps);
	expect(result.exitCode).toBe(EXIT_CODES.BLOCKED);
	expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
		reason: "blocked",
		integrated: false,
		cleanup_actions: [],
		message: expect.stringContaining("merge.stateful.driver"),
	});
	expect(await pathExists(fixture.marker)).toBe(false);
	expect(await readFinishState(fixture)).toEqual(before);
	expect(await readCheckoutState(fixture.worktreePath)).toEqual(sourceBefore);
});

test("fresh_canonical previews attributes from the fetched target before advancing", async () => {
	const fixture = await prepareAttributeConflict();
	const before = await readFinishState(fixture);
	const sourceBefore = await readCheckoutState(fixture.worktreePath);
	const result = await dispatch("finish", finishArgs(fixture.worktreePath, "squash"), deps);
	expect(result.exitCode).toBe(EXIT_CODES.BLOCKED);
	expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
		kind: "blocked",
		reason: "conflict",
		integrated: false,
		cleanup_actions: [],
	});
	expect(await readFinishState(fixture)).toEqual(before);
	expect(await readCheckoutState(fixture.worktreePath)).toEqual(sourceBefore);
	expect(await readFile(join(fixture.root, "README.md"), "utf8")).toBe("hello\n");
	expect(await readFile(join(fixture.root, ".gitattributes"), "utf8")).toBe(
		"README.md merge=union\n",
	);
});

// --- Private functions ---

async function prepareSource(strategy: string, fresh = false) {
	const { remote, root } = await initRepoWithOrigin(tmp.dir);
	const worktreePath = await addSource(root, strategy, fresh);
	return { branch: "feature/preview", remote, root, worktreePath };
}

async function addSource(root: string, strategy: string, fresh = false): Promise<string> {
	writeConfig({
		command: "echo ready",
		root,
		tmp: tmp.dir,
		copyToml: finishPolicy(strategy, fresh, true),
	});
	const added = await dispatch(
		"add",
		["--cwd", root, "--branch", "feature/preview", "--json"],
		deps,
	);
	expect(added.exitCode).toBe(EXIT_CODES.SUCCESS);
	return `${root}__feature--preview`;
}

async function prepareRenameConflict(key: string, value: string, strategy: string) {
	const fixture = await prepareSource(strategy);
	await gitOut(fixture.worktreePath, "mv", "README.md", "renamed.md");
	await gitOut(fixture.worktreePath, "commit", "-m", "rename source file");
	await commitFile({
		content: "target edit\n",
		message: "edit target file",
		path: "README.md",
		repo: fixture.root,
	});
	await gitOut(fixture.root, "config", key, value);
	expect(
		await gitSucceeds(fixture.root, "merge-tree", "--write-tree", "main", fixture.branch),
	).toBe(true);
	return fixture;
}

async function prepareDriverConflict() {
	const fixture = await prepareSource("squash");
	await commitFile({
		content: "source\n",
		message: "source edit",
		path: "README.md",
		repo: fixture.worktreePath,
	});
	await commitFile({
		content: "target\n",
		message: "target edit",
		path: "README.md",
		repo: fixture.root,
	});
	const marker = await installStatefulDriver(fixture.root);
	return { ...fixture, marker };
}

async function installStatefulDriver(root: string): Promise<string> {
	const marker = join(tmp.dir, "driver-ran");
	const driver = join(tmp.dir, "merge-driver");
	await writeFile(
		driver,
		`#!/bin/sh\nif test -e "${marker}"; then exit 1; fi\ntouch "${marker}"\nprintf 'resolved\\n' > "$1"\n`,
	);
	await chmod(driver, EXECUTABLE_MODE);
	await writeFile(join(root, ".git", "info", "attributes"), "README.md merge=stateful\n");
	await gitOut(root, "config", "merge.stateful.driver", `${driver} %A`);
	return marker;
}

async function prepareAttributeConflict() {
	const { remote, root } = await initRepoWithOrigin(tmp.dir);
	await commitFile({
		content: "README.md merge=union\n",
		message: "allow union merge",
		path: ".gitattributes",
		repo: root,
	});
	await gitOut(root, "push", "origin", "main");
	const worktreePath = await addSource(root, "squash", true);
	await commitFile({
		content: "source\n",
		message: "source edit",
		path: "README.md",
		repo: worktreePath,
	});
	await commitOnRemoteDefault({
		content: "README.md -merge\n",
		message: "binary merge",
		path: ".gitattributes",
		remote,
	});
	await commitOnRemoteDefault({
		content: "remote\n",
		message: "remote edit",
		path: "README.md",
		remote,
	});
	await gitOut(root, "fetch", "origin");
	// The old checkout's union attribute would wrongly approve this preview.
	expect(
		await gitSucceeds(root, "merge-tree", "--write-tree", "origin/main", "feature/preview"),
	).toBe(true);
	return { branch: "feature/preview", remote, root, worktreePath };
}
