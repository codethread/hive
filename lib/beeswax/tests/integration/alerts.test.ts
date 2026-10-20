/* eslint-disable import/no-nodejs-modules -- Disposable filesystem and process-boundary fixtures. */
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { expect, test } from "bun:test";
import { createNativeAlertStore } from "../../src/beads/alerts-native.ts";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SUCCESS = 0;
const GENERATIONS = 2;
const EXECUTABLE = 0o755;
const cli = new URL("../../src/cli.ts", import.meta.url).pathname;
const live = new URL("../../src/live.ts", import.meta.url).pathname;
const native = new URL("../../src/beads/alerts-native.ts", import.meta.url).pathname;

test(
	"durable receipts and CLI observations do not require native database, Git or br #test-282",
	// eslint-disable-next-line max-statements -- One disposable store checks serialization and native CLI observation.
	async () => {
		const root = await mkdtemp(join(tmpdir(), "beeswax-alert-"));
		const state = join(root, "state");
		const database = join(root, "missing/tracker/.beads/beads.db");
		const bin = join(root, "bin");
		try {
			await mkdir(bin);
			await Promise.all(
				["br", "git", "mise"].map(async (name) => {
					const path = join(bin, name);
					await Bun.write(path, "#!/bin/sh\nprintf 'UNEXPECTED NATIVE ACCESS' >&2\nexit 99\n");
					await chmod(path, EXECUTABLE);
				}),
			);
			const store = createNativeAlertStore(state);
			const absent = await store.observe(database);
			expect(absent.alert).toBeNull();
			await Promise.all([
				store.activate(database, "first failure"),
				createNativeAlertStore(state).activate(database, "second failure"),
			]);
			const second = await store.observe(database);
			expect(second.alert?.generation).toBe(GENERATIONS);
			await Promise.allSettled([
				store.clear(database, second.alert!.id, "previous recovery completed"),
				createNativeAlertStore(state).activate(database, "new failure during clearance"),
			]);
			const active = await store.observe(database);
			expect(active.alert?.state).toBe("active");
			expect(active.alert?.id).not.toBe(second.alert!.id);
			const driver = join(root, "observe.ts");
			// Reuse one native runtime, preserving real CLI dispatch and filesystem adapters.
			await Bun.write(
				driver,
				`
import {runCli} from ${JSON.stringify(cli)};
import {createLiveDependencies} from ${JSON.stringify(live)};
import {alertStatePath,createNativeAlertStore} from ${JSON.stringify(native)};
import {rm,mkdir} from "node:fs/promises";
const database = ${JSON.stringify(database)}, state = ${JSON.stringify(state)};
const results = [];
async function observe(command, selected=database) {
 const stdout = [], stderr = [];
 const deps = {...createLiveDependencies(), stdout:text=>stdout.push(text), stderr:text=>stderr.push(text)};
 const code = await runCli(["beads",...command,"--beads-db",selected,"--json"],deps);
 results.push({code,stdout,stderr,document:JSON.parse(stdout.join(""))});
}
await observe(["alert","status"]);
await observe(["alert","wait","--timeout","0"]);
await createNativeAlertStore(state).clear(database,${JSON.stringify(active.alert!.id)},"manual recovery verified");
await observe(["alert","status"]);
await Bun.write(alertStatePath(state,database),"corrupt");
await observe(["alert","status"]);
await rm(alertStatePath(state,database));
await mkdir(alertStatePath(state,database));
await observe(["alert","status"]);
await observe(["sync"],${JSON.stringify(join(root, "lock-missing/.beads/beads.db"))});
process.stdout.write(JSON.stringify(results));
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
			expect(JSON.parse(stdout)).toMatchObject([
				{ code: SUCCESS, stdout: [expect.any(String)], stderr: [], document: active },
				{ code: SUCCESS, stdout: [expect.any(String)], stderr: [], document: active },
				{
					code: SUCCESS,
					stdout: [expect.any(String)],
					stderr: [],
					document: { alert: { state: "cleared" } },
				},
				{
					stdout: [expect.any(String)],
					stderr: [],
					document: { ok: false, reason: "tracker_alert_invalid" },
				},
				{
					stdout: [expect.any(String)],
					stderr: [],
					document: { ok: false, reason: "tracker_alert_unavailable" },
				},
				{
					stdout: [expect.any(String)],
					stderr: [],
					document: {
						ok: false,
						reason: "tracker_sync_failed",
						alert: { state: "active", reason: expect.stringContaining("ENOENT") },
					},
				},
			]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	},
);
