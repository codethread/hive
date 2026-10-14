import {
	platformSchema,
	platforms,
	releaseManifestSchema,
	repositorySchema,
	versionSchema,
} from "./release.ts";
import type { ReleaseServices } from "./release-native.ts";
import { createReleaseServices } from "./release-native.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Repository release command argument boundary.
import { parseArgs } from "node:util";
// eslint-disable-next-line import/no-nodejs-modules -- Explicit repository and artifact locations.
import { resolve } from "node:path";
import { z } from "zod";

const FIRST = 0;
const SUCCESS = 0;
const FAILURE = 1;
const MINIMUM_LENGTH = 1;

const HELP = `Usage: bun run release COMMAND [options]

prepare VERSION                    Bump every package and write releases/vVERSION.md
build --revision SHA --output DIR  Compile an immutable commit; DIR must not exist
formula --artifacts DIR --repository OWNER/REPO --output FILE
                                   Verify checksums and render a complete Hive formula

--repo DIR       Hive source checkout (default: current directory)
--target TARGET  Build one platform only; omit to build all four
                 darwin-arm64, darwin-x64, linux-arm64, linux-x64
--schema         Print the release manifest JSON schema
--json           Results and failures are always one JSON document

Use busybee input-schema release for the separately invoked publication workflow.
prepare requires a clean checkout and an increasing stable X.Y.Z version.
build never includes dirty files. Partial output is retained after failure;
inspect it and choose a new output directory on retry. No command publishes,
creates tags, installs binaries, initializes trackers or starts services.
`;
const revisionSchema = z.string().regex(/^[a-f\d]{40}$/u);
const pathSchema = z.string().min(MINIMUM_LENGTH);
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
				revision: { type: "string" },
				output: { type: "string" },
				artifacts: { type: "string" },
				repository: { type: "string" },
				target: { type: "string" },
				help: { type: "boolean", short: "h" },
				schema: { type: "boolean" },
				json: { type: "boolean" },
			},
		});
		if (values.help) {
			stdout(HELP);
			return SUCCESS;
		}
		if (values.schema) {
			stdout(
				`${JSON.stringify({ ok: true, kind: "schema", schema: z.toJSONSchema(releaseManifestSchema) })}\n`,
			);
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
			case "build": {
				z.tuple([z.literal("build")]).parse(positionals);
				let targets = [...platforms];
				if (values.target !== undefined) {
					targets = [platformSchema.parse(values.target)];
				}
				result = await services.build(
					revisionSchema.parse(values.revision),
					pathSchema.parse(values.output),
					targets,
				);
				break;
			}
			case "formula": {
				z.tuple([z.literal("formula")]).parse(positionals);
				result = await services.formula(
					pathSchema.parse(values.artifacts),
					repositorySchema.parse(values.repository),
					pathSchema.parse(values.output),
				);
				break;
			}
			default: {
				throw new Error("Choose prepare, build or formula; see --help.");
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
