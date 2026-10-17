/* eslint-disable no-await-in-loop -- Release preparation writes manifests sequentially. */
import { checkNextVersion, previousRelease, releaseNotes, versionSchema } from "./release.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Release preparation filesystem boundary.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { PackageHistory } from "./release.ts";
import { changelogHistorySchema } from "@hive/shared/changelog";
import { generateChangelogs } from "./release-changelog.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve release source paths.
import { join } from "node:path";
import { z } from "zod";

const FIRST = 0;
const MINIMUM_LENGTH = 1;
const packageSchema = z.looseObject({
	name: z.string().min(MINIMUM_LENGTH),
	version: versionSchema,
});
const SUCCESS = 0;

export interface ReleaseServices {
	/** Bump every manifest and write tag-derived notes, leaving a reviewable worktree diff. */
	prepare: (
		version: string,
	) => Promise<{ version: string; previous: string | undefined; notes: string }>;
}

/** Live Git, Bun and filesystem adapter for the reviewable release preparation diff. */
export function createReleaseServices(root: string): ReleaseServices {
	return { prepare: (version) => prepare(root, version) };
}

// --- Live boundary ---

// eslint-disable-next-line max-statements -- Keep manifest and changelog preparation together.
async function prepare(root: string, version: string) {
	await requireClean(root);
	const tags = await git(root, ["tag", "--merged", "HEAD", "--list", "v*"]);
	const previous = previousRelease(tags.split("\n"));
	const packages = await packageHistory(root, previous);
	checkNextVersion(version, packages, previous);
	const notes = `releases/v${version}.md`;
	const histories = generateChangelogs(
		version,
		packages.filter((pkg) => pkg.directory === ".").flatMap((pkg) => pkg.commits),
	);
	for (const pkg of packages) {
		const file = join(root, pkg.directory, "package.json");
		const manifest = packageSchema.parse(JSON.parse(await readFile(file, "utf8")));
		await writeFile(file, `${JSON.stringify({ ...manifest, version }, undefined, "\t")}\n`);
	}
	for (const { file, release } of histories) {
		const historyFile = join(root, file);
		const history = changelogHistorySchema.parse(JSON.parse(await readFile(historyFile, "utf8")));
		await writeFile(historyFile, `${JSON.stringify([release, ...history], undefined, "\t")}\n`);
	}
	await mkdir(join(root, "releases"), { recursive: true });
	await writeFile(join(root, notes), releaseNotes(version, previous, packages));
	await run(root, ["bun", "install", "--lockfile-only", "--ignore-scripts"]);
	if (await Bun.file(join(root, ".hive/beeswax/config.toml")).exists()) {
		await run(root, ["bun", "run", "beeswax", "lock"]);
	}
	return { version, previous, notes };
}

async function packageHistory(
	root: string,
	previous: string | undefined,
): Promise<PackageHistory[]> {
	const files = [
		"package.json",
		...(await Array.fromAsync(new Bun.Glob("lib/*/package.json").scan(root))),
	];
	return Promise.all(
		// eslint-disable-next-line max-statements -- Read every package against the same Git range.
		files.toSorted().map(async (file) => {
			const pkg = await readPackage(join(root, file));
			let path = ".";
			if (file !== "package.json") {
				path = file.slice(FIRST, -"/package.json".length);
			}
			// Root history covers repository-wide changes; workspace histories use their own paths.

			let range = "HEAD";
			if (previous !== undefined) {
				range = `${previous}..HEAD`;
			}
			const args = ["log", "--format=%H%x1f%B%x00", range];
			if (path !== ".") {
				args.push("--", path);
			}
			const history = await git(root, args);
			return {
				directory: path,
				name: pkg.name,
				version: pkg.version,
				commits: history
					.split("\0")
					.filter((record) => record.trim() !== "")
					.map((record) => {
						const separator = record.indexOf("\u001F");
						return {
							hash: z
								.string()
								.regex(/^[\da-f]{40}$/u)
								.parse(record.slice(FIRST, separator).trim()),
							message: z
								.string()
								.min(MINIMUM_LENGTH)
								.parse(record.slice(separator + MINIMUM_LENGTH).trim()),
						};
					}),
			};
		}),
	);
}

async function requireClean(root: string): Promise<void> {
	if (await git(root, ["status", "--porcelain"])) {
		throw new Error("Release preparation requires a clean worktree.");
	}
}

function git(root: string, args: string[]): Promise<string> {
	return run(root, ["git", ...args]);
}

async function run(cwd: string, command: string[]): Promise<string> {
	const child = Bun.spawn(command, {
		cwd,
		env: process.env,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (code !== SUCCESS) {
		throw new Error(`${command.join(" ")} failed (${code}): ${stderr}\n${stdout}`);
	}
	return stdout.trim();
}

async function readPackage(file: string) {
	const content = await readFile(file, "utf8");
	return packageSchema.parse(JSON.parse(content));
}
