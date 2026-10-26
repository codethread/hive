import { expect, test } from "bun:test";
import type { BvService } from "@hive/shared/bv";
import { createFakeBv } from "@hive/shared/bv";
import { pageRanks } from "./ranking.ts";

const repository = { root: "/repository", beadsDb: "/selected/tracker.db" };
const state = "/daemon/state";

test("linked task coverage uses the selected live database and retains complete graph scores #test-696", async () => {
	const fake = createFakeBv({ taskIds: ["z-linked", "a-unrelated", "m-linked"] });
	const calls: Parameters<BvService["readPageRanks"]>[number][] = [];
	const bv = {
		readPageRanks: (input: Parameters<BvService["readPageRanks"]>[number]) => {
			calls.push(input);
			return fake.readPageRanks(input);
		},
	};
	const scores = await pageRanks({ bv, repository, state }, ["z-linked", "m-linked"]);
	expect(calls).toEqual([{ cwd: state, sqlitePath: repository.beadsDb }]);
	expect(Object.keys(scores).toSorted()).toEqual(["a-unrelated", "m-linked", "z-linked"]);
	expect(scores["m-linked"]).toBeGreaterThan(scores["z-linked"]!);
});

test("absent linked task scores reject before candidate ordering", async () => {
	const bv = createFakeBv({ taskIds: ["present"] });
	const result = await pageRanks({ bv, repository, state }, ["present", "missing"]).catch(
		(error: unknown) => error,
	);
	expect(result).toBeInstanceOf(Error);
});

test("ranking failures propagate rather than choosing a fallback order", async () => {
	const failure = new Error("fixture ranking failure");
	const bv = { readPageRanks: () => Promise.reject(failure) };
	const result = await pageRanks({ bv, repository, state }, ["linked"]).catch(
		(error: unknown) => error,
	);
	expect(result).toBe(failure);
});
