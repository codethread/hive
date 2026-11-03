import { EXIT, QlockError } from "./queue.ts";
import ms from "ms";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve the XDG config location from explicit inputs.
import { resolve } from "node:path";
import { z } from "zod";

const MAX_TIMEOUT_MS = 2_147_483_647;
const MIN_TIMEOUT_MS = 1;
const configSchema = z.strictObject({ timeout: z.string().min(MIN_TIMEOUT_MS).optional() });

export type RuntimeLimit =
	| {
			/** No configured runtime deadline. */
			kind: "unlimited";
	  }
	| {
			/** Terminate the owned process group when this runtime elapses. */
			kind: "timeout";
			/** Positive whole milliseconds, within the native timer range. */
			milliseconds: number;
	  };

export function configPath(home: string, configHome: string | undefined): string {
	let base = configHome;
	if (base === undefined || base === "") {
		base = resolve(home, ".config");
	}
	return resolve(base, "hive", "qlock.toml");
}

/** Parse external TOML once; invalid settings never become an unlimited runtime. */
export function parseConfig(text: string): RuntimeLimit {
	try {
		const config = configSchema.parse(Bun.TOML.parse(text));
		if (config.timeout === undefined) {
			return { kind: "unlimited" };
		}
		const milliseconds = ms(config.timeout as ms.StringValue);
		if (
			!Number.isSafeInteger(milliseconds) ||
			milliseconds < MIN_TIMEOUT_MS ||
			milliseconds > MAX_TIMEOUT_MS
		) {
			throw new Error(`timeout must be a positive duration between 1ms and ${MAX_TIMEOUT_MS}ms`);
		}
		return { kind: "timeout", milliseconds };
	} catch (error) {
		throw new QlockError(
			"invalid_config",
			`Invalid qlock configuration: ${String(error)}`,
			EXIT.usage,
		);
	}
}
