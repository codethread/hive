#!/usr/bin/env bun

// eslint-disable-next-line import/no-nodejs-modules -- Build script writes the executable wrapper to the user's bin directory.
import { chmod, mkdir } from "node:fs/promises";
// eslint-disable-next-line import/no-nodejs-modules -- Build script locates the user's home directory.
import { homedir } from "node:os";
// eslint-disable-next-line import/no-nodejs-modules -- Build script resolves the checkout-relative entry point.
import { join } from "node:path";

const EXECUTABLE_MODE = 0o755;
const DEST_DIR = join(homedir(), ".local", "bin");
const ENTRY_PATH = join(import.meta.dir, "..", "bin", "honeycomb.ts");
const DEST_PATH = join(DEST_DIR, "honeycomb");

await mkdir(DEST_DIR, { recursive: true });
await Bun.write(DEST_PATH, `#!/usr/bin/env bash\nexec bun run "${ENTRY_PATH}" "$@"\n`);
await chmod(DEST_PATH, EXECUTABLE_MODE);
console.log(`Generated ${DEST_PATH}`);
