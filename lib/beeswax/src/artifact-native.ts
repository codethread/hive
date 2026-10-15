import { BeeswaxError, errorMessage } from "./errors.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Install local artifacts without following destination symlinks.
import { chmod, copyFile, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve package artifacts and installation paths.
import { resolve } from "node:path";

const EXECUTABLE_MODE = 0o755;

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
	const installed: string[] = [];
	try {
		/* eslint-disable no-await-in-loop -- Finish staging before replacement; settle each operation before cleanup. */
		for (const name of names) {
			const staged = resolve(temporary, name);
			await copyFile(resolve(sourceDirectory, name), staged);
			await chmod(staged, EXECUTABLE_MODE);
		}
		for (const name of names) {
			const target = resolve(destination, name);
			await rename(resolve(temporary, name), target);
			installed.push(target);
		}
		/* eslint-enable no-await-in-loop */
		return installed;
	} catch (error) {
		throw new BeeswaxError("artifact_install_failed", errorMessage(error), {
			context: { source: sourceDirectory, destination, installed },
		});
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}
