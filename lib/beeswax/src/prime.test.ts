/* eslint-disable @stylistic/max-len -- Snapshots preserve rendered table rows verbatim. */
import { expect, test } from "bun:test";
import { renderPrime, updateChangelogs } from "./prime.ts";
import { BeeswaxError } from "./errors.ts";

const PUBLIC_TOOLS = 8;

test("default onboarding contains only everyday tools", () => {
	expect(renderPrime({ include: [], exclude: [] })).toMatchInlineSnapshot(`
	  "This repository uses Hive. Follow these conventions:
	  Read a tool's instructions when its task applies; use its --help for command options.
	  After upgrading, read <tool> changelog for breaking changes and adoption actions.

	  | Tool | When to use it | Instructions |
	  | --- | --- | --- |
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
	  After upgrading, read <tool> changelog for breaking changes and adoption actions.

	  | Tool | When to use it | Instructions |
	  | --- | --- | --- |
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
	expect(renderPrime({ include: ["colony"], exclude: ["colony", "busybee", "bee", "bee"] }))
		.toMatchInlineSnapshot(`
	  "This repository uses Hive. Follow these conventions:
	  Read a tool's instructions when its task applies; use its --help for command options.
	  After upgrading, read <tool> changelog for breaking changes and adoption actions.

	  | Tool | When to use it | Instructions |
	  | --- | --- | --- |
	  | honeycomb | Use Honeycomb for all Git worktrees. | \`honeycomb skills get git-workflow\` |
	  | qlock | Use qlock for shared command and merge queues under repository policy. | \`qlock skills get command-queues\` |"
	`);
});

test.each([
	{ include: ["typo"], exclude: [] },
	{ include: [], exclude: ["typo"] },
])("unknown tool names fail: %j", (options) => {
	expect(() => renderPrime(options)).toThrow(BeeswaxError);
});

test.each([
	{ previous: "0.5.0", command: "busybee changelog --since 0.5.0" },
	{ previous: "0.6.0", command: "busybee changelog" },
])("update from $previous keeps adoption discovery visible", ({ previous, command }) => {
	const result = updateChangelogs(previous, "0.6.0");
	expect(result).toMatchObject({ previousVersion: previous, installedVersion: "0.6.0" });
	expect(result.commands).toContain(command);
	expect(result.commands).toHaveLength(PUBLIC_TOOLS);
});
