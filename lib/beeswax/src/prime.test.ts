/* eslint-disable @stylistic/max-len -- Snapshots preserve rendered table rows verbatim. */
import { expect, test } from "bun:test";
import { renderPrime, updateChangelogs } from "./prime.ts";
import { BeeswaxError } from "./errors.ts";

const homebrewTools = ["honeycomb", "busybee", "bee", "qlock", "colony", "beeswax", "hive-ui"];
const developmentTools = [
	"honeycomb",
	"busybee",
	"bee",
	"qlock",
	"colony",
	"beeswax",
	"waggle",
	"hive-ui",
];

test("default onboarding contains only everyday tools", () => {
	expect(renderPrime({ include: [], exclude: [] })).toMatchInlineSnapshot(`
	  "This repository uses Hive. Follow these conventions:
	  Read a tool's instructions when its task applies; use its --help for command options.
	  After upgrading Hive-owned CLIs, read <tool> changelog for breaking changes and adoption actions. This release-history command excludes external br/bv.

	  Preserve supplied BEADS_DB and actor identity. Native Beads owns tasks, assignments and readiness; BV is advisory.
	  Exclude automation-owned system beads from ordinary queries: br search/list/ready use --exclude-label system; BV uses bv --recipe work --robot-triage.
	  Inspect, claim available work, perform it, verify acceptance and close with evidence. Preserve other assignees and human/HITL reservations.
	  Publish tracker changes at repository-defined checkpoints; code pushes require separate authorization.
	  On tracker alerts or sync failure, pause Beads work and merges; read beeswax skills get tracker-recovery.

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

test("includes add optional tools once in canonical order", () => {
	expect(
		renderPrime({
			include: ["hive-ui", "waggle", "beeswax", "colony", "colony", "bee"],
			exclude: [],
		}),
	).toMatchInlineSnapshot(`
	  "This repository uses Hive. Follow these conventions:
	  Read a tool's instructions when its task applies; use its --help for command options.
	  After upgrading Hive-owned CLIs, read <tool> changelog for breaking changes and adoption actions. This release-history command excludes external br/bv.

	  Preserve supplied BEADS_DB and actor identity. Native Beads owns tasks, assignments and readiness; BV is advisory.
	  Exclude automation-owned system beads from ordinary queries: br search/list/ready use --exclude-label system; BV uses bv --recipe work --robot-triage.
	  Inspect, claim available work, perform it, verify acceptance and close with evidence. Preserve other assignees and human/HITL reservations.
	  Publish tracker changes at repository-defined checkpoints; code pushes require separate authorization.
	  On tracker alerts or sync failure, pause Beads work and merges; read beeswax skills get tracker-recovery.

	  | Tool | When to use it | Instructions |
	  | --- | --- | --- |
	  | br | Read and update Beads work records. | \`br --help\` |
	  | bv | Explore dependencies and prioritize work. | \`bv --help\` |
	  | honeycomb | Use Honeycomb for all Git worktrees. | \`honeycomb skills get git-workflow\` |
	  | busybee | Use Busy Bee to execute workflows and record outcomes. | \`busybee skills get workflow-execution\` |
	  | bee | Use Bee for all agent delegation and read its results. | \`bee skills get delegation\` |
	  | qlock | Use qlock for shared command and merge queues under repository policy. | \`qlock skills get command-queues\` |
	  | colony | Operate scheduling and execution of submitted bee requests. | \`colony skills get operations\` |
	  | beeswax | Configure repositories, trackers, Git hooks and harness onboarding. | \`beeswax skills get repository-setup\` |
	  | waggle | Run repository-owned semantic classifiers to direct review attention. | \`waggle list --json; waggle describe <id> --json; waggle --help\` |
	  | hive-ui | View repository work and workflow state in a read-only web board. | \`hive-ui --help\` |"
	`);
});

test("excludes remove defaults and win over includes", () => {
	expect(
		renderPrime({
			include: ["colony"],
			exclude: ["br", "bv", "honeycomb", "qlock", "colony", "busybee", "bee", "bee"],
		}),
	).toMatchInlineSnapshot(`
	  "This repository uses Hive. Follow these conventions:
	  Read a tool's instructions when its task applies; use its --help for command options.
	  After upgrading Hive-owned CLIs, read <tool> changelog for breaking changes and adoption actions. This release-history command excludes external br/bv.

	  Preserve supplied BEADS_DB and actor identity. Native Beads owns tasks, assignments and readiness; BV is advisory.
	  Exclude automation-owned system beads from ordinary queries: br search/list/ready use --exclude-label system; BV uses bv --recipe work --robot-triage.
	  Inspect, claim available work, perform it, verify acceptance and close with evidence. Preserve other assignees and human/HITL reservations.
	  Publish tracker changes at repository-defined checkpoints; code pushes require separate authorization.
	  On tracker alerts or sync failure, pause Beads work and merges; read beeswax skills get tracker-recovery.

	  | Tool | When to use it | Instructions |
	  | --- | --- | --- |"
	`);
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
