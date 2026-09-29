import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FZF_MODULE = join(import.meta.dir, "../../src/fzf.ts");

describe("fzf", () => {
	let bin: string;

	beforeEach(() => {
		bin = mkdtempSync(join(tmpdir(), "honeycomb-fzf-test-"));
	});

	afterEach(() => {
		rmSync(bin, { recursive: true, force: true });
	});

	/**
	 * Run fzf() in a child Bun whose PATH starts with a stub fzf that records its
	 * arguments, echoes the first input line, and exits with exitCode. The child
	 * prints the selection, or the thrown error's name and message.
	 */
	const runWithStub = async (exitCode: number) => {
		writeFileSync(
			join(bin, "fzf"),
			`#!/bin/sh\nprintf '%s\\n' "$@" > "${join(bin, "args")}"\nhead -n 1\nexit ${exitCode}\n`,
		);
		chmodSync(join(bin, "fzf"), 0o755);
		const script = `
			const { fzf } = await import(${JSON.stringify(FZF_MODULE)});
			try {
				process.stdout.write(await fzf(["/a\\tfirst", "/b\\tsecond"], { delimiter: "\\t", withNth: "2.." }));
			} catch (error) {
				process.stdout.write(error.name + ": " + error.message);
			}
		`;
		const proc = Bun.spawn([process.execPath, "-e", script], {
			env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
			stdout: "pipe",
		});
		const output = await new Response(proc.stdout).text();
		await proc.exited;
		return output;
	};

	test("returns the selected line and passes options as flags", async () => {
		expect(await runWithStub(0)).toBe("/a\tfirst");
		expect(await Bun.file(join(bin, "args")).text()).toBe("--delimiter\n\t\n--with-nth\n2..\n");
	});

	test.each([1, 130])("exit %d cancels", async (exitCode) => {
		expect(await runWithStub(exitCode)).toBe("PickerCancelled: cancelled");
	});

	test("other exit statuses fail", async () => {
		expect(await runWithStub(2)).toBe("HoneycombError: fzf failed (exit 2)");
	});
});
