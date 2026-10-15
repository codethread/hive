/* eslint-disable no-await-in-loop -- Release writes and builds are deliberately sequential. */
import type { PackageHistory, Platform, ReleaseManifest } from "./release.ts";
import {
	archiveName,
	artifacts,
	checkNextVersion,
	executables,
	homebrewFormula,
	previousRelease,
	releaseManifestSchema,
	releaseNotes,
	versionSchema,
} from "./release.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Release artifact filesystem boundary.
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve source snapshots and artifact paths.
import { join, resolve } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Build immutable Git snapshots in disposable directories.
import { tmpdir } from "node:os";
import { z } from "zod";

const FIRST = 0;
const INDENT = 2;
const MINIMUM_LENGTH = 1;
const packageSchema = z.looseObject({
	name: z.string().min(MINIMUM_LENGTH),
	version: versionSchema,
});
const EXECUTABLE_MODE = 0o755;
const SUCCESS = 0;

export interface ReleaseServices {
	/** Bump every manifest and write tag-derived notes, leaving a reviewable worktree diff. */
	prepare: (
		version: string,
	) => Promise<{ version: string; previous: string | undefined; notes: string }>;
	/** Build selected platforms from a single immutable Git revision, never the working files. */
	build: (revision: string, output: string, targets: Platform[]) => Promise<ReleaseManifest>;
	/** Verify on-disk archive digests before writing a complete Homebrew formula. */
	formula: (
		directory: string,
		repository: string,
		output: string,
	) => Promise<{ formula: string; version: string }>;
}

/** Live Git, Bun and filesystem adapter; publication is owned by the explicit Release workflow. */
export function createReleaseServices(root: string): ReleaseServices {
	return {
		prepare: (version) => prepare(root, version),
		build: (revision, output, targets) =>
			build(root, { ref: revision, output: resolve(output), targets }),
		formula: (directory, repository, output) =>
			formula(resolve(directory), repository, resolve(output)),
	};
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
	for (const pkg of packages) {
		const file = join(root, pkg.directory, "package.json");
		const manifest = packageSchema.parse(JSON.parse(await readFile(file, "utf8")));
		await writeFile(file, `${JSON.stringify({ ...manifest, version }, undefined, "\t")}\n`);
	}
	await mkdir(join(root, "releases"), { recursive: true });
	await writeFile(join(root, notes), releaseNotes(version, previous, packages));
	await run(root, ["bun", "install", "--lockfile-only", "--ignore-scripts"]);
	if (await Bun.file(join(root, ".hive/beeswax/config.toml")).exists()) {
		await run(root, ["bun", "run", "beeswax", "lock"]);
	}
	return { version, previous, notes };
}

// eslint-disable-next-line max-statements -- Read every package against the same Git range.
async function packageHistory(
	root: string,
	previous: string | undefined,
): Promise<PackageHistory[]> {
	const files = [
		"package.json",
		...(await Array.fromAsync(new Bun.Glob("lib/*/package.json").scan(root))),
	];
	const packages: PackageHistory[] = [];
	for (const file of files.toSorted()) {
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
		const history = await git(root, ["log", "--format=%h %s", range, "--", path]);
		packages.push({
			directory: path,
			name: pkg.name,
			version: pkg.version,
			commits: history.split("\n").filter(Boolean),
		});
	}
	return packages;
}

// Keep snapshot preparation, sequential compilation and cleanup in one boundary.
// eslint-disable-next-line max-statements
async function build(
	root: string,
	{ ref, output, targets }: { ref: string; output: string; targets: Platform[] },
): Promise<ReleaseManifest> {
	const revision = await git(root, ["rev-parse", "--verify", `${ref}^{commit}`]);
	// Refuse reuse: a partial build remains inspectable and cannot masquerade as a fresh release.
	await mkdir(output, { recursive: false });
	const temporary = await mkdtemp(join(tmpdir(), "hive-release-"));
	try {
		const source = join(temporary, "source");
		await mkdir(source);
		await git(root, [
			"archive",
			"--format=tar",
			`--output=${join(temporary, "source.tar")}`,
			revision,
		]);
		await run(source, ["tar", "-xf", join(temporary, "source.tar")]);
		const manifests = await readPackages(source);
		const { version } = manifests[FIRST]!;
		if (manifests.some((pkg) => pkg.version !== version)) {
			throw new Error("Package versions are not in lockstep.");
		}
		await run(source, ["bun", "install", "--frozen-lockfile", "--ignore-scripts"]);
		const manifest: ReleaseManifest = { version, revision, bunVersion: Bun.version, archives: [] };
		for (const platform of targets) {
			const stage = join(temporary, platform);
			await mkdir(join(stage, "bin"), { recursive: true });
			for (const [pkg, names] of Object.entries(artifacts)) {
				await run(join(source, "lib", pkg), ["bun", "run", "build"], {
					HIVE_BUILD_TARGET: `bun-${platform}`,
				});
				for (const name of names) {
					const destination = join(stage, "bin", name);
					await copyFile(join(source, "lib", pkg, "dist", name), destination);
					await chmod(destination, EXECUTABLE_MODE);
				}
			}
			await writeFile(
				join(stage, "release.json"),
				JSON.stringify({ version, revision, platform, bunVersion: Bun.version, executables }),
			);
			const file = archiveName(version, platform);
			await run(stage, ["tar", "-czf", join(output, file), "bin", "release.json"], {
				COPYFILE_DISABLE: "1",
			});
			manifest.archives.push({ platform, file, sha256: await sha256(join(output, file)) });
		}
		await writeFile(
			join(output, "manifest.json"),
			`${JSON.stringify(manifest, undefined, INDENT)}\n`,
		);
		await writeFile(
			join(output, "SHA256SUMS"),
			manifest.archives.map((item) => `${item.sha256}  ${item.file}\n`).join(""),
		);
		return manifest;
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}

async function readPackages(root: string) {
	const files = [
		"package.json",
		...(await Array.fromAsync(new Bun.Glob("lib/*/package.json").scan(root))),
	];
	return Promise.all(files.map(async (file) => await readPackage(join(root, file))));
}

async function formula(directory: string, repository: string, output: string) {
	const content = await readFile(join(directory, "manifest.json"), "utf8");
	const manifest = releaseManifestSchema.parse(JSON.parse(content));
	for (const archive of manifest.archives) {
		if ((await sha256(join(directory, archive.file))) !== archive.sha256) {
			throw new Error(`Checksum mismatch: ${archive.file}`);
		}
	}
	const ruby = homebrewFormula(manifest, repository);
	await writeFile(output, ruby);
	return { formula: output, version: manifest.version };
}

async function requireClean(root: string): Promise<void> {
	if (await git(root, ["status", "--porcelain"])) {
		throw new Error("Release preparation requires a clean worktree.");
	}
}

async function sha256(path: string): Promise<string> {
	return new Bun.CryptoHasher("sha256").update(await readFile(path)).digest("hex");
}

function git(root: string, args: string[]): Promise<string> {
	return run(root, ["git", ...args]);
}

async function run(
	cwd: string,
	command: string[],
	environment: Record<string, string> = {},
): Promise<string> {
	const child = Bun.spawn(command, {
		cwd,
		env: { ...process.env, ...environment },
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
