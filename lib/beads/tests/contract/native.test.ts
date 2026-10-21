/* eslint-disable max-statements -- Disposable contract fixture preparation and cleanup stay together. */
import { contractSession, filtersAndPagination, labelsAndSavedQueries } from "./scenarios.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Disposable native contract fixture.
import { cp, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { createMemoryBeads, createNativeBeads } from "../../src/index.ts";
import { expect, test } from "bun:test";
// eslint-disable-next-line import/no-nodejs-modules -- Disposable native contract fixture.
import { join } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Disposable native contract fixture.
import { tmpdir } from "node:os";

const SUCCESS = 0;
const CONTRACT_TIMEOUT = 5000;
// Native uses wall time; all date-sensitive fixtures use 2099, future to both clocks.
const FIXTURE_NOW = "2026-10-11T00:00:00.000Z";

test(
	"native and memory preserve filters, search and pagination #test-9",
	async () => {
		await compare(filtersAndPagination);
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

test(
	"independent clones create distinct children with atomic parent links #test-647",
	async () => {
		const temporary = await mkdtemp(join(tmpdir(), "hive-beads-children-"));
		const root = await realpath(temporary);
		const first = join(root, "first");
		const second = join(root, "second");
		const native = createNativeBeads();
		const scope = (cwd: string) => ({
			cwd,
			db: join(cwd, ".beads", "beads.db"),
			actor: "lime-acute-ostrich",
		});
		try {
			await mkdir(first);
			const fixture = Bun.spawn(
				[
					"br",
					"init",
					"--prefix",
					"mem",
					"--json",
					"--db",
					scope(first).db,
					"--actor",
					"lime-acute-ostrich",
				],
				{ cwd: first, stdout: "pipe", stderr: "pipe" },
			);
			await Promise.all([new Response(fixture.stdout).text(), new Response(fixture.stderr).text()]);
			expect(await fixture.exited).toBe(SUCCESS);
			const parent = await native.create(scope(first), { title: "Parent", owner: "ct" });
			await cp(first, second, { recursive: true });
			const children = await Promise.all(
				[first, second].map((cwd) =>
					native.create(scope(cwd), {
						title: "Independent child",
						owner: "ct",
						parent: parent.id,
						deps: [{ id: parent.id, type: "related" }],
					}),
				),
			);
			const [left, right] = children;
			expect(left!.id).not.toBe(right!.id);
			const stored = await Promise.all(
				[first, second].map((cwd, index) => native.show(scope(cwd), children[index]!.id)),
			);
			for (const child of stored) {
				expect(child.dependencies).toEqual(
					expect.arrayContaining([
						expect.objectContaining({ id: parent.id, dependency_type: "parent-child" }),
						expect.objectContaining({ id: parent.id, dependency_type: "related" }),
					]),
				);
			}
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	},
	CONTRACT_TIMEOUT,
);

// --- Private functions ---
async function compare(scenario: typeof filtersAndPagination): Promise<void> {
	const temporary = await mkdtemp(join(tmpdir(), "hive-beads-contract-"));
	const root = await realpath(temporary);
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
		const actual = await scenario(contractSession(memory, root, db));
		const expected = await scenario(contractSession(native, root, db));
		expect(actual).toEqual(expected);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}
