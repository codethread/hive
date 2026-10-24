import { expect, test } from "bun:test";
// eslint-disable-next-line import/no-nodejs-modules -- Own a disposable configuration tree.
import { mkdir, mkdtemp, rm } from "node:fs/promises";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve fixture paths.
import { join } from "node:path";
import { loadBeesConfig } from "./config.ts";
import { loadPolicy } from "./policy.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Isolated OS temporary fixture root.
import { tmpdir } from "node:os";

const POLICY = 'owner="ct"\nhumans=["ct"]\n[formulas]\n';

// eslint-disable-next-line max-statements -- Keep the bounded disposable filesystem scenario and cleanup together.
test("filesystem discovery composes ordered kind sources and rejects invalid configuration #test-312", async () => {
	const root = await mkdtemp(join(tmpdir(), "bee-config-"));
	const directory = join(root, ".hive", "bees");
	try {
		await Bun.write(join(root, ".hive", "bees.toml"), POLICY);
		const empty = await loadBeesConfig(root);
		expect(empty.config.kinds).toEqual({});
		await Bun.write(directory, "not a directory");
		await expect(loadBeesConfig(root)).rejects.toBeInstanceOf(Error);
		await rm(directory);
		await mkdir(join(directory, "arbitrary"), { recursive: true });
		await Bun.write(
			join(directory, "arbitrary", "bee.toml"),
			'name="worker"\ndescription="Implement work."\nharness="codex"\nmodel="file-model"\neffort="low"\n',
		);
		const withoutPrompts = await loadBeesConfig(root);
		expect(withoutPrompts.config.kinds["worker"]).toMatchObject({
			prompt: "",
			system_prompt: "",
		});
		await Bun.write(join(directory, "arbitrary", "prompt.md"), "File instructions\n");
		await Bun.write(join(directory, "README.md"), "Not a definition");
		await Bun.write(
			join(directory, "arbitrary", "nested", "bee.toml"),
			"Invalid nested definition is not discovered",
		);
		const policy = await loadPolicy({ beadsDb: join(root, "unused.db"), root });
		expect(policy.kinds["worker"]).toMatchObject({
			model: "file-model",
			prompt: "File instructions\n",
		});
		const canonical = join(root, ".hive", "bees.toml");
		const central =
			`${POLICY}[kinds.reviewer]\ndescription="Central reviewer."\nharness="codex"\n` +
			`model="central"\neffort="low"\nprompt="Central direction"\n`;
		await Bun.write(canonical, central);
		// Prefix folders distinguish folder-name sorting from sorting complete definition paths.
		await Promise.all(
			["a", "a-"].flatMap((folder) => [
				Bun.write(
					join(directory, folder, "bee.toml"),
					'name="reviewer"\ndescription="Folder reviewer."\nharness="codex"\n' +
						'model="folder"\neffort="low"\n',
				),
				Bun.write(join(directory, folder, "prompt.md"), "Folder direction"),
				Bun.write(join(directory, folder, "system_prompt.md"), "Folder role"),
			]),
		);
		const overridden = await loadBeesConfig(root);
		expect(overridden.config.kinds["reviewer"]).toMatchObject({
			model: "central",
			prompt: "Central direction",
			system_prompt: "",
		});
		expect(overridden.warnings).toEqual([
			`${canonical} overrides bee kind reviewer from ${join(directory, "a", "bee.toml")}`,
			`${canonical} overrides bee kind reviewer from ${join(directory, "a-", "bee.toml")}`,
		]);
		await Bun.write(canonical, `${central}[formulas.broken]\nexecutable="{{#if"\nargv=[]\n`);
		await expect(loadBeesConfig(root)).rejects.toBeInstanceOf(Error);
		await rm(join(root, ".hive", "bees.toml"));
		await Bun.write(join(root, "bees.toml"), POLICY);
		await expect(loadBeesConfig(root)).rejects.toBeInstanceOf(Error);
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});
