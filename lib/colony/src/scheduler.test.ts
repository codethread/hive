import { compareCandidates, hasContention } from "./scheduler.ts";
import { expect, test } from "bun:test";

const workerA = { bucket: "/a", kind: "worker" };
const workerB = { bucket: "/b", kind: "worker" };
const reviewerA = { bucket: "/a", kind: "reviewer" };
const reviewerB = { bucket: "/b", kind: "reviewer" };
const limits = { colony: 4, kind: 2, kinds: {}, worktree: 2 };

test.each([
	{ name: "empty", candidates: [], occupied: [], limits, contends: false },
	{ name: "one feasible", candidates: [workerA], occupied: [], limits, contends: false },
	{
		name: "joint fit",
		candidates: [workerA, workerB, reviewerA, reviewerB],
		occupied: [],
		limits,
		contends: false,
	},
	{
		name: "saturated colony",
		candidates: [workerA, reviewerB],
		occupied: [workerA],
		limits: { ...limits, colony: 1 },
		contends: false,
	},
	{
		name: "lowered cap",
		candidates: [workerA, reviewerB],
		occupied: [workerA, reviewerB],
		limits: { ...limits, colony: 1 },
		contends: false,
	},
	{
		name: "blocked kind with feasible reviewer",
		candidates: [workerB, reviewerB],
		occupied: [workerA],
		limits: { ...limits, kind: 1 },
		contends: false,
	},
	{
		name: "blocked bucket with feasible worker",
		candidates: [reviewerA, workerB],
		occupied: [workerA],
		limits: { ...limits, worktree: 1 },
		contends: false,
	},
	{
		name: "colony contention",
		candidates: [workerA, reviewerB],
		occupied: [],
		limits: { ...limits, colony: 1 },
		contends: true,
	},
	{
		name: "kind contention",
		candidates: [workerA, workerB],
		occupied: [],
		limits: { ...limits, kind: 1 },
		contends: true,
	},
	{
		name: "named kind contention",
		candidates: [workerA, workerB],
		occupied: [],
		limits: { ...limits, kinds: { worker: 1 } },
		contends: true,
	},
	{
		name: "worktree contention",
		candidates: [workerA, reviewerA],
		occupied: [],
		limits: { ...limits, worktree: 1 },
		contends: true,
	},
	{
		name: "retained reservations",
		candidates: [workerA, workerB],
		occupied: [workerA],
		limits,
		contends: true,
	},
	{
		name: "zero kind",
		candidates: [workerA, workerB],
		occupied: [],
		limits: { ...limits, kind: 0 },
		contends: false,
	},
])("contention: $name", ({ candidates, occupied, limits: policy, contends }) => {
	expect(hasContention(candidates, occupied, policy)).toBe(contends);
});

test("native priority dominates PageRank, then creation time and ID resolve ties", () => {
	const base = { priority: 2, score: 1, createdAt: "2026-01-01", id: "a" };
	const candidates = [
		{ ...base, id: "b" },
		{ ...base, createdAt: "2026-01-02", id: "later" },
		{ ...base, score: 2, id: "ranked" },
		base,
		{ ...base, priority: 1, score: 0, id: "urgent" },
	];
	expect(candidates.toSorted(compareCandidates).map(({ id }) => id)).toEqual([
		"urgent",
		"ranked",
		"a",
		"b",
		"later",
	]);
});
