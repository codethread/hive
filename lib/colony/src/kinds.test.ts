import type { BeeKind, BeesConfig } from "@hive/shared";
import { expect, test } from "bun:test";
import type { KindOptions } from "./kinds.ts";
import { discoverKinds } from "./kinds.ts";

const base: BeeKind = {
	description: "Choose this role.",
	effort: "low",
	harness: "codex",
	hidden: false,
	model: "model",
	prompt: "Private execution instructions.",
	system_prompt: "Private role instructions.",
};
const config: BeesConfig = {
	formulas: {},
	humans: ["ct"],
	// eslint-disable-next-line unicorn/no-null -- This fixture disables inactivity review.
	inactivity_drone: null,
	// eslint-disable-next-line unicorn/no-null -- No configured advisory inspector.
	post_run_drone: null,
	kinds: { caller: base, helper: base, internal: { ...base, hidden: true } },
	limits: { colony: 1, kind: 1, kinds: {}, worktree: 1 },
	max_retries: 0,
	owner: "ct",
	ranking: "fifo",
	retry_delay_ms: 0,
};

test.each([
	{
		all: false,
		caller: undefined,
		expected: ["caller", "helper"],
		name: "native caller",
		policy: {},
	},
	{
		all: false,
		caller: "caller",
		expected: ["caller", "helper"],
		name: "ordinary caller",
		policy: {},
	},
	{
		all: false,
		caller: "caller",
		expected: ["internal"],
		name: "explicit allow overrides hidden",
		policy: { allow: ["internal"] },
	},
	{
		all: false,
		caller: "caller",
		expected: ["caller", "internal"],
		name: "allow self",
		policy: { allow: ["#self", "internal"] },
	},
	{
		all: false,
		caller: "caller",
		expected: ["helper"],
		name: "deny self",
		policy: { deny: ["#self"] },
	},
	{
		all: false,
		caller: "caller",
		expected: ["caller"],
		name: "deny named kind",
		policy: { deny: ["helper"] },
	},
	{ all: false, caller: "caller", expected: [], name: "empty allow", policy: { allow: [] } },
	{
		all: false,
		caller: "caller",
		expected: ["caller", "helper"],
		name: "empty deny",
		policy: { deny: [] },
	},
	{
		all: true,
		caller: "caller",
		expected: ["caller", "helper", "internal"],
		name: "all bypasses caller and hidden",
		policy: { allow: [] },
	},
])("discovery: $name", ({ caller, policy, all, expected }) => {
	const current = { ...config, kinds: { ...config.kinds, caller: { ...base, ...policy } } };
	const options: Pick<KindOptions, "all" | "as" | "verbose"> = {
		all,
		verbose: false,
	};
	if (caller !== undefined) {
		options.as = caller;
	}
	const result = discoverKinds(current, undefined, options);
	expect(result.kinds.map((kind) => kind.name)).toEqual([...expected]);
	expect(result.kinds).toEqual(expected.map((name) => ({ description: base.description, name })));
});

test("explicit inspection reveals a hidden kind while full prompts remain opt-in", () => {
	const summary = discoverKinds(config, "internal", { all: false, verbose: false });
	expect(summary).toEqual({
		detail: "summary",
		kind: "bee_kinds",
		kinds: [{ description: base.description, name: "internal" }],
		warnings: [],
	});
	const full = discoverKinds(config, "internal", { all: false, verbose: true });
	expect(full).toEqual({
		detail: "full",
		kind: "bee_kinds",
		kinds: [
			{ configuration: { ...base, hidden: true }, description: base.description, name: "internal" },
		],
		warnings: [],
	});
});

test.each([
	{ caller: undefined, name: "missing" },
	{ caller: "missing", name: undefined },
])("unknown requested kind or caller fails visibly: $name / $caller", ({ name, caller }) => {
	const options: Pick<KindOptions, "all" | "as" | "verbose"> = { all: false, verbose: false };
	if (caller !== undefined) {
		options.as = caller;
	}
	expect(() => discoverKinds(config, name, options)).toThrow(Error);
});
