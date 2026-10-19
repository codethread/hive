// eslint-disable-next-line import/no-nodejs-modules -- Build-time native extension entry point.
import { fileURLToPath } from "node:url";

const SUCCESS = 0;

/** Bundle the Pi runtime at compile time; no source files are read by the installed command. */
export function piExtensionSource(): string {
	const entrypoint = fileURLToPath(new URL("bin/pi.ts", import.meta.url));
	// eslint-disable-next-line node/no-sync -- A compile-time macro needs a separate bundler process.
	const result = Bun.spawnSync([
		process.execPath,
		"build",
		entrypoint,
		"--target=node",
		"--minify",
	]);
	if (result.exitCode !== SUCCESS) {
		throw new Error(result.stderr.toString());
	}
	return result.stdout.toString();
}
