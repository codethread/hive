import { defaultProjectConfig, selectHookConfig, writeProjectConfig } from "../src/config.ts";
import { expect, test } from "bun:test";
import {
	readProjectLock,
	requireProjectConfig,
	requireProjectGeneration,
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
	expect(() => requireProjectGeneration(contract, config)).not.toThrow();
	expect(contract).toMatchObject({
		skills: ["repository-setup", "tracker-recovery"],
		hooks: { ".husky/pre-commit": expect.any(String) },
	});
	expect([...files.keys()]).toEqual([
		"/repo/.hive/beeswax/config.toml",
		"/repo/.hive/beeswax/meta/lock.json",
	]);
});

test("the known previous skill catalogue can advance to the recovery catalogue", async () => {
	const fx = fixture();
	const fresh = await prepareContract();
	for (const [path, contents] of fresh.files) {
		fx.files.set(path, contents);
	}
	const previous = { ...fresh.contract, skills: ["repository-setup"] };
	fx.files.set("/repo/.hive/beeswax/meta/lock.json", JSON.stringify(previous));
	expect(() => requireProjectGeneration(previous, config)).not.toThrow();

	await writeProjectLock(root, fx.deps);

	const updated = await readProjectLock(root, fx.deps);
	expect(updated?.skills).toEqual(["repository-setup", "tracker-recovery"]);
});

test("configuration drift and release drift fail before implicit upgrades", () => {
	expect(() => requireProjectConfig(contract, defaultProjectConfig("git"))).toThrow(BeeswaxError);
	expect(() => requireProjectVersion({ ...contract, beeswaxVersion: "0.0.0" })).toThrow(
		BeeswaxError,
	);
});

test("repeated lock generation preserves the formatting of an unchanged contract", async () => {
	const fx = fixture();
	for (const [path, contents] of files) {
		fx.files.set(path, contents);
	}
	const path = "/repo/.hive/beeswax/meta/lock.json";
	const formatted = `${JSON.stringify(JSON.parse(fx.files.get(path) ?? ""))}\n`;
	fx.files.set(path, formatted);

	await writeProjectLock(root, fx.deps);

	expect(fx.files.get(path)).toBe(formatted);
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
