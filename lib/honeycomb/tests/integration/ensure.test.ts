import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { dispatch, EXIT_CODES, HookError } from "../../src/index";
import {
	setTestEnv,
	restoreTestEnv,
	deps,
	testDeps,
	writeConfig,
	useOriginFixture,
	createPoolSlot,
	run,
} from "./support.ts";

const { initRepoWithOrigin } = useOriginFixture();

describe("honeycomb ensure", () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "honeycomb-ensure-test-"));
		setTestEnv("HOME", tmp);
		setTestEnv("GIT_CONFIG_NOSYSTEM", "1");
		setTestEnv("GIT_CONFIG_GLOBAL", join(tmp, "gitconfig"));
		setTestEnv("XDG_CONFIG_HOME", join(tmp, "config"));
	});

	afterEach(() => {
		restoreTestEnv();
		rmSync(tmp, { recursive: true, force: true });
	});

	test("materialises slots sequentially and streams hook output", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo hook-$WK_CREATED; touch sentinel", 2);
		const events: string[] = [];
		const liveDeps = testDeps({
			progress: {
				banner: (line: string) => {
					events.push(line);
				},
				stream: (_stream: "stdout" | "stderr", line: string) => {
					events.push(line);
				},
				error: () => undefined,
			},
		});

		await dispatch("ensure", ["--cwd", root], liveDeps);

		expect(events[0]).toBe("[wk-pool] initializing feat1…");
		expect(events.some((event) => event.includes("__feat1"))).toBe(true);
		expect(events.indexOf("[wk-pool] initializing feat1…")).toBeLessThan(
			events.indexOf("[wk-pool] initializing feat2…"),
		);
		expect(existsSync(join(`${root}__feat1`, "sentinel"))).toBe(true);
		expect(existsSync(join(`${root}__feat2`, "sentinel"))).toBe(true);
	});

	test("copies files before pooled ensure hooks run", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeFileSync(join(root, ".env"), "ensure-copy\n");
		writeConfig(tmp, root, 'cat .env > "$WK_CREATED/hook-read-env"', 2, 'copy = [".env"]\n');

		await dispatch("ensure", ["--cwd", root], testDeps());

		expect(readFileSync(join(`${root}__feat1`, "hook-read-env"), "utf8")).toBe("ensure-copy\n");
		expect(readFileSync(join(`${root}__feat2`, "hook-read-env"), "utf8")).toBe("ensure-copy\n");
		expect(
			(await run(["git", "-C", `${root}__feat1`, "status", "--porcelain", "--", ".env"])).stdout,
		).toBe("");
	});

	test("hook failure rolls back only in-flight slot and rerun recovers", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(
			tmp,
			root,
			'case "$WK_CREATED" in *__feat2) if [ ! -f "$WK_ROOT/recover" ]; then exit 7; fi;; esac; touch sentinel',
			3,
		);

		await expect(dispatch("ensure", ["--cwd", root], testDeps())).rejects.toThrow(HookError);
		expect(existsSync(`${root}__feat1`)).toBe(true);
		expect(existsSync(`${root}__feat2`)).toBe(false);
		expect(existsSync(`${root}__feat3`)).toBe(false);

		writeFileSync(join(root, "recover"), "ok\n");
		await dispatch("ensure", ["--cwd", root], testDeps());
		expect(existsSync(join(`${root}__feat3`, "sentinel"))).toBe(true);
	});

	test("half-init reruns hook and preserves existing slot on failure", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo rerun >> hook.log", 1);
		await createPoolSlot(root, 1, "wk-pool/feat1", false);

		await dispatch("ensure", ["--cwd", root], testDeps());

		expect(readFileSync(join(`${root}__feat1`, "hook.log"), "utf8")).toContain("rerun");
		const marker = (
			await run(["git", "-C", `${root}__feat1`, "rev-parse", "--git-path", "wk-pool-initialized"])
		).stdout.trim();
		expect(existsSync(resolve(`${root}__feat1`, marker))).toBe(true);

		writeConfig(tmp, root, "exit 9", 2);
		await createPoolSlot(root, 2, "wk-pool/feat2", false);
		await expect(dispatch("ensure", ["--cwd", root], testDeps())).rejects.toThrow(HookError);
		expect(existsSync(`${root}__feat2`)).toBe(true);
	});

	test("copy failure rolls back newly-created pooled slots", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "touch should-not-run", 1, 'copy = [".env.missing"]\n');

		await expect(dispatch("ensure", ["--cwd", root], testDeps())).rejects.toMatchObject({
			exitCode: EXIT_CODES.USAGE,
		});

		expect(existsSync(`${root}__feat1`)).toBe(false);
	});

	test("copy failure preserves existing half-initialized pooled slots", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "touch should-not-run", 2, 'copy = [".env.missing"]\n');
		await createPoolSlot(root, 1, "wk-pool/feat1", true);
		await createPoolSlot(root, 2, "wk-pool/feat2", false);

		await expect(dispatch("ensure", ["--cwd", root], testDeps())).rejects.toMatchObject({
			exitCode: EXIT_CODES.USAGE,
		});

		expect(existsSync(`${root}__feat2`)).toBe(true);
		expect(existsSync(join(`${root}__feat2`, "should-not-run"))).toBe(false);
		const marker = (
			await run(["git", "-C", `${root}__feat2`, "rev-parse", "--git-path", "wk-pool-initialized"])
		).stdout.trim();
		expect(existsSync(resolve(`${root}__feat2`, marker))).toBe(false);
	});

	test("list json keeps pool initialization stdout out of structured output", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo setup-output", 1);
		const diagnostics: string[] = [];

		const result = await dispatch(
			"list",
			["--cwd", root, "--json"],
			testDeps({ progress: { ...deps.progress, error: (msg: string) => diagnostics.push(msg) } }),
		);

		expect(() => JSON.parse(result.stdout ?? "")).not.toThrow();
		expect(diagnostics).toContain("setup-output");
	});

	test("list and pooled remove trigger first-run ensure", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeFileSync(join(root, ".env"), "ensured-copy\n");
		writeConfig(tmp, root, "echo setup-output; touch ensured", 1, 'copy = [".env"]\n');

		const listResult = await dispatch("list", ["--cwd", root], testDeps());
		expect(listResult.stdout).toContain("[pool:free]");
		expect(existsSync(join(`${root}__feat1`, "ensured"))).toBe(true);
		expect(readFileSync(join(`${root}__feat1`, ".env"), "utf8")).toBe("ensured-copy\n");

		rmSync(`${root}__feat1`, { recursive: true, force: true });
		await run(["git", "-C", root, "worktree", "prune"]);
		// The recreated slot is addressable by its placeholder branch: remove --self
		// resolves the worktree containing an existing --cwd path, and the slot
		// directory is gone until this remove call ensures the pool.
		const blocked = await dispatch(
			"remove",
			["--cwd", root, "--branch", "wk-pool/feat1", "--json"],
			testDeps(),
		);
		expect(blocked.exitCode).toBe(EXIT_CODES.UNSAFE);
		expect(JSON.parse(blocked.stdout ?? "{}")).toMatchObject({
			kind: "blocked",
			reason: "dirty_slot",
			worktree_path: `${root}__feat1`,
		});
		expect(readFileSync(join(`${root}__feat1`, ".env"), "utf8")).toBe("ensured-copy\n");
		expect(
			(await run(["git", "-C", `${root}__feat1`, "status", "--porcelain", "--", ".env"])).stdout,
		).toBe("");
	});

	test("pooled remove-triggered ensure copies into half-initialized slots", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeFileSync(join(root, ".env"), "half-remove-copy\n");
		writeConfig(tmp, root, "touch ensured", 1, 'copy = [".env"]\n');
		await createPoolSlot(root, 1, "wk-pool/feat1", false);

		const blocked = await dispatch(
			"remove",
			["--cwd", `${root}__feat1`, "--self", "--json"],
			testDeps(),
		);

		expect(blocked.exitCode).toBe(EXIT_CODES.UNSAFE);
		expect(readFileSync(join(`${root}__feat1`, ".env"), "utf8")).toBe("half-remove-copy\n");
	});
});
