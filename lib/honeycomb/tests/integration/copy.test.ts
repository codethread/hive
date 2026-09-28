import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { dispatch, EXIT_CODES } from "../../src/index";
import {
	setTestEnv,
	restoreTestEnv,
	deps,
	writeConfig,
	initRepoWithOrigin,
	run,
} from "./support.ts";

describe("honeycomb copy", () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "honeycomb-copy-test-"));
		setTestEnv("HOME", tmp);
		setTestEnv("GIT_CONFIG_NOSYSTEM", "1");
		setTestEnv("GIT_CONFIG_GLOBAL", join(tmp, "gitconfig"));
		setTestEnv("XDG_CONFIG_HOME", join(tmp, "config"));
	});

	afterEach(() => {
		restoreTestEnv();
		rmSync(tmp, { recursive: true, force: true });
	});

	test("reports ready JSON for a non-canonical worktree with no copy config", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready");
		await dispatch("add", ["--cwd", root, "--branch", "feature/copy", "--json"], deps);
		const worktreePath = `${root}__feature--copy`;

		const nestedCwd = join(worktreePath, "nested", "dir");
		mkdirSync(nestedCwd, { recursive: true });

		const result = await dispatch("copy", ["--cwd", nestedCwd, "--json"], deps);

		expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
		expect(JSON.parse(result.stdout ?? "{}")).toEqual({
			kind: "ready",
			root,
			worktree_path: worktreePath,
			copied: [],
			exclude_paths: [],
		});
	});

	test("local-only copy skips failing pre_remote_check", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeFileSync(join(root, ".env"), "SECRET=copy\n");
		writeConfig(
			tmp,
			root,
			"echo ready",
			undefined,
			'pre_remote_check = "echo blocked >&2; exit 7"\ncopy = [".env"]\n',
		);
		await run(["git", "-C", root, "branch", "feature/local-copy"]);
		const worktreePath = `${root}__feature--local-copy`;
		await run(["git", "-C", root, "worktree", "add", worktreePath, "feature/local-copy"]);

		const result = await dispatch("copy", ["--cwd", worktreePath, "--json"], deps);

		expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
		expect(readFileSync(join(worktreePath, ".env"), "utf8")).toBe("SECRET=copy\n");
	});

	test("refuses canonical root with JSON blocked payload", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready");

		const result = await dispatch("copy", ["--cwd", root, "--json"], deps);

		expect(result.exitCode).toBe(EXIT_CODES.UNSAFE);
		expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
			kind: "blocked",
			reason: "canonical_root",
		});
	});

	test("copies a root-relative file and reports copied JSON", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeFileSync(join(root, ".env"), "SECRET=one\n");
		writeConfig(tmp, root, "echo ready", undefined, 'copy = [".env"]\n');
		await dispatch("add", ["--cwd", root, "--branch", "feature/copy", "--json"], deps);
		const worktreePath = `${root}__feature--copy`;

		const result = await dispatch("copy", ["--cwd", worktreePath, "--json"], deps);

		expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
		expect(readFileSync(join(worktreePath, ".env"), "utf8")).toBe("SECRET=one\n");
		expect(JSON.parse(result.stdout ?? "{}")).toEqual({
			kind: "ready",
			root,
			worktree_path: worktreePath,
			copied: [{ from: join(root, ".env"), to: ".env", type: "file" }],
			exclude_paths: [".env"],
		});
	});

	test("rerunning copy replaces an untracked destination with current source", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeFileSync(join(root, ".env"), "first\n");
		writeConfig(tmp, root, "echo ready", undefined, 'copy = [".env"]\n');
		await dispatch("add", ["--cwd", root, "--branch", "feature/replace", "--json"], deps);
		const worktreePath = `${root}__feature--replace`;
		await dispatch("copy", ["--cwd", worktreePath], deps);
		writeFileSync(join(root, ".env"), "second\n");
		writeFileSync(join(worktreePath, ".env"), "local edit\n");

		await dispatch("copy", ["--cwd", worktreePath], deps);

		expect(readFileSync(join(worktreePath, ".env"), "utf8")).toBe("second\n");
	});

	test("tracked destination blocks with unsafe JSON and leaves file intact", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeFileSync(join(root, "tracked-copy.txt"), "source\n");
		await run(["git", "-C", root, "add", "tracked-copy.txt"]);
		await run(["git", "-C", root, "commit", "-m", "add tracked copy"]);
		await run(["git", "-C", root, "push", "origin", "main"]);
		writeFileSync(join(root, "tracked-copy.txt"), "new source\n");
		writeConfig(tmp, root, "echo ready");
		await dispatch("add", ["--cwd", root, "--branch", "feature/tracked-copy", "--json"], deps);
		writeConfig(tmp, root, "echo ready", undefined, 'copy = ["tracked-copy.txt"]\n');
		const worktreePath = `${root}__feature--tracked-copy`;

		const result = await dispatch("copy", ["--cwd", worktreePath, "--json"], deps);

		expect(result.exitCode).toBe(EXIT_CODES.UNSAFE);
		expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({ kind: "blocked", reason: "unsafe" });
		expect(readFileSync(join(worktreePath, "tracked-copy.txt"), "utf8")).toBe("source\n");
	});

	test.each(["", "/tmp/abs", "~/secret", "../escape"])(
		"invalid copy string %p fails as config error without stdout",
		async (path) => {
			const { root } = await initRepoWithOrigin(tmp);
			writeConfig(tmp, root, "echo ready");
			await dispatch(
				"add",
				["--cwd", root, "--branch", `feature/invalid-${path.length}`, "--json"],
				deps,
			);
			writeConfig(tmp, root, "echo ready", undefined, `copy = [${JSON.stringify(path)}]\n`);

			await expect(
				dispatch("copy", ["--cwd", `${root}__feature--invalid-${path.length}`, "--json"], deps),
			).rejects.toMatchObject({ exitCode: EXIT_CODES.USAGE });
		},
	);

	test("missing source fails as config error without structured stdout", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready");
		await dispatch("add", ["--cwd", root, "--branch", "feature/missing-copy", "--json"], deps);
		writeConfig(tmp, root, "echo ready", undefined, 'copy = [".env.missing"]\n');

		await expect(
			dispatch("copy", ["--cwd", `${root}__feature--missing-copy`, "--json"], deps),
		).rejects.toMatchObject({
			message: expect.stringContaining("copy source does not exist"),
			exitCode: EXIT_CODES.USAGE,
		});
	});

	test("symlink source files fail as config errors in copy mode", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeFileSync(join(root, ".env.real"), "real\n");
		symlinkSync(".env.real", join(root, ".env.link"));
		writeConfig(tmp, root, "echo ready");
		await dispatch("add", ["--cwd", root, "--branch", "feature/symlink-source", "--json"], deps);
		writeConfig(tmp, root, "echo ready", undefined, 'copy = [".env.link"]\n');

		await expect(
			dispatch("copy", ["--cwd", `${root}__feature--symlink-source`, "--json"], deps),
		).rejects.toMatchObject({
			message: expect.stringContaining("not a regular file"),
			exitCode: EXIT_CODES.USAGE,
		});
	});

	test("symlink mode creates destination symlinks to resolved source targets", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		const externalTarget = join(tmp, "external.env");
		writeFileSync(externalTarget, "external\n");
		symlinkSync(externalTarget, join(root, ".env"));
		writeConfig(
			tmp,
			root,
			"echo ready",
			undefined,
			'copy_mode_default = "symlink"\ncopy = [".env"]\n',
		);
		await dispatch("add", ["--cwd", root, "--branch", "feature/symlink-mode", "--json"], deps);
		const worktreePath = `${root}__feature--symlink-mode`;

		const result = await dispatch("copy", ["--cwd", worktreePath, "--json"], deps);
		const destination = join(worktreePath, ".env");

		expect(lstatSync(destination).isSymbolicLink()).toBe(true);
		const resolvedTarget = realpathSync(externalTarget);
		expect(readlinkSync(destination)).toBe(resolvedTarget);
		expect(readFileSync(destination, "utf8")).toBe("external\n");
		expect(JSON.parse(result.stdout ?? "{}").copied).toEqual([
			{ from: resolvedTarget, to: ".env", type: "symlink" },
		]);
	});

	test("copy preflights all entries before replacing destinations", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeFileSync(join(root, ".env"), "source\n");
		writeConfig(tmp, root, "echo ready");
		await dispatch("add", ["--cwd", root, "--branch", "feature/preflight", "--json"], deps);
		writeConfig(tmp, root, "echo ready", undefined, 'copy = [".env", ".env.missing"]\n');
		const worktreePath = `${root}__feature--preflight`;
		writeFileSync(join(worktreePath, ".env"), "do not replace\n");

		await expect(dispatch("copy", ["--cwd", worktreePath, "--json"], deps)).rejects.toMatchObject({
			exitCode: EXIT_CODES.USAGE,
		});

		expect(readFileSync(join(worktreePath, ".env"), "utf8")).toBe("do not replace\n");
	});

	test("copies object file sources from root-relative, absolute, and home paths", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeFileSync(join(root, "root.env"), "root\n");
		const absoluteSource = join(tmp, "absolute.env");
		writeFileSync(absoluteSource, "absolute\n");
		const homeRelative = `.wktree-test-${basename(tmp)}.env`;
		const homeSource = join(homedir(), homeRelative);
		writeFileSync(homeSource, "home\n");
		try {
			writeConfig(
				tmp,
				root,
				"echo ready",
				undefined,
				`copy = [\n  { from = "root.env", to = "copied/root.env" },\n  { from = ${JSON.stringify(absoluteSource)}, to = "copied/absolute.env" },\n  { from = "~/${homeRelative}", to = ["copied/home.env", "copied/home-again.env"] },\n]\n`,
			);
			await dispatch("add", ["--cwd", root, "--branch", "feature/object-files", "--json"], deps);
			const worktreePath = `${root}__feature--object-files`;

			const result = await dispatch("copy", ["--cwd", worktreePath, "--json"], deps);
			const payload = JSON.parse(result.stdout ?? "{}");

			expect(readFileSync(join(worktreePath, "copied/root.env"), "utf8")).toBe("root\n");
			expect(readFileSync(join(worktreePath, "copied/absolute.env"), "utf8")).toBe("absolute\n");
			expect(readFileSync(join(worktreePath, "copied/home-again.env"), "utf8")).toBe("home\n");
			expect(payload.copied).toEqual([
				{ from: join(root, "root.env"), to: "copied/root.env", type: "file" },
				{ from: absoluteSource, to: "copied/absolute.env", type: "file" },
				{ from: homeSource, to: "copied/home.env", type: "file" },
				{ from: homeSource, to: "copied/home-again.env", type: "file" },
			]);
			expect(payload.exclude_paths).toEqual([
				"copied/absolute.env",
				"copied/home-again.env",
				"copied/home.env",
				"copied/root.env",
			]);
		} finally {
			rmSync(homeSource, { force: true });
		}
	});

	test("copies directories to exact final destinations and removes stale files on rerun", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		mkdirSync(join(root, "skill-dir"));
		writeFileSync(join(root, "skill-dir", "foo.ts"), "one\n");
		writeConfig(
			tmp,
			root,
			"echo ready",
			undefined,
			'copy = [{ from = "skill-dir", to = [".claude/skills/skill-dir", ".pi/agents/skill-dir"] }]\n',
		);
		await dispatch("add", ["--cwd", root, "--branch", "feature/dir-copy", "--json"], deps);
		const worktreePath = `${root}__feature--dir-copy`;
		await dispatch("copy", ["--cwd", worktreePath], deps);
		writeFileSync(join(worktreePath, ".claude/skills/skill-dir", "stale.ts"), "stale\n");
		rmSync(join(root, "skill-dir", "foo.ts"));
		writeFileSync(join(root, "skill-dir", "bar.ts"), "two\n");

		const result = await dispatch("copy", ["--cwd", worktreePath, "--json"], deps);

		expect(existsSync(join(worktreePath, ".claude/skills/skill-dir", "stale.ts"))).toBe(false);
		expect(readFileSync(join(worktreePath, ".claude/skills/skill-dir", "bar.ts"), "utf8")).toBe(
			"two\n",
		);
		expect(readFileSync(join(worktreePath, ".pi/agents/skill-dir", "bar.ts"), "utf8")).toBe(
			"two\n",
		);
		expect(JSON.parse(result.stdout ?? "{}").copied).toEqual([
			{ from: join(root, "skill-dir"), to: ".claude/skills/skill-dir", type: "directory" },
			{ from: join(root, "skill-dir"), to: ".pi/agents/skill-dir", type: "directory" },
		]);
	});

	test("tracked descendants under directory destinations block with unsafe JSON", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		mkdirSync(join(root, "src-dir"));
		writeFileSync(join(root, "src-dir", "foo.txt"), "source\n");
		writeConfig(tmp, root, "echo ready");
		await dispatch("add", ["--cwd", root, "--branch", "feature/tracked-desc", "--json"], deps);
		writeConfig(
			tmp,
			root,
			"echo ready",
			undefined,
			'copy = [{ from = "src-dir", to = "tracked-dir" }]\n',
		);
		const worktreePath = `${root}__feature--tracked-desc`;
		mkdirSync(join(worktreePath, "tracked-dir"));
		writeFileSync(join(worktreePath, "tracked-dir", "keep.txt"), "tracked\n");
		await run(["git", "-C", worktreePath, "add", "tracked-dir/keep.txt"]);
		await run(["git", "-C", worktreePath, "commit", "-m", "tracked descendant"]);

		const result = await dispatch("copy", ["--cwd", worktreePath, "--json"], deps);

		expect(result.exitCode).toBe(EXIT_CODES.UNSAFE);
		expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({ kind: "blocked", reason: "unsafe" });
		expect(readFileSync(join(worktreePath, "tracked-dir", "keep.txt"), "utf8")).toBe("tracked\n");
	});

	test("tracked destination ancestors block with unsafe JSON", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeFileSync(join(root, ".env"), "source\n");
		writeFileSync(join(root, "tracked-file"), "tracked\n");
		await run(["git", "-C", root, "add", "tracked-file"]);
		await run(["git", "-C", root, "commit", "-m", "tracked ancestor"]);
		await run(["git", "-C", root, "push", "origin", "main"]);
		writeConfig(tmp, root, "echo ready");
		await dispatch("add", ["--cwd", root, "--branch", "feature/tracked-ancestor", "--json"], deps);
		writeConfig(
			tmp,
			root,
			"echo ready",
			undefined,
			'copy = [{ from = ".env", to = "tracked-file/nested" }]\n',
		);

		const result = await dispatch(
			"copy",
			["--cwd", `${root}__feature--tracked-ancestor`, "--json"],
			deps,
		);

		expect(result.exitCode).toBe(EXIT_CODES.UNSAFE);
		expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({ kind: "blocked", reason: "unsafe" });
	});

	test("untracked file inside tracked directory destination is allowed", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeFileSync(join(root, "source.txt"), "source\n");
		mkdirSync(join(root, ".claude"));
		writeFileSync(join(root, ".claude", "settings.json"), '{"tracked":true}\n');
		await run(["git", "-C", root, "add", "source.txt", ".claude/settings.json"]);
		await run(["git", "-C", root, "commit", "-m", "track claude settings"]);
		await run(["git", "-C", root, "push", "origin", "main"]);
		writeConfig(tmp, root, "echo ready");
		await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/tracked-dir-ancestor", "--json"],
			deps,
		);
		writeConfig(
			tmp,
			root,
			"echo ready",
			undefined,
			'copy = [{ from = "source.txt", to = ".claude/settings.local.json" }]\n',
		);
		const worktreePath = `${root}__feature--tracked-dir-ancestor`;

		const result = await dispatch("copy", ["--cwd", worktreePath, "--json"], deps);

		expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
		expect(readFileSync(join(worktreePath, ".claude", "settings.local.json"), "utf8")).toBe(
			"source\n",
		);
		expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
			kind: "ready",
			root,
			worktree_path: worktreePath,
			copied: [{ from: join(root, "source.txt"), to: ".claude/settings.local.json", type: "file" }],
			exclude_paths: [".claude/settings.local.json"],
		});
	});

	test("deduplicates exclude paths across entries and multi-target destinations", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeFileSync(join(root, ".env"), "one\n");
		writeConfig(
			tmp,
			root,
			"echo ready",
			undefined,
			'copy = [".env", { from = ".env", to = [".env", "copy.env"] }, { from = ".env", to = "copy.env" }]\n',
		);
		await dispatch("add", ["--cwd", root, "--branch", "feature/dedup", "--json"], deps);

		const payload = JSON.parse(
			(await dispatch("copy", ["--cwd", `${root}__feature--dedup`, "--json"], deps)).stdout ?? "{}",
		);

		expect(payload.exclude_paths).toEqual([".env", "copy.env"]);
	});

	test.each([
		{ name: "missing from", config: 'copy = [{ to = ".env" }]' },
		{ name: "missing to", config: 'copy = [{ from = ".env" }]' },
		{ name: "empty from", config: 'copy = [{ from = "", to = ".env" }]' },
		{ name: "empty to", config: 'copy = [{ from = ".env", to = "" }]' },
		{ name: "absolute to", config: 'copy = [{ from = ".env", to = "/tmp/.env" }]' },
		{ name: "home to", config: 'copy = [{ from = ".env", to = "~/.env" }]' },
		{ name: "leading home to", config: 'copy = [{ from = ".env", to = "~secret" }]' },
		{ name: "escaping to", config: 'copy = [{ from = ".env", to = "../.env" }]' },
	])("invalid object config $name fails as config error", async ({ config }) => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready");
		await dispatch("add", ["--cwd", root, "--branch", "feature/invalid-object", "--json"], deps);
		writeConfig(tmp, root, "echo ready", undefined, `${config}\n`);

		await expect(
			dispatch("copy", ["--cwd", `${root}__feature--invalid-object`, "--json"], deps),
		).rejects.toMatchObject({
			exitCode: EXIT_CODES.USAGE,
		});
	});

	test("env-var and glob-looking object sources are treated literally", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeFileSync(join(root, "$SECRET*.env"), "literal\n");
		writeConfig(
			tmp,
			root,
			"echo ready",
			undefined,
			'copy = [{ from = "$SECRET*.env", to = "literal.env" }]\n',
		);
		await dispatch("add", ["--cwd", root, "--branch", "feature/literal", "--json"], deps);

		await dispatch("copy", ["--cwd", `${root}__feature--literal`], deps);

		expect(readFileSync(join(`${root}__feature--literal`, "literal.env"), "utf8")).toBe(
			"literal\n",
		);
	});

	test("follows symlinked shared exclude path", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		const excludePath = (
			await run(["git", "-C", root, "rev-parse", "--git-path", "info/exclude"])
		).stdout.trim();
		const realExclude = join(tmp, "real-exclude");
		rmSync(resolve(root, excludePath));
		symlinkSync(realExclude, resolve(root, excludePath));
		writeFileSync(realExclude, "*.log\n");
		writeFileSync(join(root, ".env"), "ignored\n");
		writeConfig(tmp, root, "echo ready", undefined, 'copy = [".env"]\n');
		await dispatch("add", ["--cwd", root, "--branch", "feature/symlink-exclude", "--json"], deps);

		await dispatch("copy", ["--cwd", `${root}__feature--symlink-exclude`], deps);

		expect(readFileSync(realExclude, "utf8")).toBe("*.log\n# wktree-start\n.env\n# wktree-end\n");
		expect((await run(["test", "-L", resolve(root, excludePath)])).exitCode).toBe(0);
	});

	test("exclude fence is idempotent, preserves unrelated lines, removes when copy is removed, and ignores copied files", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		const excludePath = (
			await run(["git", "-C", root, "rev-parse", "--git-path", "info/exclude"])
		).stdout.trim();
		writeFileSync(resolve(root, excludePath), "*.log\n");
		writeFileSync(join(root, ".env"), "ignored\n");
		writeConfig(tmp, root, "echo ready", undefined, 'copy = [".env"]\n');
		await dispatch("add", ["--cwd", root, "--branch", "feature/ignore-copy", "--json"], deps);
		const worktreePath = `${root}__feature--ignore-copy`;
		await dispatch("copy", ["--cwd", worktreePath], deps);
		await dispatch("copy", ["--cwd", worktreePath], deps);

		const withFence = readFileSync(resolve(root, excludePath), "utf8");
		expect(withFence).toBe("*.log\n# wktree-start\n.env\n# wktree-end\n");
		expect((await run(["git", "-C", worktreePath, "status", "--porcelain"])).stdout).toBe("");

		writeConfig(tmp, root, "echo ready");
		await dispatch("copy", ["--cwd", worktreePath], deps);

		expect(readFileSync(resolve(root, excludePath), "utf8")).toBe("*.log\n");
	});
});
