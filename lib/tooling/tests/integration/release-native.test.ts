import { expect, test } from "bun:test";
// eslint-disable-next-line import/no-nodejs-modules -- Disposable release preparation fixtures.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { ChangelogRelease } from "@hive/shared/changelog";
import { changelogHistorySchema } from "@hive/shared/changelog";
import { createReleaseServices } from "../../src/release-native.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Explicit fixture paths.
import { join } from "node:path";
import { parseChangelogBlocks } from "../../src/release-changelog.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Test fixture root.
import { tmpdir } from "node:os";

const SUCCESS = 0;
const FIRST = 0;
const ONE = 1;
const INDENT = 2;
const reviewed: ChangelogRelease = {
	version: "0.5.0",
	changes: [
		{
			commit: "1111111111111111111111111111111111111111",
			summary: "Reviewed wording",
			body: "Reviewed Markdown **body**",
			breaking: [],
			adoption: [{ requirement: "optional", text: "Keep this authored action" }],
		},
	],
};
const beeReviewed = {
	...reviewed,
	changes: reviewed.changes.map((change) => ({ ...change, summary: "Bee-specific wording" })),
};
const packages = ["beeswax", "honeycomb", "colony", "busybee", "qlock", "hive-ui", "waggle"];

const blockMessage = [
	"feat: integrate tool changes",
	"",
	"~~~changelog v1",
	"feat(bee)!: select a named worker",
	"",
	"Use **named workers**.",
	"",
	"```sh",
	"bee spawn reviewer",
	"```",
	"",
	"    indented example",
	"~~~",
	"",
	"~~~changelog v1",
	"fix(colony): retain capacity",
	"",
	"BREAKING CHANGE: configure the new limit",
	"~~~",
].join("\n");

// eslint-disable-next-line max-statements -- Verify the observable version/history preparation boundary together.
test("release preparation updates every package from tag history without running setup hooks", async () => {
	const root = await fixture();
	try {
		await git(root, ["tag", "v0.5.0"]);
		await writeFile(join(root, "lib/colony/change.txt"), "new package change\n");
		await git(root, ["add", "."]);
		await git(root, [
			"commit",
			"-m",
			"feat(colony)!: add marker",
			"-m",
			"~~~changelog v1\nfeat(colony)!: add marker\n\nBREAKING CHANGE: use the new marker\n~~~",
		]);
		await writeFile(join(root, "shared-change.txt"), "root/shared-only change\n");
		await git(root, ["add", "."]);
		await git(root, [
			"commit",
			"-m",
			"fix: root contract",
			"-m",
			`${blockMessage}\n\n> ~~~changelog v1\n> fix(colony): archived entry\n> ~~~`,
		]);
		const beeCommit = await git(root, ["rev-parse", "HEAD"]);
		const result = await createReleaseServices(root).prepare("0.6.0");
		expect(result.previous).toBe("v0.5.0");
		for (const path of ["package.json", ...packages.map((pkg) => `lib/${pkg}/package.json`)]) {
			// eslint-disable-next-line no-await-in-loop -- Inspect each manifest written by preparation.
			expect(await Bun.file(join(root, path)).json()).toMatchObject({ version: "0.6.0" });
		}
		const notes = await readFile(join(root, result.notes), "utf8");
		expect(notes).toContain("feat(colony)!: add marker");
		const historyFile = join(root, "lib/colony/changelog.json");
		const history = changelogHistorySchema.parse(await Bun.file(historyFile).json());
		const sourceCommit = await git(root, ["rev-parse", "HEAD~1"]);
		const beeFile = join(root, "lib/colony/bee-changelog.json");
		const beeHistory = changelogHistorySchema.parse(await Bun.file(beeFile).json());
		expect(beeHistory.slice(ONE)).toEqual([beeReviewed]);
		expect(history.slice(ONE)).toEqual([reviewed]);
		expect(beeHistory[FIRST]!.changes[FIRST]!.commit).toBe(beeCommit.trim());
		expect(history[FIRST]!.changes.map((change) => change.commit)).toEqual([
			beeCommit.trim(),
			sourceCommit.trim(),
		]);
		expect({
			bee: beeHistory[FIRST]!.changes.map(({ summary, body, breaking, adoption }) => ({
				summary,
				body: body.split("\n"),
				breaking,
				adoption,
			})),
			colony: history[FIRST]!.changes.map(({ summary, body, breaking, adoption }) => ({
				summary,
				body: body.split("\n"),
				breaking,
				adoption,
			})),
		}).toMatchInlineSnapshot(`
		  {
		    "bee": [
		      {
		        "adoption": [],
		        "body": [
		          "Use **named workers**.",
		          "",
		          "\`\`\`sh",
		          "bee spawn reviewer",
		          "\`\`\`",
		          "",
		          "    indented example",
		        ],
		        "breaking": [
		          "select a named worker",
		        ],
		        "summary": "select a named worker",
		      },
		    ],
		    "colony": [
		      {
		        "adoption": [],
		        "body": [
		          "BREAKING CHANGE: configure the new limit",
		        ],
		        "breaking": [
		          "configure the new limit",
		        ],
		        "summary": "retain capacity",
		      },
		      {
		        "adoption": [],
		        "body": [
		          "BREAKING CHANGE: use the new marker",
		        ],
		        "breaking": [
		          "use the new marker",
		        ],
		        "summary": "add marker",
		      },
		    ],
		  }
		`);
		expect(notes).toContain("## @hive/qlock\n\nNo change.");
		expect(await Bun.file(join(root, "HOOK_RAN")).exists()).toBe(false);
		expect(await readFile(join(root, ".workflows/example/busybee.toml"), "utf8")).toBe(
			'version = "1.2.3"\n',
		);
		await git(root, ["add", "."]);
		await git(root, ["commit", "-m", "chore: prepare release"]);
		await git(root, ["tag", "v0.6.0"]);
		await createReleaseServices(root).prepare("0.7.0");
		expect(await Bun.file(historyFile).json()).toEqual([
			{ version: "0.7.0", changes: [] },
			...history,
		]);
		expect(await Bun.file(beeFile).json()).toEqual([
			{ version: "0.7.0", changes: [] },
			...beeHistory,
		]);
		await git(root, ["add", "."]);
		await git(root, ["commit", "-m", "chore: prepare next release"]);
		await git(root, ["tag", "v0.7.0"]);
		await git(root, [
			"commit",
			"--allow-empty",
			"-m",
			"fix: invalid declaration",
			"-m",
			"~~~changelog v2\nfix(bee): future\n~~~",
		]);
		await expect(createReleaseServices(root).prepare("0.8.0")).rejects.toThrow(Error);
		expect(await git(root, ["status", "--porcelain"])).toBe("");
		for (const declaration of [
			"~~~changelog v2\nfix(bee): future\n~~~",
			"~~~changelog\nfix(bee): missing version\n~~~",
			"~~~changelog v1 extra\nfix(bee): malformed version\n~~~",
			"~~~changelog v1\nnot a conventional header\n~~~",
			"~~~changelog v1\nfix: missing scope\n~~~",
			"~~~changelog v1\nfix(shared): unknown scope\n~~~",
			"~~~changelog v1\nfix(bee,colony): multiple scopes\n~~~",
			"~~~changelog v1\nfix(bee): unclosed",
			"~~~changelog v1\nfix(bee): indented closing fence\n    ~~~",
		]) {
			expect(() => parseChangelogBlocks({ hash: "invalid", message: declaration })).toThrow(Error);
		}
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
		await writeFile(join(root, "lib", pkg, "changelog.json"), JSON.stringify([reviewed]));
		if (pkg === "colony") {
			// eslint-disable-next-line no-await-in-loop -- Bee has an independently reviewed history in the same package.
			await writeFile(join(root, "lib", pkg, "bee-changelog.json"), JSON.stringify([beeReviewed]));
		}
		// eslint-disable-next-line no-await-in-loop -- Fixture package history is bundled beside each manifest.
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
