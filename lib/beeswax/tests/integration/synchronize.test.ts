import { defaultProjectConfig, writeProjectConfig } from "../../src/config.ts";
import { expect, test } from "bun:test";
import { hookSection, previousHookSection } from "../../src/templates.ts";
import { lockSchema, writeProjectLock } from "../../src/project.ts";
import { fixture } from "../support.ts";
import { runCli } from "../../src/cli.ts";
import { version } from "../../package.json";

const root = "/repo";
const success = 0;
const failure = 1;
const template = fixture();
await writeProjectConfig(root, defaultProjectConfig("husky"), template.deps);
await writeProjectLock(root, template.deps);

function configured() {
	const fx = fixture();
	for (const [path, contents] of template.files) {
		fx.files.set(path, contents);
	}
	return fx;
}

test(
	"sync materializes committed intent without publishing tracker state or rewriting " +
		"the lock #test-365",
	async () => {
		const fx = configured();
		const lock = fx.files.get("/repo/.hive/beeswax/meta/lock.json");
		expect(await runCli(["sync", "--json"], fx.deps)).toBe(success);
		expect(JSON.parse(fx.output.join(""))).toMatchObject({
			ok: true,
			kind: "project_synchronized",
			projectLockUpdated: false,
		});
		expect(fx.files.get("/repo/.hive/beeswax/meta/lock.json")).toBe(lock);
		expect(fx.errors).toEqual([]);
	},
);

test("update uses command availability at the project root without persisting machine state #test-389", async () => {
	const fx = configured();
	fx.deps.commandAvailable = (name, cwd) => name === "beeswax" && cwd === root;
	expect(await runCli(["update", "--json"], fx.deps)).toBe(success);
	expect(JSON.parse(fx.output.join(""))).toMatchObject({
		changelogs: {
			previousVersion: version,
			installedVersion: version,
			commands: ["beeswax changelog"],
		},
	});
	expect(fx.files.get("/repo/.hive/beeswax/meta/lock.json")).toBe(
		template.files.get("/repo/.hive/beeswax/meta/lock.json"),
	);
});

// eslint-disable-next-line max-statements -- Verify section replacement and recorded intent through one public update.
test("update replaces the previous owned hook generation and records the new hashes", async () => {
	const fx = configured();
	const path = "/repo/.hive/beeswax/meta/lock.json";
	const lock = lockSchema.parse(JSON.parse(fx.files.get(path) ?? ""));
	for (const target of Object.keys(lock.hooks)) {
		lock.hooks[target] = new Bun.CryptoHasher("sha256").update(previousHookSection).digest("hex");
		fx.files.set(
			`${root}/${target}`,
			`# application header\n${previousHookSection}\necho application\n`,
		);
	}
	fx.files.set(path, JSON.stringify(lock));
	expect(await runCli(["update", "--json"], fx.deps)).toBe(success);
	for (const target of Object.keys(lock.hooks)) {
		expect(fx.files.get(`${root}/${target}`)).toBe(
			`# application header\n${hookSection}\necho application\n`,
		);
	}
	expect(fx.files.get(path)).toBe(template.files.get(path));
	expect(fx.errors).toEqual([]);
});

test(
	"sync refuses configuration drift before writes and explicit update accepts " +
		"supported changes #test-388",
	async () => {
		const fx = configured();
		const config = { ...defaultProjectConfig("husky"), bootstrap: { hooks: "none" as const } };
		await writeProjectConfig(root, config, fx.deps);
		const before = new Map(fx.files);
		expect(await runCli(["sync", "--json"], fx.deps)).toBe(failure);
		expect(JSON.parse(fx.output.join(""))).toMatchObject({
			reason: "configuration_changed",
			nextCommand: "beeswax update",
			completed: [],
		});
		expect(fx.files).toEqual(before);
		fx.output.length = success;
		expect(await runCli(["update", "--json"], fx.deps)).toBe(success);
		expect(JSON.parse(fx.output.join(""))).toMatchObject({ ok: true, projectLockUpdated: true });
	},
);

test("moving configured hook files requires an agent to account for the old sections", async () => {
	const fx = configured();
	await writeProjectConfig(root, defaultProjectConfig("git"), fx.deps);
	const before = new Map(fx.files);
	expect(await runCli(["update", "--json"], fx.deps)).toBe(failure);
	expect(JSON.parse(fx.output.join(""))).toMatchObject({
		reason: "migration_required",
		requiresUser: true,
		nextCommand: "beeswax migrate setup",
		completed: [],
	});
	expect(fx.files).toEqual(before);
});

test("partial synchronization identifies completed effects when the local launcher was edited #test-505", async () => {
	const fx = configured();
	fx.files.set("/repo/.git/beeswax/cli", "echo custom\n");
	expect(await runCli(["sync", "--json"], fx.deps)).toBe(failure);
	expect(JSON.parse(fx.output.join(""))).toMatchObject({
		reason: "migration_required",
		nextCommand: "beeswax migrate hooks",
		completed: ["hook_sections"],
	});
	expect(fx.files.get("/repo/.git/beeswax/cli")).toBe("echo custom\n");
	expect(fx.errors).toEqual([]);
});

test("release pin refresh changes portable metadata without installing machine integration #test-504", async () => {
	const fx = configured();
	const path = "/repo/.hive/beeswax/meta/lock.json";
	const lock = lockSchema.parse(JSON.parse(fx.files.get(path) ?? ""));
	fx.files.set(path, JSON.stringify({ ...lock, beeswaxVersion: "0.0.1" }));
	expect(await runCli(["lock", "--json"], fx.deps)).toBe(success);
	expect(JSON.parse(fx.output.join(""))).toMatchObject({ ok: true, kind: "project_locked" });
	expect(JSON.parse(fx.files.get(path) ?? "").beeswaxVersion).toBe(version);
	expect([...fx.files.keys()]).toEqual([...template.files.keys()]);
	expect(fx.commands).toEqual([["git", "rev-parse", "--show-toplevel"]]);
});

test.each([
	{ command: "update", identity: "skills" },
	{ command: "update", identity: "hooks" },
	{ command: "lock", identity: "skills" },
	{ command: "lock", identity: "hooks" },
])(
	"$command refuses an unknown $identity identity before writes #test-457",
	async ({ command, identity }) => {
		const fx = withUnknownIdentity(identity);
		const before = new Map(fx.files);
		expect(await runCli([command, "--json"], fx.deps)).toBe(failure);
		expect(JSON.parse(fx.output.join(""))).toMatchObject({
			reason: "migration_required",
			nextCommand: "beeswax migrate setup",
			requiresUser: true,
		});
		expect(fx.files).toEqual(before);
	},
);

function withUnknownIdentity(identity: string) {
	const fx = configured();
	const path = "/repo/.hive/beeswax/meta/lock.json";
	const lock = lockSchema.parse(JSON.parse(fx.files.get(path) ?? ""));
	if (identity === "skills") {
		lock.skills = ["unknown-required-skill"];
	} else {
		lock.hooks[".husky/pre-commit"] = "unknown-generation";
	}
	fx.files.set(path, JSON.stringify(lock));
	return fx;
}
