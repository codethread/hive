import { parseClassifier, validateClassifierId } from "./classifiers.ts";
import type { ClassificationRequest } from "./classifiers.ts";
import type { Fetch } from "@typesafe-ai/sdk";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import type { WaggleDependencies } from "./cli.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve paths within the explicitly selected classifier directory.
import { join } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Classifier catalogue access is a filesystem boundary.
import { readdir } from "node:fs/promises";

const DEFINITION_EXTENSION = ".toml";
const FILENAME_START = 0;
const REQUEST_TIMEOUT_MS = 10_000;

export function createLiveDependencies(): WaggleDependencies {
	const load: WaggleDependencies["load"] = async (directory, id) => {
		validateClassifierId(id);
		return parseClassifier(
			id,
			await Bun.file(join(directory, `${id}${DEFINITION_EXTENSION}`)).text(),
		);
	};
	return {
		classify: (request) => classifyWithJev(request, process.env["TYPESAFE_API_KEY"]),
		list: async (directory) => {
			const entries = await readdir(directory, { withFileTypes: true });
			const ids = entries
				.filter((entry) => entry.isFile() && entry.name.endsWith(DEFINITION_EXTENSION))
				.map((entry) => entry.name.slice(FILENAME_START, -DEFINITION_EXTENSION.length))
				.toSorted();
			return Promise.all(ids.map((id) => load(directory, id)));
		},
		load,
		readInput: (path) => {
			if (path === "-") {
				return Bun.stdin.text();
			}
			return Bun.file(path).text();
		},
		stderr: (text) => {
			process.stderr.write(text);
		},
		stdout: (text) => {
			process.stdout.write(text);
		},
	};
}

/** One explicit provider call, with an injectable transport for offline adapter tests. */
export async function classifyWithJev(
	request: ClassificationRequest,
	apiKey: string | undefined,
	transport: Fetch = fetch,
): Promise<unknown> {
	if (!apiKey?.trim()) {
		throw new Error("Set TYPESAFE_API_KEY to run a classifier; list and describe do not need it.");
	}
	const client = new TypeSafeClient({
		apiKey,
		baseURL: "https://api.typesafe.ai",
		fetch: transport,
		logLevel: "off",
		retry: { maxRetries: 0 },
		timeout: REQUEST_TIMEOUT_MS,
	});
	// Materialize the SDK's APIPromise before exposing a normal promise to callers.
	return await client.systemOne(request);
}
