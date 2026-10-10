// eslint-disable-next-line import/no-nodejs-modules -- Disposable executable boundary fixtures.
import { chmod, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { expect, test } from "bun:test";
// eslint-disable-next-line import/no-nodejs-modules -- Fixture paths.
import { join } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Isolated temporary directory.
import { tmpdir } from "node:os";

const SUCCESS = 0;
const EXECUTABLE = 0o755;
const publisher = new URL("beads-publish.ts", import.meta.url).pathname;

test.each([
	{ conflict: "git", notifyExit: 0, unmerged: ".beads/issues.jsonl" },
	{ conflict: "native", notifyExit: 0, unmerged: "" },
	{ conflict: "native", notifyExit: 1, unmerged: "" },
	{ conflict: "native merge", notifyExit: 0, unmerged: "" },
])(
	"publisher delivers $conflict conflict via stdin and retains failure with notifier exit $notifyExit",
	// eslint-disable-next-line max-statements -- Exercise the real CLI and notifier subprocess contract in one private fixture.
	async ({ conflict, notifyExit, unmerged }) => {
		const temporary = await mkdtemp(join(tmpdir(), "beads-notify-"));
		const root = await realpath(temporary);
		const bin = join(root, "bin");
		const tracker = join(root, "tracker");
		const database = join(tracker, ".beads/beads.db");
		const body = join(root, "notification");
		try {
			await mkdir(bin);
			await mkdir(join(tracker, ".beads"), { recursive: true });
			await Bun.write(database, "test database lock target");
			await executable(
				bin,
				"mise",
				`console.log(JSON.stringify({BEADS_DB:${JSON.stringify(database)}}));`,
			);
			await executable(
				bin,
				"git",
				`
const args = process.argv.slice(2).join(" ");
const outputs = {
 "branch --show-current":"tracker/state",
 "config --get branch.tracker/state.remote":"origin",
 "config --get branch.tracker/state.merge":"refs/heads/tracker/state",
 "diff --name-only --diff-filter=U":${JSON.stringify(unmerged)}
};
process.stdout.write(outputs[args] ?? "");`,
			);
			await executable(
				bin,
				"br",
				`
if (!process.argv.includes("--json")) throw new Error("structured diagnostics required");
console.error("original native stderr");
const nativeMerge = ${JSON.stringify(conflict === "native merge")};
const error = nativeMerge ? {code:"CONFIG_ERROR",message:"Configuration error: Merge conflicts detected:\\n  - hv-a: BothModified\\n"} : {code:"SYNC_CONFLICT",message:"original native sync conflict"};
console.log(JSON.stringify({error}));
process.exit(6);`,
			);
			await executable(
				bin,
				"cc-notify",
				`
await Bun.write(${JSON.stringify(body)}, process.argv.slice(2).join(" ")+"\\n"+await Bun.stdin.text());
process.exit(${notifyExit});`,
			);
			const child = Bun.spawn([process.execPath, publisher], {
				cwd: root,
				env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
				stderr: "pipe",
				stdout: "pipe",
			});
			const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
			const alert = await Bun.file(body).text();
			expect(code).not.toBe(SUCCESS);
			expect(alert).toContain("Beads conflict\nBeads conflict stopped bun run beads:sync.");
			expect(alert).toContain(`Repository: ${root}`);
			expect(alert).toContain(`Tracker: ${database}`);
			expect(alert).toContain("Host:");
			expect(alert).toContain("Action:");
			if (conflict === "git") {
				expect(stderr).toContain("BEADS CONFLICT: unresolved tracker merge: .beads/issues.jsonl");
			} else {
				if (conflict === "native merge") {
					expect(alert).toContain("Merge conflicts detected:");
					expect(stderr).toContain("CONFIG_ERROR: Configuration error: Merge conflicts detected:");
				} else {
					expect(stderr).toContain("SYNC_CONFLICT: original native sync conflict");
				}
				expect(stderr).toContain("original native stderr");
			}
			if (notifyExit !== SUCCESS) {
				expect(stderr).toContain(
					"Beads conflict notification failed: Error: cc-notify failed with exit 1",
				);
			}
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	},
);

async function executable(bin: string, name: string, source: string): Promise<void> {
	const path = join(bin, name);
	await Bun.write(path, `#!${process.execPath}\n${source}\n`);
	await chmod(path, EXECUTABLE);
}
