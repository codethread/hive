import { hookMigration, shellQuote } from "./hooks.ts";
import type { WorkspaceIO } from "./services.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Bind this checkout through its own Git administration directory.
import { join } from "node:path";
import { version } from "../package.json";
import { z } from "zod";

const FORMAT = 1;
const mode = 0o755;
const receiptSchema = z.strictObject({
	format: z.literal(FORMAT),
	beeswaxVersion: z.string(),
	executable: z.string(),
	launcher: z.string(),
});

/** Bind portable sections to one verified installed command; no application policy lives here. */
// eslint-disable-next-line max-statements -- Verify ownership before replacing the local command binding.
export async function bindCheckout(
	root: string,
	executable: string,
	io: WorkspaceIO,
): Promise<void> {
	const directory = await io.command(
		["git", "rev-parse", "--path-format=absolute", "--git-path", "beeswax"],
		root,
	);
	const path = join(directory, "cli");
	const contents = `#!/usr/bin/env sh\nexec ${shellQuote(executable)} "$@"\n`;
	const current = await io.read(path);
	const previous = await io.read(join(directory, "receipt.json"));
	if (current !== "" && current !== contents) {
		const receipt = receiptSchema.safeParse(parseReceipt(previous));
		if (!receipt.success || receipt.data.launcher !== digest(current)) {
			throw hookMigration(`The local Beeswax launcher was edited: ${path}.`);
		}
	}
	if (current !== contents) {
		await io.write(path, contents);
	}
	await io.chmod(path, mode);
	await io.write(
		join(directory, "receipt.json"),
		`${JSON.stringify(
			{
				format: FORMAT,
				beeswaxVersion: version,
				executable,
				launcher: digest(contents),
			},
			undefined,
			"\t",
		)}\n`,
	);
}

// --- Private functions ---

function digest(contents: string): string {
	return new Bun.CryptoHasher("sha256").update(contents).digest("hex");
}

function parseReceipt(contents: string): unknown {
	try {
		return JSON.parse(contents);
	} catch {
		return undefined;
	}
}
