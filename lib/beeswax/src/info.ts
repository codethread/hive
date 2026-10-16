/* eslint-disable unicorn/no-null -- JSON distinguishes unknown release provenance explicitly. */
// eslint-disable-next-line import/no-nodejs-modules -- Fixed release metadata paths.
import { dirname, resolve } from "node:path";
import { BeeswaxError } from "./errors.ts";
import type { WorkspaceIO } from "./services.ts";
import { version } from "../package.json";
import { z } from "zod";

const releaseSchema = z.object({
	version: z.literal(version),
	revision: z.string().regex(/^[a-f\d]{40}$/u),
	executables: z.array(z.string()).refine((names) => names.includes("beeswax")),
});

/** Inspect only known release layouts; never infer an installed source tree from the caller's cwd. */
// eslint-disable-next-line max-statements -- Inspect two fixed release layouts in priority order.
export async function installationInfo(executable: string, io: Pick<WorkspaceIO, "read">) {
	const candidates = [
		resolve(dirname(executable), "../share/hive/release.json"),
		resolve(dirname(executable), "../release.json"),
	];
	let metadata = "";
	let revision: string | null = null;
	/* eslint-disable no-await-in-loop -- Inspect the package-manager layout before the unpacked release layout. */
	for (const path of candidates) {
		const contents = await io.read(path);
		if (contents !== "") {
			const parsed = releaseSchema.safeParse(JSON.parse(contents));
			if (!parsed.success) {
				throw new BeeswaxError(
					"invalid_release_metadata",
					`Release metadata does not match Beeswax ${version}: ${path}`,
					{ context: { metadata: path } },
				);
			}
			metadata = path;
			({ revision } = parsed.data);
			break;
		}
	}
	/* eslint-enable no-await-in-loop */
	const ref = revision ?? `v${version}`;
	return {
		ok: true,
		kind: "installation_info",
		version,
		executable,
		revision,
		metadata: metadata || null,
		source: {
			status: "not_installed",
			ref,
			url: `https://github.com/codethread/hive/tree/${ref}`,
			archive: `https://github.com/codethread/hive/archive/${ref}.tar.gz`,
		},
	};
}
