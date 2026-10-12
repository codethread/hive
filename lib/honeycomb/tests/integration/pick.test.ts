import { EXIT_CODES, UsageError, dispatch } from "../../src/index";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	createTestCdDirective,
	createTestMultiplexer,
	createTestPicker,
	initRepo,
	restoreTestEnv,
	run,
	setTestEnv,
	testDeps,
} from "./support.ts";
/* oxlint-disable-next-line import/no-nodejs-modules -- pick fixtures create real repositories on disk */
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { gitLogPreviewCommand } from "../../src/integrations/multiplexer.ts";
/* oxlint-disable-next-line import/no-nodejs-modules -- fixture paths are built with node:path */
import { join } from "node:path";
/* oxlint-disable-next-line import/no-nodejs-modules -- fixtures live in the host temporary directory */
import { tmpdir } from "node:os";

const NO_PREVIEW_CALLS = 0;
const ONE_PREVIEW_CALL = 1;

function pickDeps(choice: string | null, attached = true) {
	const picker = createTestPicker(choice, true);
	const multiplexer = createTestMultiplexer(attached);
	const cdDirective = createTestCdDirective();
	return {
		cdDirective,
		deps: testDeps({ cdDirective, multiplexer, picker }),
		multiplexer,
		picker,
	};
}

let tmp = "";
let root = "";
let featurePath = "";

beforeEach(async () => {
	tmp = await mkdtemp(join(tmpdir(), "honeycomb-pick-test-"));
	setTestEnv("HOME", tmp);
	setTestEnv("GIT_CONFIG_NOSYSTEM", "1");
	setTestEnv("GIT_CONFIG_GLOBAL", join(tmp, "gitconfig"));
	setTestEnv("XDG_CONFIG_HOME", join(tmp, "config"));
	await initRepo(join(tmp, "repo"));
	root = await realpath(join(tmp, "repo"));
	featurePath = `${root}__feature`;
	await run(["git", "-C", root, "worktree", "add", "-b", "feature", featurePath]);
});

afterEach(async () => {
	restoreTestEnv();
	await rm(tmp, { force: true, recursive: true });
});

describe("honeycomb pick", () => {
	test("select writes the chosen path to the cd directive and prints it", async () => {
		const { deps, picker, multiplexer, cdDirective } = pickDeps(featurePath);

		const result = await dispatch("pick", ["--cwd", join(root, "."), "--interactive"], deps);

		expect(result).toEqual({ exitCode: EXIT_CODES.SUCCESS, stdout: `${featurePath}\n` });
		expect(cdDirective.paths).toEqual([featurePath]);
		expect(multiplexer.opened).toEqual([]);
		expect(picker.options).toEqual({ interactive: true });
		expect(picker.items).toEqual([
			{ display: `${root}\t* main`, key: root, preview: "test-preview" },
			{ display: `${featurePath}\t  feature`, key: featurePath, preview: "test-preview" },
		]);
	});

	test("interactive without a multiplexer still previews history and hands back the path", async () => {
		const { deps, picker, multiplexer, cdDirective } = pickDeps(featurePath, false);

		const result = await dispatch("pick", ["--cwd", root, "--interactive"], deps);

		expect(result).toEqual({ exitCode: EXIT_CODES.SUCCESS, stdout: `${featurePath}\n` });
		expect(cdDirective.paths).toEqual([featurePath]);
		expect(picker.options).toEqual({ interactive: true });
		expect(multiplexer.previewCalls).toBe(ONE_PREVIEW_CALL);
		expect(picker.items.map((item) => item.preview)).toEqual([
			gitLogPreviewCommand(),
			gitLogPreviewCommand(),
		]);
	});

	test("without --interactive, select only prints the path and never touches the multiplexer", async () => {
		const { deps, picker, multiplexer, cdDirective } = pickDeps(featurePath);

		const result = await dispatch("pick", ["--cwd", root], deps);

		expect(result).toEqual({ exitCode: EXIT_CODES.SUCCESS, stdout: `${featurePath}\n` });
		expect(cdDirective.paths).toEqual([]);
		expect(picker.options).toEqual({ interactive: false });
		expect(multiplexer.previewCalls).toBe(NO_PREVIEW_CALLS);
		expect(picker.items.map((item) => item.preview)).toEqual([
			gitLogPreviewCommand(),
			gitLogPreviewCommand(),
		]);
	});
});

describe("honeycomb pick --open", () => {
	test("--open opens the selection's session without a cd directive", async () => {
		const { deps, multiplexer, cdDirective } = pickDeps(featurePath);

		const result = await dispatch("pick", ["--cwd", root, "--open", "--interactive"], deps);

		expect(result).toEqual({ exitCode: EXIT_CODES.SUCCESS });
		expect(multiplexer.opened).toEqual([
			{ name: "repo__feature", path: featurePath, title: "feature" },
		]);
		expect(cdDirective.paths).toEqual([]);
	});

	test.each([
		["interactive open", ["--open", "--interactive"], EXIT_CODES.SUCCESS],
		["interactive cd", ["--interactive"], EXIT_CODES.SUCCESS],
		["noninteractive", [], EXIT_CODES.CANCELLED],
	])("cancel %s exits quietly without switching", async (_case, flags, exitCode) => {
		// oxlint-disable-next-line unicorn/no-null -- TestPicker models cancellation as an explicit null choice
		const { deps, multiplexer, cdDirective } = pickDeps(null);

		const result = await dispatch("pick", ["--cwd", root, ...flags], deps);

		expect(result).toEqual({ exitCode });
		expect(multiplexer.opened).toEqual([]);
		expect(cdDirective.paths).toEqual([]);
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
