/* eslint-disable @stylistic/max-len -- Snapshots preserve rendered table rows verbatim. */
import { expect, test } from "bun:test";
import { renderPrime, updateChangelogs } from "./prime.ts";
import { BeeswaxError } from "./errors.ts";

const homebrewTools = [
	"honeycomb",
	"busybee",
	"bee",
	"qlock",
	"colony",
	"beeswax",
	"hive-ui",
	"scent",
];
const developmentTools = [
	"honeycomb",
	"busybee",
	"bee",
	"qlock",
	"colony",
	"beeswax",
	"waggle",
	"hive-ui",
	"scent",
];

test("default onboarding contains only everyday tools", () => {
	expect(renderPrime({ include: [], exclude: [] })).toMatchInlineSnapshot(`
	  "This repository uses Hive. Follow these conventions:
	  Read a tool's instructions when its task applies; use its --help for command options.
	  After upgrading Hive-owned CLIs, read <tool> changelog for breaking changes and adoption actions. This release-history command excludes external br/bv.

	  Preserve supplied BEADS_DB and actor identity. Native Beads owns tasks, assignments and readiness; BV is advisory.
	  Exclude automation-owned system beads from ordinary queries: br search/list/ready use --exclude-label system; BV uses bv --recipe _hive_work --robot-triage.
	  Inspect, claim available work, perform it, verify acceptance and close with evidence. Preserve other assignees and HITL reservations.
	  Assign work to a human only when that human explicitly instructs it. For handoffs or reservations without that instruction, record the needed human action or decision instead. Preserve existing human assignments unless that human requests clearing them. Human ownership records accountability, separately from assignment.
	  At pickup, read ancestor descriptions through the top-level task: follow br dep list TASK --type parent-child --json, repeating with depends_on_id until empty; then fetch known ancestors with br list --all --deferred --exclude-label system --id PARENT --id ANCESTOR --format csv --fields id,title,description (repeat --id as needed). Parent-child links carry scope; blocking dependencies carry prerequisites. Child descriptions add narrower scope rather than repeating parent prose.
	  Publish tracker changes at repository-defined checkpoints; code pushes require separate authorization.
	  On tracker alerts or sync failures other than pre-publication tracker_busy, pause Beads work and merges; read beeswax skills get tracker-recovery. Existing holds still apply.

	  | Tool | When to use it | Instructions |
	  | --- | --- | --- |
	  | br | Read and update Beads work records. | \`br --help\` |
	  | bv | Explore dependencies and prioritize work. | \`bv --help\` |
	  | honeycomb | Use Honeycomb for all Git worktrees. | \`honeycomb skills get git-workflow\` |
	  | busybee | Use Busy Bee to execute workflows and record outcomes. | \`busybee skills get workflow-execution\` |
	  | bee | Use Bee for all agent delegation and read its results. | \`bee skills get delegation\` |
	  | qlock | Use qlock for shared command and merge queues under repository policy. | \`qlock skills get command-queues\` |"
	`);
});

test("includes add optional tools once in canonical order #test-728", () => {
	const result = renderPrime({
		include: ["hive-ui", "waggle", "beeswax", "colony", "colony", "bee"],
		exclude: [],
	});
	expect(
		Array.from(result.matchAll(/^\| (?<name>[a-z][a-z-]*) \|/gmu), ([, name]) => name),
	).toEqual([
		"br",
		"bv",
		"honeycomb",
		"busybee",
		"bee",
		"qlock",
		"colony",
		"beeswax",
		"waggle",
		"hive-ui",
	]);
	const defaults = renderPrime({ include: [], exclude: [] });
	expect(result.startsWith(defaults)).toBe(true);
});

test("excludes remove defaults and win over includes without changing shared guidance", () => {
	const result = renderPrime({
		include: ["colony"],
		exclude: ["br", "bv", "honeycomb", "qlock", "colony", "busybee", "bee", "bee"],
	});
	const defaults = renderPrime({ include: [], exclude: [] });
	expect(result).toBe(defaults.slice(undefined, defaults.indexOf("\n| br |")));
});

test.each([
	{ include: ["typo"], exclude: [] },
	{ include: [], exclude: ["typo"] },
])("unknown tool names fail: %j", (options) => {
	expect(() => renderPrime(options)).toThrow(BeeswaxError);
});

test.each([
	{ previous: "0.5.0", selector: " --since 0.5.0", expected: homebrewTools },
	{ previous: "0.6.0", selector: "", expected: homebrewTools },
	{ previous: "0.5.0", selector: " --since 0.5.0", expected: developmentTools },
	{ previous: "0.6.0", selector: "", expected: developmentTools },
])(
	"update from $previous lists available Hive histories: $expected",
	({ previous, selector, expected }) => {
		const available = new Set([...expected, "br", "bv"]);
		const result = updateChangelogs(previous, "0.6.0", (name) => available.has(name));
		expect(result).toMatchObject({ previousVersion: previous, installedVersion: "0.6.0" });
		expect(result.commands).toEqual(expected.map((name) => `${name} changelog${selector}`));
	},
);
