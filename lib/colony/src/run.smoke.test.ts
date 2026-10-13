import { expect, test } from "bun:test";

const BEE = new URL("../bin/bee.ts", import.meta.url).pathname;
const SUCCESS = 0;
const EMPTY = 0;

test.each([
	{ args: ["run", "librarian"] },
	{ args: ["run", "librarian", "--json"] },
	{ args: ["--json", "run", "librarian"] },
	{ args: ["run", "librarian", "extra-task"] },
	{ args: ["run", "librarian", "--cwd", "/tmp"] },
])("bee run refuses missing terminals and incompatible CLI inputs: %j", async ({ args }) => {
	const child = Bun.spawn([process.execPath, BEE, ...args], {
		env: { ...process.env, BEADS_DB: undefined },
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const [code, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	expect(code).not.toBe(SUCCESS);
	if (args.some((argument) => argument === "--json")) {
		expect(JSON.parse(stdout)).toMatchObject({ ok: false });
		expect(stderr).toBe("");
	} else {
		expect(stdout).toBe("");
		expect(stderr.length).toBeGreaterThan(EMPTY);
	}
});
