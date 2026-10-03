import { EXIT_CODES, dispatch } from "../../src/index";
import { TestPicker, run, testDeps, useOriginFixture, writeConfig } from "./support.ts";
import { expect, test } from "bun:test";
import { gitOut, useTmpHome } from "./lifecycle-helpers.ts";

const SINGLE_SLOT = 1;
const NO_CONFIRMATIONS = 0;
const ONE_CONFIRMATION = 1;

const tmp = useTmpHome("honeycomb-pool-add-full-test-");
const { initRepoWithOrigin } = useOriginFixture();

const occupySlot = async () => {
	const { root } = await initRepoWithOrigin(tmp.dir);
	writeConfig({ command: "echo ready", poolSize: SINGLE_SLOT, root, tmp: tmp.dir });
	await dispatch("add", ["--cwd", root, "--branch", "feature/one", "--json"], testDeps());
	return root;
};

const assertPickerIgnored = async (
	root: string,
	picker: TestPicker,
	request: { branch: string; extra?: string[] },
) => {
	const { branch, extra = [] } = request;
	const blocked = await dispatch(
		"add",
		["--cwd", root, "--branch", branch, ...extra, "--json"],
		testDeps({ picker }),
	);
	expect(blocked.exitCode).toBe(EXIT_CODES.BLOCKED);
	expect(JSON.parse(blocked.stdout ?? "{}")).toMatchObject({ branch, kind: "pool_full" });
	expect(picker.items).toEqual([]);
	expect(picker.confirmCalls).toBe(NO_CONFIRMATIONS);
	expect(await gitOut(`${root}__feat1`, "branch", "--show-current")).toBe("feature/one");
};

test("machine json add reports pool_full and --slot selects a specific slot", async () => {
	const root = await occupySlot();

	const blocked = await dispatch(
		"add",
		["--cwd", root, "--branch", "feature/two", "--json"],
		// oxlint-disable-next-line unicorn/no-null -- TestPicker uses null to model cancellation.
		testDeps({ picker: new TestPicker(null, true) }),
	);

	expect(blocked.exitCode).toBe(EXIT_CODES.BLOCKED);
	expect(JSON.parse(blocked.stdout ?? "{}")).toMatchObject({
		branch: "feature/two",
		candidates: [
			{
				branch: "feature/one",
				dirty: false,
				local_only: true,
				path: `${root}__feat1`,
				slot: 1,
			},
		],
		kind: "pool_full",
		root,
	});

	const selected = await dispatch(
		"add",
		["--cwd", root, "--branch", "feature/two", "--json", "--slot", `${root}__feat1`, "--force"],
		// oxlint-disable-next-line unicorn/no-null -- TestPicker uses null to model cancellation.
		testDeps({ picker: new TestPicker(null, true) }),
	);

	expect(selected.exitCode).toBe(EXIT_CODES.SUCCESS);
	expect(JSON.parse(selected.stdout ?? "{}")).toMatchObject({
		branch: "feature/two",
		kind: "ready",
		session: { name: "repo__feat1", path: `${root}__feat1` },
		worktree_path: `${root}__feat1`,
	});
	expect(await gitOut(`${root}__feat1`, "branch", "--show-current")).toBe("feature/two");
});
test("machine json pool_full bypasses picker and leaves the occupied slot untouched", async () => {
	const root = await occupySlot();
	await run([
		"git",
		"-C",
		`${root}__feat1`,
		"branch",
		"--set-upstream-to",
		"origin/main",
		"feature/one",
	]);
	const picker = new TestPicker("1", true);

	const blocked = await dispatch(
		"add",
		["--cwd", root, "--branch", "feature/two", "--json"],
		testDeps({ picker }),
	);

	expect(blocked.exitCode).toBe(EXIT_CODES.BLOCKED);
	expect(JSON.parse(blocked.stdout ?? "{}")).toMatchObject({
		branch: "feature/two",
		candidates: [{ branch: "feature/one", path: `${root}__feat1`, slot: 1 }],
		kind: "pool_full",
	});
	expect(await gitOut(`${root}__feat1`, "branch", "--show-current")).toBe("feature/one");
	expect(picker.items).toEqual([]);
	expect(picker.confirmCalls).toBe(NO_CONFIRMATIONS);
});
test("machine json pool_full ignores picker state and --force without mutating the slot", async () => {
	const root = await occupySlot();
	// oxlint-disable-next-line unicorn/no-null -- TestPicker uses null to model cancellation.
	const cancelPicker = new TestPicker(null, true);
	await assertPickerIgnored(root, cancelPicker, { branch: "feature/cancel" });
	await assertPickerIgnored(root, new TestPicker("1", false), { branch: "feature/no" });
	await assertPickerIgnored(root, new TestPicker("1", false), {
		branch: "feature/forced",
		extra: ["--force"],
	});
});
test("human pool_full recycle tells the picker the invocation is not interactive", async () => {
	const root = await occupySlot();
	const picker = new TestPicker("1", true);

	const recycled = await dispatch(
		"add",
		["--cwd", root, "--branch", "feature/two"],
		testDeps({ picker }),
	);

	expect(recycled.exitCode).toBe(EXIT_CODES.SUCCESS);
	expect(picker.options).toEqual({ interactive: false });
	expect(picker.confirmCalls).toBe(ONE_CONFIRMATION);
	expect(await gitOut(`${root}__feat1`, "branch", "--show-current")).toBe("feature/two");
});
