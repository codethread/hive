import { OBSERVED_AT, parentBee, worker } from "./src/stories/fixtures.ts";
import { ancestryEnding, beeScene } from "./src/bee-scene.ts";
import { expect, test } from "bun:test";
import type { Provenance } from "./contracts.ts";

const inventory = [worker, parentBee];
const edge = { child: worker.id, parent: parentBee.id };

test("matching requester identities do not establish parent links from an inventory page", () => {
	const scene = beeScene(inventory, "", null, []);
	expect(scene.requests.map(({ id }) => id)).toEqual([worker.id, parentBee.id]);
	expect(scene.inferred).toEqual([]);
});

test("verified inventory inference connects cards without explicitly loading child ancestry", () => {
	const scene = beeScene(inventory, "", null, [edge]);
	expect(scene.inferred).toEqual([edge]);
	expect(scene.matches).toEqual(inventory);
	expect(scene.contextIds.size).toBe(0);
});

test("a parent's explicit ancestry does not discard verified inventory links to its children", () => {
	const scene = beeScene(
		inventory,
		"",
		{ chain: [parentBee], end: { kind: "unmatched", requester: "ct" }, fetchedAt: OBSERVED_AT },
		[edge],
	);
	expect(scene.inferred).toEqual([edge]);
});

test.each([
	["hidden parent", [worker]],
	["hidden child", [parentBee]],
])("verified inference does not load a %s into the scene", (_name, bees) => {
	const scene = beeScene(bees, "", null, [edge]);
	expect(scene.inferred).toEqual([]);
	expect(scene.requests).toEqual(bees);
});

test("page-local search hides automatic edges whose parent no longer matches", () => {
	const scene = beeScene(inventory, worker.identity, null, [edge]);
	expect(scene.matches).toEqual([worker]);
	expect(scene.requests).toEqual([worker]);
	expect(scene.inferred).toEqual([]);
});

test("explicit child ancestry wins over a conflicting verified inventory edge", () => {
	const other = { ...parentBee, id: "other-request" };
	const scene = beeScene(
		[...inventory, other],
		"",
		{ chain: [worker, other], end: { kind: "unmatched", requester: "ct" }, fetchedAt: OBSERVED_AT },
		[edge],
	);
	expect(scene.inferred).toEqual([{ child: worker.id, parent: other.id }]);
	expect(scene.requests).toEqual([...inventory, other]);
});

test("historical ancestry context does not inflate filtered inventory matches", () => {
	const scene = beeScene(
		[worker],
		worker.identity,
		{ chain: inventory, end: { kind: "unmatched", requester: "ct" }, fetchedAt: OBSERVED_AT },
		[edge],
	);
	expect(scene.matches.map(({ id }) => id)).toEqual([worker.id]);
	expect([...scene.contextIds]).toEqual([parentBee.id]);
	expect(scene.inferred).toEqual([edge]);
});

test.each<Provenance["end"]>([
	{ kind: "ambiguous", requester: parentBee.identity, candidates: [parentBee.id, "other-request"] },
	{ kind: "unmatched", requester: parentBee.identity },
	{ kind: "limit" },
])("explicit terminal $kind evidence suppresses conflicting automatic links", (end) => {
	const scene = beeScene(inventory, "", { chain: [worker], end, fetchedAt: OBSERVED_AT }, [edge]);
	expect(scene.inferred).toEqual([]);
	expect(ancestryEnding(end)).not.toBe("");
});

test("a verified cycle closes its final edge without duplicating its repeated request", () => {
	const scene = beeScene(
		inventory,
		"",
		{ chain: inventory, end: { kind: "cycle", id: worker.id }, fetchedAt: OBSERVED_AT },
		[edge],
	);
	expect(scene.inferred).toEqual([edge, { child: parentBee.id, parent: worker.id }]);
	expect(scene.requests).toHaveLength(inventory.length);
});
