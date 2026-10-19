import { expect, test } from "bun:test";
import { installMergeDriver, shellQuote } from "../../src/hooks.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Disposable native adapter contract fixture.
import { mkdtemp, rm } from "node:fs/promises";
import { BeeswaxError } from "../../src/errors.ts";
import { bootstrapHooks } from "../../src/husky.ts";
import { createLiveDependencies } from "../../src/live.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Fixture paths.
import { join } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Temporary root.
import { tmpdir } from "node:os";

// eslint-disable-next-line max-statements -- Verify Husky bootstrap bytes once against the real package.
test("Beeswax accepts the standard Husky bootstrap and preserves application hooks", async () => {
	const root = await mkdtemp(join(tmpdir(), "beeswax husky "));
	const io = createLiveDependencies();
	try {
		await io.command(["git", "init"], root);
		const module = JSON.stringify(import.meta.resolve("husky"));
		await io.command(
			[
				"bun",
				"-e",
				`import husky from ${module}; const result=husky(); if(result) throw new Error(result);`,
			],
			root,
		);
		await io.write(join(root, ".husky/pre-push"), "echo application policy\n");
		const configuration = await io.read(join(root, ".git/config"));
		await io.write(
			join(root, ".git/config"),
			`${configuration}\n# user section\n[alias]\n\tco = checkout # preserve\n`,
		);
		const wrapper = await io.read(join(root, ".husky/_/pre-commit"));
		await bootstrapHooks(root, "husky", io);
		await bootstrapHooks(root, "husky", io);
		expect(await io.read(join(root, ".husky/_/LICENSE"))).toBe(
			await Bun.file(new URL("../../assets/HUSKY-LICENSE", import.meta.url)).text(),
		);
		const wrappers = await Promise.all(
			[
				"pre-commit",
				"pre-merge-commit",
				"prepare-commit-msg",
				"commit-msg",
				"post-commit",
				"applypatch-msg",
				"pre-applypatch",
				"post-applypatch",
				"pre-rebase",
				"post-rewrite",
				"post-checkout",
				"post-merge",
				"pre-push",
				"pre-auto-gc",
			].map((name) => io.read(join(root, ".husky/_", name))),
		);
		expect(wrappers.every((contents) => contents === wrapper)).toBe(true);
		expect(await io.read(join(root, ".husky/_/h"))).toBe(
			await Bun.file(new URL("../../assets/husky.sh", import.meta.url)).text(),
		);
		expect(await io.command(["git", "config", "--get", "alias.co"], root)).toBe("checkout");
		expect(await io.read(join(root, ".git/config"))).toContain(
			"# user section\n[alias]\n\tco = checkout # preserve\n",
		);
		expect(await io.read(join(root, ".git/config"))).toContain("# beeswax:begin hooks-path v1");
		expect(await io.read(join(root, ".husky/pre-push"))).toBe("echo application policy\n");
		expect(await io.command(["git", "config", "--get", "core.hooksPath"], root)).toBe(".husky/_");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

// eslint-disable-next-line max-statements -- Verify the common-config and linked-checkout boundary together.
test("merge fences retain Git semantics and one common receipt across linked checkouts", async () => {
	const root = await mkdtemp(join(tmpdir(), "beeswax merge "));
	const io = createLiveDependencies();
	const executable = String.raw`/tools with spaces/#semi;quote'and\beeswax`;
	try {
		await io.command(["git", "init"], root);
		const configuration = await io.read(join(root, ".git/config"));
		const user = `${configuration}\n# user bytes\n[alias]\n\tco = checkout # preserve\n`;
		await io.write(join(root, ".git/config"), user);
		const prior = {
			"merge.hive-beads.name": "Hive Beads JSONL merge driver",
			"merge.hive-beads.driver": `'/old/beeswax' git merge "%O" "%A" "%B"`,
			"merge.hive-beads.recursive": "hive-beads",
		};
		await io.command(
			["git", "config", "--local", "merge.hive-beads.name", prior["merge.hive-beads.name"]],
			root,
		);
		await io.command(
			["git", "config", "--local", "merge.hive-beads.driver", prior["merge.hive-beads.driver"]],
			root,
		);
		await io.command(
			[
				"git",
				"config",
				"--local",
				"merge.hive-beads.recursive",
				prior["merge.hive-beads.recursive"],
			],
			root,
		);
		await io.write(
			join(root, ".git/beeswax/merge-driver.local.json"),
			JSON.stringify({
				format: 1,
				revision: 1,
				generator: "merge-driver",
				beeswaxVersion: "0.6.0",
				config: prior,
				attribute: ".beads/issues.jsonl text eol=lf merge=hive-beads",
			}),
		);
		await io.write(
			join(root, ".gitattributes"),
			"# user attributes\n*.png binary\n\n.beads/issues.jsonl text eol=lf merge=hive-beads\n",
		);
		await installMergeDriver(root, executable, io);
		expect(await io.command(["git", "config", "--get", "merge.hive-beads.driver"], root)).toBe(
			`${shellQuote(executable)} system git merge "%O" "%A" "%B"`,
		);
		const generated = await io.read(join(root, ".git/config"));
		expect(generated.startsWith(user)).toBe(true);
		expect(await io.command(["git", "config", "--get", "alias.co"], root)).toBe("checkout");
		await installMergeDriver(root, executable, {
			...io,
			write: () => Promise.reject(new Error("Repeated materialization wrote a file")),
		});
		await io.command(
			[
				"git",
				"-c",
				"core.hooksPath=/dev/null",
				"-c",
				"user.name=Test",
				"-c",
				"user.email=test@example.test",
				"commit",
				"--allow-empty",
				"-m",
				"fixture",
			],
			root,
		);
		const linked = join(root, "linked");
		await io.command(["git", "worktree", "add", "--detach", linked], root);
		await installMergeDriver(linked, "/new/beeswax", io);
		expect(await io.command(["git", "config", "--get", "merge.hive-beads.driver"], root)).toBe(
			`'/new/beeswax' system git merge "%O" "%A" "%B"`,
		);
		expect(await io.read(join(root, ".git/beeswax/merge-driver.local.json"))).toContain(
			"/new/beeswax",
		);
		expect(await io.exists(join(root, ".hive/beeswax/meta/merge-driver.local.json"))).toBe(false);
		await io.command(["git", "config", "--add", "merge.hive-beads.recursive", "custom"], linked);
		const before = await io.read(join(root, ".git/config"));
		await expect(installMergeDriver(linked, "/other/beeswax", io)).rejects.toBeInstanceOf(
			BeeswaxError,
		);
		expect(await io.read(join(root, ".git/config"))).toBe(before);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
