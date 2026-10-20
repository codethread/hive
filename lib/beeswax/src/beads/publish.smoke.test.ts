// eslint-disable-next-line import/no-nodejs-modules -- Disposable executable boundary fixtures.
import { chmod, mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { expect, test } from "bun:test";
// eslint-disable-next-line import/no-nodejs-modules -- Fixture paths.
import { join } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Isolated temporary directory.
import { tmpdir } from "node:os";

const SUCCESS = 0;
const EXECUTABLE = 0o755;
const publicationModule = new URL("publish.ts", import.meta.url).pathname;
const environmentModule = new URL("environment.ts", import.meta.url).pathname;
const nativeModule = import.meta.resolve("@hive/beads");

test.each([
	{ conflict: "git", notifyExit: 0, unmerged: ".beads/issues.jsonl" },
	{ conflict: "native", notifyExit: 0, unmerged: "" },
	{ conflict: "native", notifyExit: 1, unmerged: "" },
	{ conflict: "native merge", notifyExit: 0, unmerged: "" },
])(
	"publisher delivers $conflict conflict via stdin and retains failure with notifier exit $notifyExit #test-205",
	// Exercise the real CLI and notifier subprocess contract in one private fixture.
	// eslint-disable-next-line max-statements
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
			let error = { code: "SYNC_CONFLICT", message: "original native sync conflict" };
			if (conflict === "native merge") {
				error = {
					code: "CONFIG_ERROR",
					message: "Configuration error: Merge conflicts detected:\n  - hv-a: BothModified\n",
				};
			}
			await executable(
				bin,
				"fixture",
				`
case "$0" in
 */mise) printf '%s\\n' ${shellLiteral(JSON.stringify({ BEADS_DB: database }))} ;;
 */git)
  case "$*" in
   "branch --show-current") printf '%s\\n' 'tracker/state' ;;
   "config --get branch.tracker/state.remote") printf '%s\\n' 'origin' ;;
   "config --get branch.tracker/state.merge") printf '%s\\n' 'refs/heads/tracker/state' ;;
   "diff --name-only --diff-filter=U") printf '%s\\n' ${shellLiteral(unmerged)} ;;
  esac ;;
 */br)
  case " $* " in
   *" --json "*) ;;
   *) printf '%s\\n' 'structured diagnostics required' >&2; exit 1 ;;
  esac
  printf '%s\\n' 'original native stderr' >&2
  printf '%s\\n' ${shellLiteral(JSON.stringify({ error }))}
  exit 6 ;;
 */cc-notify)
  { printf '%s\\n' "$*"; cat; } > ${shellLiteral(body)}
  exit ${notifyExit} ;;
esac`,
			);
			// Share one executable's first-launch cost while retaining each command's real process boundary.
			await Promise.all(
				["mise", "git", "br", "cc-notify"].map((name) => symlink("fixture", join(bin, name))),
			);
			const publisher = join(root, "publish.ts");
			await Bun.write(
				publisher,
				`
import { syncBeads, withTrackerLock } from ${JSON.stringify(publicationModule)};
import { runCommand } from ${JSON.stringify(environmentModule)};
import { createNativeBeads } from ${JSON.stringify(nativeModule)};
const environment = { BEADS_DB: ${JSON.stringify(database)} };
await withTrackerLock(environment, () => syncBeads(environment, {
 beads: createNativeBeads({ execute: runCommand }), command: runCommand,
}));
`,
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
			expect(alert).toContain("Beads conflict\nBeads conflict stopped beeswax beads sync.");
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
	// Keep real subprocess IO without starting another JS runtime for every fixture command.
	await Bun.write(path, `#!/bin/sh\n${source}\n`);
	await chmod(path, EXECUTABLE);
}

function shellLiteral(value: string): string {
	return `'${value.replaceAll("'", String.raw`'\''`)}'`;
}
