// eslint-disable-next-line import/no-nodejs-modules -- Install local artifacts without following destination symlinks.
import { chmod, copyFile, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
// eslint-disable-next-line import/no-nodejs-modules -- Choose the user's local bin directory by default.
import { homedir } from "node:os";
// eslint-disable-next-line import/no-nodejs-modules -- Parse this repository-maintenance CLI's boundary.
import { parseArgs } from "node:util";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve package artifacts and installation paths.
import { resolve } from "node:path";
import { z } from "zod";

const EXECUTABLE_MODE = 0o755;
const MINIMUM_ARTIFACTS = 1;
const artifactNamesSchema = z.array(z.string().regex(/^[a-z][\da-z-]*$/u)).min(MINIMUM_ARTIFACTS);

/** Copy built executables, replacing destination symlinks rather than their targets. */
// Keep staging, replacement and cleanup together at the installation boundary.
// eslint-disable-next-line max-statements
export async function installArtifacts(
	sourceDirectory: string,
	destination: string,
	names: readonly string[],
): Promise<string[]> {
	await mkdir(destination, { recursive: true });
	const temporary = await mkdtemp(resolve(destination, ".hive-install-"));
	try {
		/* eslint-disable no-await-in-loop -- Finish staging before replacement; settle each operation before cleanup. */
		for (const name of names) {
			const staged = resolve(temporary, name);
			await copyFile(resolve(sourceDirectory, name), staged);
			await chmod(staged, EXECUTABLE_MODE);
		}
		for (const name of names) {
			await rename(resolve(temporary, name), resolve(destination, name));
		}
		/* eslint-enable no-await-in-loop */
		return names.map((name) => resolve(destination, name));
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}

// --- CLI boundary ---

async function main(): Promise<void> {
	try {
		const { positionals, values } = parseArgs({
			allowPositionals: true,
			options: {
				directory: { default: resolve(homedir(), ".local", "bin"), type: "string" },
				help: { short: "h", type: "boolean" },
			},
		});
		if (values.help) {
			console.log(
				"Usage: install:bin <artifact...> [--directory <path>]\nInstall named " +
					"executables from this package's dist/ directory. Default " +
					"destination: ~/.local/bin. Run build first.",
			);
			return;
		}
		const names = [...new Set(artifactNamesSchema.parse(positionals))];
		const artifacts = await installArtifacts(resolve("dist"), resolve(values.directory), names);
		console.log(JSON.stringify({ artifacts, kind: "artifacts_installed", ok: true }));
	} catch (error) {
		console.log(
			JSON.stringify({
				kind: "error",
				message: String(error),
				ok: false,
				reason: "artifact_install_failed",
			}),
		);
		process.exitCode = 1;
	}
}

if (import.meta.main) {
	await main();
}
