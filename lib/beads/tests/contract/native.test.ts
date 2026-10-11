/* eslint-disable max-statements -- Disposable contract fixture preparation and cleanup stay together. */
import {
	contractSession,
	filtersAndPagination,
	labelsAndSavedQueries,
	relationsAndReadiness,
	revisionsAndClaims,
} from "./scenarios.ts";
import { createMemoryBeads, createNativeBeads } from "../../src/index.ts";
import { expect, test } from "bun:test";
// eslint-disable-next-line import/no-nodejs-modules -- Disposable native contract fixture.
import { mkdtemp, rm } from "node:fs/promises";
// eslint-disable-next-line import/no-nodejs-modules -- Disposable native contract fixture.
import { join } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Disposable native contract fixture.
import { tmpdir } from "node:os";

const SUCCESS = 0;
const CONTRACT_TIMEOUT = 5000;
// Native uses wall time; all date-sensitive fixtures use 2099, future to both clocks.
const FIXTURE_NOW = "2026-10-11T00:00:00.000Z";

test(
	"native and memory preserve revisions, claims and diagnostics #test-8",
	async () => {
		await compare(revisionsAndClaims);
	},
	CONTRACT_TIMEOUT,
);
test(
	"native and memory preserve filters, search and pagination #test-9",
	async () => {
		await compare(filtersAndPagination);
	},
	CONTRACT_TIMEOUT,
);
test(
	"native and memory preserve relations and readiness #test-10",
	async () => {
		await compare(relationsAndReadiness);
	},
	CONTRACT_TIMEOUT,
);
test(
	"native and memory preserve labels and saved query overrides #test-11",
	async () => {
		await compare(labelsAndSavedQueries);
	},
	CONTRACT_TIMEOUT,
);

// --- Private functions ---
async function compare(scenario: typeof revisionsAndClaims): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), "hive-beads-contract-"));
	const db = join(root, ".beads", "beads.db");
	const native = createNativeBeads();
	try {
		const fixture = Bun.spawn(
			["br", "init", "--prefix", "mem", "--json", "--db", db, "--actor", "contract"],
			{
				cwd: root,
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		await Promise.all([new Response(fixture.stdout).text(), new Response(fixture.stderr).text()]);
		expect(await fixture.exited).toBe(SUCCESS);
		const memory = createMemoryBeads({ now: () => FIXTURE_NOW });
		const [actual, expected] = await Promise.all([
			scenario(contractSession(memory, root, db)),
			scenario(contractSession(native, root, db)),
		]);
		expect(actual).toEqual(expected);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}
