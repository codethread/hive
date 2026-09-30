import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseWorktreeList } from "../../src/git/worktrees.ts";
import { buildPoolState, dispatch, EXIT_CODES } from "../../src/index";
import {
	setTestEnv,
	restoreTestEnv,
	deps,
	writeConfig,
	useOriginFixture,
	createPoolSlot,
	run,
} from "./support.ts";

const { initRepoWithOrigin } = useOriginFixture();

describe("honeycomb pool status", () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "honeycomb-status-test-"));
		setTestEnv("HOME", tmp);
		setTestEnv("GIT_CONFIG_NOSYSTEM", "1");
		setTestEnv("GIT_CONFIG_GLOBAL", join(tmp, "gitconfig"));
		setTestEnv("XDG_CONFIG_HOME", join(tmp, "config"));
	});

	afterEach(() => {
		restoreTestEnv();
		rmSync(tmp, { recursive: true, force: true });
	});

	test("reports absent slots for an empty pool", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready", 2);
		const worktrees = parseWorktreeList(
			(await run(["git", "-C", root, "worktree", "list", "--porcelain"])).stdout,
		);

		const state = await buildPoolState(
			{ name: "repo", root, command: "echo ready", poolSize: 2, copyModeDefault: "copy", copy: [] },
			worktrees,
			deps,
		);

		expect(state).toMatchObject({ root, trunk: "main", hasPool: true, size: 2 });
		expect(
			state.slots.map((slot) => ({ exists: slot.exists, initialized: slot.initialized })),
		).toEqual([
			{ exists: false, initialized: false },
			{ exists: false, initialized: false },
		]);
	});

	test("status JSON reports free, taken, dirty, and half-initialized slots", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready", 4);
		await createPoolSlot(root, 1, "wk-pool/feat1", true);
		await createPoolSlot(root, 2, "feature/taken", true);
		await createPoolSlot(root, 3, "feature/dirty", true);
		writeFileSync(join(`${root}__feat3`, "dirty.txt"), "dirty\n");
		await createPoolSlot(root, 4, "wk-pool/feat4", false);

		const result = await dispatch("status", ["--cwd", root], deps);
		const state = JSON.parse(result.stdout ?? "{}");

		expect(state.root).toBe(root);
		expect(state.trunk).toBe("main");
		expect(state.hasPool).toBe(true);
		expect(state.slots[0]).toMatchObject({
			index: 1,
			exists: true,
			branch: "wk-pool/feat1",
			placeholder: true,
			dirty: false,
			initialized: true,
		});
		expect(state.slots[1]).toMatchObject({
			index: 2,
			exists: true,
			branch: "feature/taken",
			placeholder: false,
			dirty: false,
			initialized: true,
		});
		expect(state.slots[2]).toMatchObject({
			index: 3,
			exists: true,
			branch: "feature/dirty",
			dirty: true,
			initialized: true,
		});
		expect(state.slots[3]).toMatchObject({
			index: 4,
			exists: true,
			placeholder: true,
			initialized: false,
		});
		expect(state.slots[0].lastCommitIso).toContain("T");
		expect(state.slots[0].lastCommitSubject).toBe("initial");
	});

	test("blocks when sibling and legacy nested worktrees claim the same pool slot", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready", 1);
		await createPoolSlot(root, 1, "wk-pool/feat1", true);
		const nestedSlot = join(root, ".wktree", "feat1");
		await run(["git", "-C", root, "branch", "feature/colliding-slot"]);
		await run(["git", "-C", root, "worktree", "add", nestedSlot, "feature/colliding-slot"]);

		const result = await dispatch("status", ["--cwd", root], deps);

		expect(result.exitCode).toBe(EXIT_CODES.BLOCKED);
		expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
			kind: "blocked",
			reason: "blocked",
			message: expect.stringContaining("multiple worktrees claim pool slot feat1"),
		});
	});

	test("gitignored files do not mark a slot dirty and non-pooled status is empty", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready", 1);
		await createPoolSlot(root, 1, "wk-pool/feat1", true);
		writeFileSync(join(`${root}__feat1`, ".gitignore"), "node_modules/\n");
		await run(["git", "-C", `${root}__feat1`, "add", ".gitignore"]);
		await run(["git", "-C", `${root}__feat1`, "commit", "-m", "ignore node_modules"]);
		mkdirSync(join(`${root}__feat1`, "node_modules"));
		writeFileSync(join(`${root}__feat1`, "node_modules", "ignored.txt"), "ignored\n");

		const pooled = JSON.parse((await dispatch("status", ["--cwd", root], deps)).stdout ?? "{}");
		expect(pooled.slots[0].dirty).toBe(false);

		writeConfig(tmp, root, "echo ready");
		const nonPooled = JSON.parse((await dispatch("status", ["--cwd", root], deps)).stdout ?? "{}");
		expect(nonPooled).toEqual({
			ok: true,
			kind: "status",
			root,
			trunk: null,
			hasPool: false,
			size: 0,
			slots: [],
			diagnostics: [],
			setup_output: [],
		});
	});
});
