import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../../..");
const nuModule = join(repoRoot, "nu/honeycomb/mod.nu");

describe("wk nushell smoke", () => {
	let tmp: string;
	let env: Record<string, string | undefined>;
	let argsFile: string;
	let cdFileCapture: string;
	let target: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "wk-smoke-"));
		const binDir = join(tmp, "bin");
		mkdirSync(binDir, { recursive: true });
		writeFileSync(join(binDir, "honeycomb"), stubScript(), { mode: 0o755 });
		target = realpathSync(mkdtempSync(join(tmp, "target-")));
		argsFile = join(tmp, "args");
		cdFileCapture = join(tmp, "cd-file-capture");
		const baseEnv = { ...process.env };
		delete baseEnv.TMUX;
		delete baseEnv.TMUX_PANE;
		env = {
			...baseEnv,
			HOME: tmp,
			XDG_CONFIG_HOME: join(tmp, "xdg-config"),
			PATH: `${binDir}:${process.env.PATH ?? ""}`,
			FAKE_ARGS_FILE: argsFile,
			FAKE_CDFILE_FILE: cdFileCapture,
		};
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	test("wk hands honeycomb's cd directive to the shell and deletes the file", async () => {
		env.FAKE_CD_TARGET = target;
		env.FAKE_EXIT_CODE = "0";

		const result = await runRaw(
			[
				"nu",
				"-c",
				`use ${nuString(nuModule)} *; wk add feature/smoke --base-current --force; print $"pwd=($env.PWD)"`,
			],
			env,
		);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain(`pwd=${target}`);
		expect(result.stdout).toContain("stub stdout");
		expect(result.stderr).toContain("stub stderr");
		expect(readFileSync(argsFile, "utf8").trimEnd().split("\n")).toEqual([
			"--interactive",
			"add",
			"--branch",
			"feature/smoke",
			"--base-current",
			"--force",
		]);
		const cdFile = readFileSync(cdFileCapture, "utf8");
		expect(cdFile).not.toBe("");
		expect(existsSync(cdFile)).toBe(false);
	});

	test("wk propagates honeycomb's exit code and still deletes the cd file", async () => {
		env.FAKE_CD_TARGET = target;
		env.FAKE_EXIT_CODE = "7";

		const result = await runRaw(["nu", "-c", `use ${nuString(nuModule)} *; wk remove --self`], env);

		expect(result.exitCode).toBe(7);
		expect(result.stdout).toContain("stub stdout");
		expect(result.stderr).toContain("stub stderr");
		expect(readFileSync(argsFile, "utf8").trimEnd().split("\n")).toEqual([
			"--interactive",
			"remove",
			"--self",
		]);
		const cdFile = readFileSync(cdFileCapture, "utf8");
		expect(existsSync(cdFile)).toBe(false);
	});
});

function stubScript() {
	return `#!/usr/bin/env bash
printf '%s\\n' "$@" > "$FAKE_ARGS_FILE"
printf '%s' "$HONEYCOMB_CD_FILE" > "$FAKE_CDFILE_FILE"
if [[ -n "$FAKE_CD_TARGET" ]]; then
	printf '%s' "$FAKE_CD_TARGET" > "$HONEYCOMB_CD_FILE"
fi
printf 'stub stdout\\n'
printf 'stub stderr\\n' >&2
exit "\${FAKE_EXIT_CODE:-0}"
`;
}

async function runRaw(cmd: string[], env: Record<string, string | undefined>) {
	const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", env });
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { stdout, stderr, exitCode };
}

function nuString(value: string) {
	return JSON.stringify(value);
}
