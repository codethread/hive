import { expect, test } from "bun:test";
// eslint-disable-next-line import/no-nodejs-modules -- Disposable release preparation fixtures.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createReleaseServices } from "../../src/release-native.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Explicit fixture paths.
import { join } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Test fixture root.
import { tmpdir } from "node:os";

const SUCCESS = 0;
const INDENT = 2;
const packages = ["beeswax", "honeycomb", "colony", "busybee", "qlock", "hive-ui", "waggle"];

// eslint-disable-next-line max-statements -- Verify the observable version/history preparation boundary together.
test("release preparation updates every package from tag history without running setup hooks", async () => {
	const root = await fixture();
	try {
		await git(root, ["tag", "v0.5.0"]);
		await writeFile(join(root, "lib/colony/change.txt"), "new package change\n");
		await git(root, ["add", "."]);
		await git(root, ["commit", "-m", "feat(colony): add marker"]);
		const result = await createReleaseServices(root).prepare("0.6.0");
		expect(result.previous).toBe("v0.5.0");
		for (const path of ["package.json", ...packages.map((pkg) => `lib/${pkg}/package.json`)]) {
			// eslint-disable-next-line no-await-in-loop -- Inspect each manifest written by preparation.
			expect(await Bun.file(join(root, path)).json()).toMatchObject({ version: "0.6.0" });
		}
		const notes = await readFile(join(root, result.notes), "utf8");
		expect(notes).toContain("feat(colony): add marker");
		expect(notes).toContain("## @hive/qlock\n\nNo change.");
		expect(await Bun.file(join(root, "HOOK_RAN")).exists()).toBe(false);
		expect(await readFile(join(root, ".workflows/example/busybee.toml"), "utf8")).toBe(
			'version = "1.2.3"\n',
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

// --- Native fixture boundary ---

// eslint-disable-next-line max-statements -- A minimal real workspace exercises version and release-note preparation.
async function fixture(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "hive-release-contract-"));
	await writeFile(
		join(root, "package.json"),
		JSON.stringify(
			{
				name: "hive",
				version: "0.5.0",
				private: true,
				workspaces: ["lib/*"],
				scripts: { prepare: "touch HOOK_RAN" },
			},
			undefined,
			INDENT,
		),
	);
	for (const pkg of packages) {
		// eslint-disable-next-line no-await-in-loop -- Fixture writes are sequential and small.
		await mkdir(join(root, "lib", pkg), { recursive: true });
		// eslint-disable-next-line no-await-in-loop -- Keep each package manifest beside its directory creation.
		await writeFile(
			join(root, "lib", pkg, "package.json"),
			JSON.stringify(
				{
					name: `@hive/${pkg}`,
					version: "0.5.0",
					private: true,
				},
				undefined,
				INDENT,
			),
		);
	}
	await mkdir(join(root, ".workflows/example"), { recursive: true });
	await writeFile(join(root, ".workflows/example/busybee.toml"), 'version = "1.2.3"\n');
	await command(root, ["bun", "install", "--lockfile-only", "--ignore-scripts"]);
	await git(root, ["init", "--initial-branch=main"]);
	await git(root, ["add", "."]);
	await git(root, ["commit", "-m", "fixture: initial suite"]);
	return root;
}

function git(root: string, args: string[]): Promise<string> {
	return command(root, ["git", ...args]);
}

async function command(root: string, args: string[]): Promise<string> {
	const child = Bun.spawn(args, {
		cwd: root,
		env: {
			...process.env,
			GIT_CONFIG_GLOBAL: "/dev/null",
			GIT_CONFIG_NOSYSTEM: "1",
			GIT_AUTHOR_NAME: "Test",
			GIT_AUTHOR_EMAIL: "test@example.test",
			GIT_COMMITTER_NAME: "Test",
			GIT_COMMITTER_EMAIL: "test@example.test",
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const [out, err, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (code !== SUCCESS) {
		throw new Error(`${args.join(" ")}: ${err}\n${out}`);
	}
	return out;
}
