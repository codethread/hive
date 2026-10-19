import { defaultProjectConfig, digestConfig, writeProjectConfig } from "../../src/config.ts";
import { expect, test } from "bun:test";
import { piPayloadPath, renderPiPayload } from "../../src/pi-onboarding.ts";
import { applyOnboarding } from "../../src/onboarding.ts";
import { fixture } from "../support.ts";
import { runCli } from "../../src/cli.ts";
import { version } from "../../package.json";
import { writeProjectLock } from "../../src/project.ts";

const SUCCESS = 0;
const root = "/repo";
const config = {
	...defaultProjectConfig("none"),
	onboarding: { harnesses: ["pi" as const], include: [], exclude: [] },
};
const template = fixture();
await writeProjectConfig(root, config, template.deps);
await writeProjectLock(root, template.deps);
await applyOnboarding(root, config, template.deps);

function configured() {
	const fx = fixture();
	for (const [path, contents] of template.files) {
		fx.files.set(path, contents);
	}
	return fx;
}

test("Pi runtime verification is read-only and succeeds only for the accepted prepared payload", async () => {
	const fx = configured();
	const before = new Map(fx.files);
	expect(await runCli(["system", "pi-check", "--repo", root, "--json"], fx.deps)).toBe(SUCCESS);
	expect(JSON.parse(fx.output.join(""))).toMatchObject({
		ok: true,
		kind: "pi_payload_valid",
		payloadDigest: expect.any(String),
	});
	expect(fx.files).toEqual(before);
});

test.each([
	{ path: `${root}/${piPayloadPath}`, contents: "" },
	{ path: `${root}/${piPayloadPath}`, contents: "// stale payload\n" },
	{
		path: `${root}/.hive/beeswax/config.toml`,
		contents: [
			'bootstrap.hooks = "git"',
			'hooks.pre_commit = ".git/hooks/pre-commit"',
			'hooks.pre_merge_commit = ".git/hooks/pre-merge-commit"',
			"[onboarding]",
			'harnesses=["pi"]',
			"include=[]",
			"exclude=[]",
			"",
		].join("\n"),
	},
	{
		path: `${root}/.hive/beeswax/lock.json`,
		contents: template.files
			.get(`${root}/.hive/beeswax/lock.json`)!
			.replace(`"beeswaxVersion": "${version}"`, '"beeswaxVersion": "0.0.0"'),
	},
])("Pi verification fails visibly without repairs for $path", async ({ path, contents }) => {
	const fx = configured();
	fx.files.set(path, contents);
	const before = new Map(fx.files);
	expect(await runCli(["system", "pi-check", "--json"], fx.deps)).not.toBe(SUCCESS);
	expect(JSON.parse(fx.output.join(""))).toMatchObject({
		ok: false,
		nextCommand: expect.any(String),
	});
	expect(fx.files).toEqual(before);
});

test("ordinary sync regenerates absent payload without changing the accepted lock", async () => {
	const fx = configured();
	fx.files.delete(`${root}/${piPayloadPath}`);
	const lock = fx.files.get(`${root}/.hive/beeswax/lock.json`);
	expect(await runCli(["sync", "--json"], fx.deps)).toBe(SUCCESS);
	expect(fx.files.get(`${root}/${piPayloadPath}`)).toBe(
		template.files.get(`${root}/${piPayloadPath}`),
	);
	expect(fx.files.get(`${root}/.hive/beeswax/lock.json`)).toBe(lock);
});

test.each([
	{ command: "sync", field: "beeswaxVersion", value: "0.0.0" },
	{ command: "sync", field: "configDigest", value: "changed" },
	{ command: "update", field: "beeswaxVersion", value: "0.0.0" },
	{ command: "update", field: "configDigest", value: "changed" },
])(
	"$command preserves an edited payload identity $field",
	// eslint-disable-next-line max-statements -- Prepare, alter metadata and verify refusal through one public command.
	async ({ command, field, value }) => {
		const fx = configured();
		expect(await runCli(["sync", "--json"], fx.deps)).toBe(SUCCESS);
		fx.output.length = SUCCESS;
		const path = `${root}/${piPayloadPath}`;
		const payload = fx.files.get(path)!;
		const newline = payload.indexOf("\n");
		const prefix = "// beeswax:pi-payload ";
		const identity = JSON.parse(payload.slice(prefix.length, newline));
		identity[field] = value;
		fx.files.set(path, `${prefix}${JSON.stringify(identity)}${payload.slice(newline)}`);
		const before = new Map(fx.files);
		expect(await runCli([command, "--json"], fx.deps)).not.toBe(SUCCESS);
		expect(JSON.parse(fx.output.join(""))).toMatchObject({ reason: "pi_prerequisite" });
		expect(fx.files).toEqual(before);
	},
);

test("sync regenerates a valid previous-config payload without advancing acceptance", async () => {
	const fx = configured();
	const previous = { ...config, onboarding: { ...config.onboarding, include: ["colony"] } };
	const path = `${root}/${piPayloadPath}`;
	fx.files.set(path, renderPiPayload(previous.onboarding, digestConfig(previous)));
	const lock = fx.files.get(`${root}/.hive/beeswax/lock.json`);
	expect(await runCli(["sync", "--json"], fx.deps)).toBe(SUCCESS);
	expect(fx.files.get(path)).toBe(template.files.get(path));
	expect(fx.files.get(`${root}/.hive/beeswax/lock.json`)).toBe(lock);
});
