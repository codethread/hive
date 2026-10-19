import { digestConfig, readProjectConfig } from "./config.ts";
import { piPayloadPath, renderPiPayload } from "./pi-onboarding.ts";
import {
	readProjectLock,
	requireProjectConfig,
	requireProjectGeneration,
	requireProjectVersion,
} from "./project.ts";
import { BeeswaxError } from "./errors.ts";
import type { WorkspaceIO } from "./services.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Validate this checkout's prepared payload.
import { join } from "node:path";

// eslint-disable-next-line max-statements -- Check acceptance and exact output before returning its import identity.
export async function verifyPiOnboarding(
	root: string,
	io: WorkspaceIO,
): Promise<{ payloadDigest: string }> {
	const lock = await readProjectLock(root, io);
	const config = await readProjectConfig(root, io);
	const path = join(root, piPayloadPath);
	if (!lock || !config?.onboarding?.harnesses.includes("pi")) {
		throw piPrerequisite(path, "Pi onboarding has no accepted project contract.");
	}
	requireProjectVersion(lock);
	requireProjectConfig(lock, config);
	requireProjectGeneration(lock, config);
	const expected = renderPiPayload(config.onboarding, digestConfig(config));
	if ((await io.read(path)) !== expected) {
		throw piPrerequisite(
			path,
			"Pi payload is missing or stale for the accepted release/configuration.",
		);
	}
	return { payloadDigest: new Bun.CryptoHasher("sha256").update(expected).digest("hex") };
}

// --- Private functions ---

function piPrerequisite(path: string, observed: string): BeeswaxError {
	return new BeeswaxError(
		"pi_prerequisite",
		`${path}: ${observed} Run beeswax sync with the accepted release before loading Pi.`,
		{
			context: { path, observed, nextCommand: "beeswax sync" },
		},
	);
}
