import { expect, test } from "bun:test";

const BEE = new URL("../bin/bee.ts", import.meta.url).pathname;
const SUCCESS = 0;
const EMPTY = 0;

test("bee run exits nonzero with stderr and no stdout without a terminal #test-295", async () => {
	const child = Bun.spawn([process.execPath, BEE, "run", "librarian"], {
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
	expect(stdout).toBe("");
	expect(stderr.length).toBeGreaterThan(EMPTY);
});
