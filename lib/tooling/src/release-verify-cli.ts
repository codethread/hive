import type { VerificationInput } from "./release-verify-native.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Repository helper CLI argument boundary.
import { parseArgs } from "node:util";
import { platformSchema } from "./release.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve explicit candidate/proof paths.
import { resolve } from "node:path";
import { revisionSchema } from "./release-verify.ts";
import { verifyNativeRelease } from "./release-verify-native.ts";
import { z } from "zod";

const SUCCESS = 0;
const FAILURE = 1;
const USER_ARGUMENTS = 2;
const text = z.string().nonempty();
const resultSchema = z.union([
	z.object({
		ok: z.literal(true),
		kind: z.literal("release_verification"),
		proof: text,
		revision: revisionSchema,
		platform: platformSchema,
	}),
	z.object({
		ok: z.literal(false),
		kind: z.literal("release_verification"),
		reason: z.enum(["invalid_input", "verification_failed"]),
		message: text,
		proof: text.optional(),
	}),
]);
const HELP = `Usage: bun run lib/tooling/src/release-verify-cli.ts [options]

--artifacts DIR      Original candidate: four archives, manifest.json, SHA256SUMS
--revision SHA       Expected 40-character lowercase commit ID
--platform PLATFORM  Native darwin-arm64, darwin-x64, linux-arm64 or linux-x64
--output FILE        Proof JSON, including partial evidence on probe failures
--actor NAME         Actor for the disposable probe tracker
--schema             Print the command result JSON schema
--json               Results and failures are always one JSON document

Requires native br/bv on PATH and installed Hive workspace dependencies.
Reads candidate bytes without rebuilding. Extracts into temporary storage,
executes all ten versions and public help, qlock status, an installed-dependency
Busy Bee workflow, and embedded Hive UI HTTP probes against a disposable tracker.
Temporary files and foreground UI are removed after execution. No global install,
daemon startup or publication. Stdout reports the proof path; the file retains
full command/HTTP evidence. Failures exit 1 and include the requested proof path
when native verification was attempted; a write failure can leave it absent.
CI proof includes GitHub repository, workflow ref/SHA, run ID/attempt and
CANDIDATE_ARTIFACT_ID/CANDIDATE_ARTIFACT_DIGEST from the calling workflow.
`;

/** Parse external arguments once; compose the native verifier only at this CLI boundary. */
// eslint-disable-next-line max-statements -- Parse and dispatch one repository-only command.
export async function runVerificationCli(
	args: string[],
	verify: (input: VerificationInput) => Promise<unknown>,
	stdout: (value: string) => void,
): Promise<number> {
	let proof: string | undefined = undefined;
	try {
		const { values, positionals } = parseArgs({
			args,
			options: {
				artifacts: { type: "string" },
				revision: { type: "string" },
				platform: { type: "string" },
				output: { type: "string" },
				actor: { type: "string" },
				json: { type: "boolean" },
				schema: { type: "boolean" },
				help: { type: "boolean", short: "h" },
			},
		});
		if (values.help) {
			stdout(HELP);
			return SUCCESS;
		}
		if (values.schema) {
			stdout(
				`${JSON.stringify({ ok: true, kind: "schema", schema: z.toJSONSchema(resultSchema) })}\n`,
			);
			return SUCCESS;
		}
		z.tuple([]).parse(positionals);
		const input: VerificationInput = {
			artifacts: resolve(text.parse(values.artifacts)),
			revision: revisionSchema.parse(values.revision),
			platform: platformSchema.parse(values.platform),
			output: resolve(text.parse(values.output)),
			actor: text.parse(values.actor),
		};
		proof = input.output;
		await verify(input);
		stdout(
			`${JSON.stringify({
				ok: true,
				kind: "release_verification",
				proof,
				revision: input.revision,
				platform: input.platform,
			})}\n`,
		);
		return SUCCESS;
	} catch (error) {
		let reason = "verification_failed";
		if (proof === undefined) {
			reason = "invalid_input";
		}
		const failure = {
			ok: false,
			kind: "release_verification",
			reason,
			message: String(error),
			proof,
		};
		stdout(`${JSON.stringify(failure)}\n`);
		return FAILURE;
	}
}

if (import.meta.main) {
	process.exitCode = await runVerificationCli(
		Bun.argv.slice(USER_ARGUMENTS),
		verifyNativeRelease,
		(value) => process.stdout.write(value),
	);
}
