import { defaultProjectConfig, selectHookConfig, writeProjectConfig } from "../src/config.ts";
import { expect, test } from "bun:test";
import {
	readProjectLock,
	requireProjectConfig,
	requireProjectVersion,
	writeProjectLock,
} from "../src/project.ts";
import { BeeswaxError } from "../src/errors.ts";
import { fixture } from "./support.ts";

const root = "/repo";
const config = defaultProjectConfig("husky");
const { contract, files } = await prepareContract();

async function prepareContract() {
	const fx = fixture();
	await writeProjectConfig(root, config, fx.deps);
	await writeProjectLock(root, fx.deps);
	const lock = await readProjectLock(root, fx.deps);
	if (!lock) {
		throw new Error("Missing generated contract");
	}
	return { contract: lock, files: fx.files };
}

test("a committed contract reproduces intent without any local receipt", () => {
	expect(() => requireProjectConfig(contract, config)).not.toThrow();
	expect(() => requireProjectVersion(contract)).not.toThrow();
	expect(contract).toMatchObject({
		skills: ["repository-setup"],
		hooks: { ".husky/pre-commit": expect.any(String) },
	});
	expect([...files.keys()]).toEqual([
		"/repo/.hive/beeswax/config.toml",
		"/repo/.hive/beeswax/meta/lock.json",
	]);
});

test("configuration drift and release drift fail before implicit upgrades", () => {
	expect(() => requireProjectConfig(contract, defaultProjectConfig("git"))).toThrow(BeeswaxError);
	expect(() => requireProjectVersion({ ...contract, beeswaxVersion: "0.0.0" })).toThrow(
		BeeswaxError,
	);
});

test("unrecognized project metadata asks an agent to establish the migration path", async () => {
	const fx = fixture();
	fx.files.set("/repo/.hive/beeswax/meta/lock.json", '{"format":99}');
	const failure = await readProjectLock(root, fx.deps).catch((error: unknown) => error);
	expect(failure).toMatchObject({
		context: { nextCommand: "beeswax migrate setup", requiresUser: true },
	});
});

test("framework defaults preserve pinned paths when bootstrap is retained or disabled", () => {
	const custom = {
		...config,
		hooks: { pre_commit: "custom/commit", pre_merge_commit: "custom/merge" },
	};
	expect(selectHookConfig(custom, "husky")).toBe(custom);
	expect(selectHookConfig(custom, "none")).toEqual({ ...custom, bootstrap: { hooks: "none" } });
	expect(selectHookConfig(custom, "git")).toEqual({
		...custom,
		bootstrap: { hooks: "git" },
		hooks: defaultProjectConfig("git").hooks,
	});
});
