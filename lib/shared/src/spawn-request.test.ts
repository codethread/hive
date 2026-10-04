import { expect, test } from "bun:test";
import { requestNeedsAttention, requestResolution } from "./spawn-request.ts";
import { beadSchema } from "./bees-io.ts";

const original = beadSchema.parse({
	close_reason: "exhausted",
	created_at: "fixture",
	id: "test-old",
	priority: 2,
	status: "closed",
	updated_at: "fixture",
});

test.each([
	{ attention: false, reason: "", resolution: "unresolved", status: "open" },
	{ attention: false, reason: "completed", resolution: "resolved", status: "closed" },
	{ attention: false, reason: "cancelled", resolution: "resolved", status: "closed" },
	{ attention: false, reason: "Stopped by Bee", resolution: "resolved", status: "closed" },
	{ attention: true, reason: "exhausted", resolution: "unresolved", status: "closed" },
	{ attention: true, reason: "claim_failed", resolution: "unresolved", status: "closed" },
])(
	"$status / $reason has independent resolution and attention",
	({ status, reason, resolution, attention }) => {
		const bead = { ...original, close_reason: reason, status };
		expect(requestResolution(bead)).toEqual({ kind: resolution });
		expect(requestNeedsAttention(bead)).toBe(attention);
	},
);

test("a replacement resolves its predecessor regardless of replacement outcome", () => {
	const bead = beadSchema.parse({
		close_reason: "exhausted",
		created_at: "fixture",
		dependents: [{ dependency_type: "supersedes", id: "test-new", status: "closed" }],
		id: "test-old",
		priority: 2,
		status: "closed",
		updated_at: "fixture",
	});
	expect(requestResolution(bead)).toEqual({ kind: "superseded", replacementIds: ["test-new"] });
	expect(requestNeedsAttention(bead)).toBe(false);
	expect(bead.close_reason).toBe("exhausted");
});
