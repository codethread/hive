#!/usr/bin/env bun
// eslint-disable-next-line import/no-nodejs-modules -- Install a wrapper, replacing symlinks without changing their targets.
import { chmod, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { Command } from "commander";
// eslint-disable-next-line import/no-nodejs-modules -- Default to the user's local bin directory.
import { homedir } from "node:os";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve source and destination independently of the caller's directory.
import { resolve } from "node:path";

const EXECUTABLE_MODE = 0o755;
const program = new Command()
	.name("install-bin")
	.description("Install a qlock wrapper pointing at this retained checkout")
	.option("--directory <path>", "Destination bin directory", resolve(homedir(), ".local", "bin"))
	.parse();
const { directory } = program.opts<{ directory: string }>();
const destination = resolve(directory);
await mkdir(destination, { recursive: true });
const temporary = await mkdtemp(resolve(destination, ".qlock-"));
try {
	const staged = resolve(temporary, "qlock");
	const entry = resolve(import.meta.dirname, "../bin/qlock.ts");
	const quoted = `'${entry.replaceAll("'", "'\"'\"'")}'`;
	await Bun.write(staged, `#!/usr/bin/env sh\nexec bun run ${quoted} "$@"\n`);
	await chmod(staged, EXECUTABLE_MODE);
	await rename(staged, resolve(destination, "qlock"));
	console.log(`Installed ${resolve(destination, "qlock")}`);
} finally {
	await rm(temporary, { recursive: true, force: true });
}
