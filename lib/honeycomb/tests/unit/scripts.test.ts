import { expect, test } from "bun:test";
import { generatePostCreateScript } from "../../src/domain/worktree.ts";

// The emitted shell text is a public contract consumed by the Nushell wrapper.
test.each([
	{ name: "regular", pooled: false, created: "/tmp/repo__feature", marker: "" },
	{
		name: "pooled",
		pooled: true,
		created: "/tmp/repo__feat1",
		marker: ': > "$(git -C "$WK_CREATED" rev-parse --git-path wk-pool-initialized)"\n',
	},
])("generates the $name bootstrap script", ({ pooled, created, marker }) => {
	expect(
		generatePostCreateScript({
			projectName: "app",
			root: "/tmp/repo",
			created,
			command: "echo ready",
			pooled,
		}),
	).toBe(
		`#!/usr/bin/env bash\nset -euo pipefail\nexport WK_ROOT='/tmp/repo'\nexport WK_CREATED='${created}'\necho 'project: app'\ncd "$WK_CREATED"\necho ready\n${marker}`,
	);
});

test.each([
	{ root: "/tmp/root with spaces", quoted: "'/tmp/root with spaces'" },
	{ root: "/tmp/it's a repo", quoted: "'/tmp/it'\\''s a repo'" },
])("shell-quotes $root", ({ root, quoted }) => {
	expect(
		generatePostCreateScript({
			projectName: "app",
			root,
			created: `${root}__feature`,
			command: 'echo "$WK_CREATED"',
			pooled: false,
		}),
	).toContain(`export WK_ROOT=${quoted}\n`);
});
