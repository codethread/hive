import { expect, test } from "bun:test";
import { taskSelection } from "./query.ts";

const NORMAL_PRIORITY = 2;

test("task selection preserves exact labels, closed membership and pagination", () => {
	const selection = taskSelection(
		{
			all: ["literal,comma", "CaseSensitive"],
			any: ["one", "two"],
			exclude: ["hidden"],
			priorities: [0, NORMAL_PRIORITY],
			statuses: ["closed"],
			closed: false,
			query: "",
		},
		["hv-task"],
		{ limit: 61, offset: 60 },
	);
	expect(selection).toEqual({
		ids: ["hv-task"],
		status: ["closed"],
		priority: [0, NORMAL_PRIORITY],
		labels: ["literal,comma", "CaseSensitive"],
		labelAny: ["one", "two"],
		excludeLabels: ["system", "bee", "hidden"],
		all: true,
		deferred: true,
		sort: "priority",
		limit: 61,
		offset: 60,
	});
});
