/* eslint-disable import/no-nodejs-modules -- Disposable CLI publication endpoints and executables. */
import { chmod, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";

const EXECUTABLE = 0o755;
const SUCCESS = 0;
const cli = new URL("../../src/cli.ts", import.meta.url).pathname;
const live = new URL("../../src/live.ts", import.meta.url).pathname;
const native = new URL("../../src/beads/alerts-native.ts", import.meta.url).pathname;

test(
	"live recovery clears only after native and Git publication",
	// eslint-disable-next-line max-statements -- One disposable endpoint covers publication and recovery.
	async () => {
		const root = await mkdtemp(join(tmpdir(), "beeswax-recover-"));
		const bin = join(root, "bin");
		const database = join(root, "tracker/.beads/beads.db");
		const state = join(root, "state");
		const calls = join(root, "calls");
		const conflict = join(root, "conflict");
		try {
			await mkdir(bin);
			await Bun.write(database, "fixture lock target; no actual native database");
			await Bun.write(conflict, "conflict");
			const executable = join(bin, "fixture");
			await Bun.write(
				executable,
				`#!/bin/sh
case "$0" in
 */git)
  printf '%s\\n' "$*" >> ${shellLiteral(calls)}
  case "$*" in
   "branch --show-current") printf '%s\\n' tracker/state ;;
   "config --get branch.tracker/state.remote") printf '%s\\n' origin ;;
   "config --get branch.tracker/state.merge") printf '%s\\n' refs/heads/tracker/state ;;
   "rev-parse @{upstream}"|"merge-base HEAD accepted") printf '%s\\n' accepted ;;
   "rev-parse HEAD") printf '%s\\n' local ;;
  esac ;;
 */br)
  printf 'br %s\\n' "$*" >> ${shellLiteral(calls)}
  if [ -f ${shellLiteral(conflict)} ]; then
   printf '%s\\n' 'original native stderr' >&2
   printf '%s\\n' '{"error":{"code":"SYNC_CONFLICT","message":"native conflict"}}'
   exit 6
  fi ;;
esac
`,
			);
			await chmod(executable, EXECUTABLE);
			await Promise.all(["git", "br"].map((name) => symlink("fixture", join(bin, name))));
			const driver = join(root, "recover.ts");
			// One runtime preserves the live native/Git adapters without repeated CLI import cost.
			await Bun.write(
				driver,
				`
import {runCli} from ${JSON.stringify(cli)};
import {createLiveDependencies} from ${JSON.stringify(live)};
import {createNativeAlertStore} from ${JSON.stringify(native)};
import {rm,readFile} from "node:fs/promises";
const database=${JSON.stringify(database)}, state=${JSON.stringify(state)}, calls=${JSON.stringify(calls)};
const results=[];
async function sync(flags) {
 const stdout=[],stderr=[];
 const deps={...createLiveDependencies(),stdout:text=>stdout.push(text),stderr:text=>stderr.push(text)};
 const code=await runCli(["beads","sync","--beads-db",database,...flags,"--json"],deps);
 results.push({code,stdout,stderr,document:JSON.parse(stdout.join(""))});
}
await sync([]);
const active=await createNativeAlertStore(state).observe(database);
const before=await readFile(calls,"utf8");
await sync([]);
const after=await readFile(calls,"utf8");
await rm(${JSON.stringify(conflict)});
await sync(["--recover",active.alert.id,"--writers-paused","--evidence","user authorized; writers paused; reviewed"]);
const cleared=await createNativeAlertStore(state).observe(database);
const trace=await readFile(calls,"utf8");
process.stdout.write(JSON.stringify({results,active,cleared,heldCalls:after.slice(before.length),trace}));
`,
			);
			const child = Bun.spawn([process.execPath, driver], {
				cwd: root,
				env: { ...process.env, PATH: bin, XDG_STATE_HOME: state },
				stdout: "pipe",
				stderr: "pipe",
			});
			const [stdout, stderr, code] = await Promise.all([
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
				child.exited,
			]);
			expect(code).toBe(SUCCESS);
			expect(stderr).toBe("");
			const result = JSON.parse(stdout);
			expect(result).toMatchObject({
				heldCalls: "",
				active: { alert: { state: "active" } },
				cleared: {
					alert: { state: "cleared", evidence: "user authorized; writers paused; reviewed" },
				},
				results: [
					{
						stdout: [expect.any(String)],
						stderr: [],
						document: {
							ok: false,
							reason: "tracker_sync_failed",
							native: { stderr: "original native stderr\n" },
							alert: { state: "active" },
						},
					},
					{
						stdout: [expect.any(String)],
						stderr: [],
						document: { ok: false, reason: "tracker_held" },
					},
					{
						code: SUCCESS,
						stdout: [expect.any(String)],
						stderr: [],
						document: { ok: true, kind: "tracker_published" },
					},
				],
			});
			expect(result.cleared.alert.id).toBe(result.active.alert.id);
			expect(result.trace).toContain("br sync --merge --json --db");
			expect(result.trace).toContain("br sync --flush-only --json --db");
			expect(result.trace).toContain("push origin HEAD:refs/heads/tracker/state");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	},
);

function shellLiteral(value: string): string {
	return `'${value.replaceAll("'", String.raw`'\''`)}'`;
}
