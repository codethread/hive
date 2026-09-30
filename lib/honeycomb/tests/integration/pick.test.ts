import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatch, EXIT_CODES, UsageError } from "../../src/index";
import { gitLogPreviewCommand } from "../../src/integrations/multiplexer.ts";
import {
	TestCdDirective,
	TestMultiplexer,
	TestPicker,
	initRepo,
	restoreTestEnv,
	run,
	setTestEnv,
	testDeps,
} from "./support.ts";

const pickDeps = (choice: string | null, attached = true) => {
	const picker = new TestPicker(choice, true);
	const multiplexer = new TestMultiplexer(attached);
	const cdDirective = new TestCdDirective();
	return {
		picker,
		multiplexer,
		cdDirective,
		deps: testDeps({ picker, multiplexer, cdDirective }),
	};
};

describe("honeycomb pick", () => {
	let tmp: string;
	let root: string;
	let featurePath: string;

	beforeEach(async () => {
		tmp = mkdtempSync(join(tmpdir(), "honeycomb-pick-test-"));
		setTestEnv("HOME", tmp);
		setTestEnv("GIT_CONFIG_NOSYSTEM", "1");
		setTestEnv("GIT_CONFIG_GLOBAL", join(tmp, "gitconfig"));
		setTestEnv("XDG_CONFIG_HOME", join(tmp, "config"));
		await initRepo(join(tmp, "repo"));
		root = realpathSync(join(tmp, "repo"));
		featurePath = `${root}__feature`;
		await run(["git", "-C", root, "worktree", "add", "-b", "feature", featurePath]);
	});

	afterEach(() => {
		restoreTestEnv();
		rmSync(tmp, { recursive: true, force: true });
	});

	test("select writes the chosen path to the cd directive and prints it", async () => {
		const { deps, picker, multiplexer, cdDirective } = pickDeps(featurePath);

		const result = await dispatch("pick", ["--cwd", join(root, "."), "--interactive"], deps);

		expect(result).toEqual({ stdout: `${featurePath}\n`, exitCode: EXIT_CODES.SUCCESS });
		expect(cdDirective.paths).toEqual([featurePath]);
		expect(multiplexer.opened).toEqual([]);
		expect(picker.options).toEqual({ interactive: true });
		expect(picker.items).toEqual([
			{ key: root, display: `${root}\t* main`, preview: "test-preview" },
			{ key: featurePath, display: `${featurePath}\t  feature`, preview: "test-preview" },
		]);
	});

	test("interactive without a multiplexer still previews history and hands back the path", async () => {
		const { deps, picker, multiplexer, cdDirective } = pickDeps(featurePath, false);

		const result = await dispatch("pick", ["--cwd", root, "--interactive"], deps);

		expect(result).toEqual({ stdout: `${featurePath}\n`, exitCode: EXIT_CODES.SUCCESS });
		expect(cdDirective.paths).toEqual([featurePath]);
		expect(picker.options).toEqual({ interactive: true });
		expect(multiplexer.previewCalls).toBe(1);
		expect(picker.items.map((item) => item.preview)).toEqual([
			gitLogPreviewCommand(),
			gitLogPreviewCommand(),
		]);
	});

	test("--open opens the selection's session without a cd directive", async () => {
		const { deps, multiplexer, cdDirective } = pickDeps(featurePath);

		const result = await dispatch("pick", ["--cwd", root, "--open", "--interactive"], deps);

		expect(result).toEqual({ exitCode: EXIT_CODES.SUCCESS });
		expect(multiplexer.opened).toEqual([
			{ name: "repo__feature", title: "feature", path: featurePath },
		]);
		expect(cdDirective.paths).toEqual([]);
	});

	test("cancel exits quietly without switching", async () => {
		const { deps, multiplexer, cdDirective } = pickDeps(null);

		const result = await dispatch("pick", ["--cwd", root, "--open", "--interactive"], deps);

		expect(result).toEqual({ exitCode: EXIT_CODES.CANCELLED });
		expect(multiplexer.opened).toEqual([]);
		expect(cdDirective.paths).toEqual([]);
	});

	test("without --interactive, select only prints the path and never touches the multiplexer", async () => {
		const { deps, picker, multiplexer, cdDirective } = pickDeps(featurePath);

		const result = await dispatch("pick", ["--cwd", root], deps);

		expect(result).toEqual({ stdout: `${featurePath}\n`, exitCode: EXIT_CODES.SUCCESS });
		expect(cdDirective.paths).toEqual([]);
		expect(picker.options).toEqual({ interactive: false });
		expect(multiplexer.previewCalls).toBe(0);
		expect(picker.items.map((item) => item.preview)).toEqual([
			gitLogPreviewCommand(),
			gitLogPreviewCommand(),
		]);
	});

	test.each([
		["without --interactive", ["--open"], true],
		["outside a multiplexer", ["--open", "--interactive"], false],
	])("--open %s is a usage error before picking", async (_case, flags, attached) => {
		const { deps, picker } = pickDeps(featurePath, attached);

		const { failure } = await dispatch("pick", ["--cwd", root, ...flags], deps);
		expect(failure).toBeInstanceOf(UsageError);
		expect(picker.items).toEqual([]);
	});
});
