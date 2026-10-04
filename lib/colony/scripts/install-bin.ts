#!/usr/bin/env bun
// eslint-disable-next-line import/no-nodejs-modules -- Install executable wrappers in the selected bin directory.
import { chmod, mkdir } from "node:fs/promises";
import { Command } from "commander";
// eslint-disable-next-line import/no-nodejs-modules -- Choose the user's local bin directory by default.
import { homedir } from "node:os";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve installed entry paths independently of the caller's working directory.
import { resolve } from "node:path";

const EXECUTABLE_MODE = 0o755;
const program = new Command()
	.name("install-bin")
	.description("Install Bee and Colony wrappers pointing at this retained checkout")
	.option("--directory <path>", "Destination bin directory", resolve(homedir(), ".local", "bin"))
	.parse();
const { directory } = program.opts<{ directory: string }>();
const destination = resolve(directory);

await mkdir(destination, { recursive: true });
await Promise.all(
	["bee", "colony"].map(async (name) => {
		const entry = resolve(import.meta.dirname, "../bin", `${name}.ts`);
		const path = resolve(destination, name);
		const quotedEntry = `'${entry.replaceAll("'", "'\"'\"'")}'`;
		await Bun.write(path, `#!/usr/bin/env bash\nexec bun run ${quotedEntry} "$@"\n`);
		await chmod(path, EXECUTABLE_MODE);
		console.log(`Installed ${path}`);
	}),
);
