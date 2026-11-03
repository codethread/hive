import { ancestry, parentBee, reviewer, worker } from "./src/stories/fixtures.ts";
import { expect, test } from "bun:test";
import { beeScene } from "./src/bee-scene.ts";

const inferred = [{ parent: parentBee.id, child: worker.id }];

test("verified inventory parents nest requests without manually loading ancestry", () => {
	const scene = beeScene({ bees: [worker, parentBee, reviewer], inferred }, "", null);
	expect(scene.inferred).toEqual(inferred);
	expect(scene.contextIds.size).toBe(0);
	expect(scene.matches).toEqual([worker, parentBee, reviewer]);
});

test("page-local identity matches do not establish a parent", () => {
	expect(beeScene({ bees: [worker, parentBee], inferred: [] }, "", null).inferred).toEqual([]);
});

test("verified links require both endpoints after request search", () => {
	const scene = beeScene({ bees: [worker, parentBee], inferred }, worker.identity, null);
	expect(scene.requests.map(({ id }) => id)).toEqual([worker.id]);
	expect(scene.inferred).toEqual([]);
});

test("explicit ancestry merges with verified inventory links without duplicate edges", () => {
	const scene = beeScene({ bees: [worker, parentBee], inferred }, worker.identity, ancestry);
	expect(scene.inferred).toEqual(inferred);
	expect([...scene.contextIds]).toEqual([parentBee.id]);
	expect(scene.matches.map(({ id }) => id)).toEqual([worker.id]);
});

test("explicit ambiguity takes precedence over an older inventory match", () => {
	const scene = beeScene({ bees: [worker, parentBee], inferred }, "", {
		...ancestry,
		chain: [worker],
		end: {
			kind: "ambiguous",
			requester: parentBee.identity,
			candidates: [parentBee.id, "other"],
		},
	});
	expect(scene.inferred).toEqual([]);
});
