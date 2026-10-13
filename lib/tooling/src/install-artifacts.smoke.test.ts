// Real installation regression uses disposable filesystem fixtures.
// eslint-disable-next-line import/no-nodejs-modules
import { chmod, lstat, mkdir, mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { expect, test } from "bun:test";
import { installArtifacts } from "./install-artifacts.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Fixture paths.
import { join } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Keep installations outside the checkout and user bins.
import { tmpdir } from "node:os";

const EXECUTABLE_MODE = 0o755;
const NON_EXECUTABLE_MODE = 0o644;
const PERMISSION_MASK = 0o777;
const SUCCESS = 0;

test(
	"installation copies only named artifacts, sets executable permissions and replaces symlinks on repeated installs",
	// eslint-disable-next-line max-statements -- Verify observable installation outcomes in one disposable fixture.
	async () => {
		const root = await mkdtemp(join(tmpdir(), "hive-artifacts-"));
		const source = join(root, "dist");
		const destination = join(root, "bin");
		const original = join(root, "dotfile");
		const artifact = join(source, "example");
		const installed = join(destination, "example");
		try {
			await mkdir(source);
			await mkdir(destination);
			await Bun.write(original, "original script\n");
			await Bun.write(artifact, "#!/bin/sh\nprintf artifact\n");
			await chmod(artifact, NON_EXECUTABLE_MODE);
			await Bun.write(join(source, "unselected"), "do not install");
			await symlink(original, installed);
			expect(await installArtifacts(source, destination, ["example"])).toEqual([installed]);
			expect(await Bun.file(original).text()).toBe("original script\n");
			const installedStat = await lstat(installed);
			const artifactStat = await lstat(artifact);
			expect(installedStat.isSymbolicLink()).toBe(false);
			expect(installedStat.mode & PERMISSION_MASK).toBe(EXECUTABLE_MODE);
			expect(artifactStat.mode & PERMISSION_MASK).toBe(NON_EXECUTABLE_MODE);
			await Bun.write(artifact, "#!/bin/sh\nprintf replacement\n");
			await installArtifacts(source, destination, ["example"]);
			expect(await Bun.file(installed).text()).toBe(await Bun.file(artifact).text());
			expect(await readdir(destination)).toEqual(["example"]);
			const child = Bun.spawn([installed], { stderr: "pipe", stdout: "pipe" });
			expect(await new Response(child.stdout).text()).toBe("replacement");
			expect(await child.exited).toBe(SUCCESS);
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	},
);
