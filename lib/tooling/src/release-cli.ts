import type { ReleaseServices } from "./release-native.ts";
import { createReleaseServices } from "./release-native.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Repository release command argument boundary.
import { parseArgs } from "node:util";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve the source checkout at the CLI boundary.
import { resolve } from "node:path";
import { versionSchema } from "./release.ts";
import { z } from "zod";

const FIRST = 0;
const SUCCESS = 0;
const FAILURE = 1;

const HELP = `Usage: bun run release prepare VERSION [options]

Prepare every package version, lockfile and releases/vVERSION.md for review.
--repo DIR  Hive source checkout (default: current directory)
--json      Results and failures are always one JSON document

Use busybee input-schema release --json for the source publication workflow.
Preparation requires a clean checkout. VERSION must be stable X.Y.Z and exceed
every package version and the newest reachable stable suite tag.
See docs/releases.md for publication and the Homebrew build from source.
`;
const USER_ARGUMENTS = 2;

/** Argument parsing and live adapter composition stay at this repository-only CLI boundary. */
// eslint-disable-next-line max-statements -- CLI parsing and dispatch remain one boundary.
export async function runReleaseCli(
	args: string[],
	compose: (root: string) => ReleaseServices,
	stdout: (text: string) => void,
): Promise<number> {
	try {
		const { positionals, values } = parseArgs({
			args,
			allowPositionals: true,
			options: {
				repo: { type: "string", default: "." },
				help: { type: "boolean", short: "h" },
				json: { type: "boolean" },
			},
		});
		if (values.help) {
			stdout(HELP);
			return SUCCESS;
		}
		const services = compose(resolve(values.repo));
		let result: object = {};
		switch (positionals[FIRST]) {
			case "prepare": {
				const [, version] = z.tuple([z.literal("prepare"), versionSchema]).parse(positionals);
				result = await services.prepare(version);
				break;
			}
			default: {
				throw new Error("Choose prepare; see --help.");
			}
		}
		stdout(`${JSON.stringify({ ...result, ok: true, kind: positionals[FIRST] })}\n`);
		return SUCCESS;
	} catch (error) {
		stdout(
			`${JSON.stringify({ ok: false, kind: "release", reason: "release_failed", message: String(error) })}\n`,
		);
		return FAILURE;
	}
}

if (import.meta.main) {
	process.exitCode = await runReleaseCli(
		Bun.argv.slice(USER_ARGUMENTS),
		createReleaseServices,
		(text) => process.stdout.write(text),
	);
}
