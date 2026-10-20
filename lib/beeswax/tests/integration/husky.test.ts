import { expect, test } from "bun:test";
// eslint-disable-next-line import/no-nodejs-modules -- Disposable native adapter contract fixture.
import { mkdtemp, rm } from "node:fs/promises";
import { bootstrapHooks } from "../../src/husky.ts";
import { createLiveDependencies } from "../../src/live.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Fixture paths.
import { join } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Temporary root.
import { tmpdir } from "node:os";

// eslint-disable-next-line max-statements -- Verify Husky bootstrap bytes once against the real package.
test("Beeswax accepts the standard Husky bootstrap and preserves application hooks #test-296", async () => {
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
		const wrapper = await io.read(join(root, ".husky/_/pre-commit"));
		await bootstrapHooks(root, "husky", io);
		await bootstrapHooks(root, "husky", io);
		expect(await io.read(join(root, ".husky/_/LICENSE"))).toBe(
			await Bun.file(new URL("../../assets/HUSKY-LICENSE", import.meta.url)).text(),
		);
		expect(await io.read(join(root, ".husky/_/pre-commit"))).toBe(wrapper);
		expect(await io.read(join(root, ".husky/pre-push"))).toBe("echo application policy\n");
		expect(await io.command(["git", "config", "--get", "core.hooksPath"], root)).toBe(".husky/_");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
