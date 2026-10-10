// eslint-disable-next-line import/no-nodejs-modules -- Real private repository, config files and owned cleanup.
import { access, mkdir, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { beadSchema, colonyResponseSchema, execute, readSpawnRequest } from "@hive/shared";
import { expect, test } from "bun:test";
import type { ColonyResponse } from "@hive/shared";
import { Database } from "bun:sqlite";
// eslint-disable-next-line import/no-nodejs-modules -- Private fixture paths.
import { join } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Private OS temporary fixture root.
import { tmpdir } from "node:os";
import { z } from "zod";

const SUCCESS = 0;
const FIRST = 0;
const ONE = 1;
const POLL_INTERVAL = 20;
const DEADLINE = 15_000;
const SMOKE_TIMEOUT = 60_000;
const COLONY = new URL("../bin/colony.ts", import.meta.url).pathname;
const BEE = new URL("../bin/bee.ts", import.meta.url).pathname;
const SECRET_MARKER = "override-secret-fixture";

test(
	"public config updates preserve captured recipes and immutable actual revisions while reset and wake restore canonical policy",
	// eslint-disable-next-line max-statements -- One real configuration lifecycle keeps historical receipts and owned teardown together.
	async () => {
		const directory = await mkdtemp(join(tmpdir(), "colony-config-"));
		const root = await realpath(directory);
		const repo = join(root, "repo");
		const state = join(root, "state");
		const socket = join(root, "daemon.sock");
		const database = join(repo, ".beads", "beads.db");
		const env = {
			...process.env,
			BD_ACTOR: "environment-actor",
			BEADS_DB: database,
			XDG_STATE_HOME: join(root, "unused"),
		};
		const run = (args: string[]) => execute(args, repo, env);
		const tracker = async (args: string[]) =>
			JSON.parse(await run(["br", ...args, "--db", database, "--actor", "smoke-seed", "--json"]));
		const client = async (args: string[]) =>
			parseCliResponse(
				await run([
					process.execPath,
					COLONY,
					...args,
					"--state",
					state,
					"--socket",
					socket,
					"--json",
				]),
			);
		const config = async (args: string[]) => {
			const result = await client(["config", ...args, "--repo", repo, "--beads-db", database]);
			if (result.kind !== "config") {
				throw new Error(JSON.stringify(result));
			}
			return result;
		};
		const operation = (kind: string) => client([kind, "--repo", repo, "--beads-db", database]);
		const request = async (title: string) => {
			const task = await tracker(["create", "--title", title, "--owner", "ct"]);
			const created = JSON.parse(
				await run([
					process.execPath,
					BEE,
					"spawn",
					"worker",
					task.id,
					"--repo",
					repo,
					"--beads-db",
					database,
					"--actor",
					"smoke-seed",
					"--json",
				]),
			);
			return {
				description: created.request.description,
				identity: created.request.assignee,
				spawn: created.request.id,
				task: task.id,
			};
		};
		const update = async (change: unknown, actor: string[] = []) => {
			const file = join(root, `${crypto.randomUUID()}.json`);
			await Bun.write(file, JSON.stringify(change));
			return config(["update", "--file", file, ...actor]);
		};
		const limits = { kind: "limits", limits: { colony: ONE, kind: ONE, kinds: {}, worktree: ONE } };
		const replacement = {
			formula: {
				argv: [join(repo, "worker.ts"), SECRET_MARKER, "{{model}}"],
				executable: process.execPath,
			},
			kind: "formula",
			name: "scripted",
		};
		const completed = async (identity: string, spawn: string) => {
			await until(`request ${identity} completed`, async () => {
				const rows = await tracker(["show", spawn]);
				return rows[FIRST].status === "closed";
			});
			return Bun.file(join(repo, `${identity}.json`)).json();
		};
		// eslint-disable-next-line unicorn/no-useless-undefined -- Lazy startup may fail before PID is returned.
		let daemonPid: number | undefined = undefined;
		let passed = false;
		try {
			await mkdir(repo);
			await run(["git", "init"]);
			await tracker(["init", "--prefix", "smoke"]);
			await writeFixture(repo);
			const captured = await request("amber-quiet-otter");
			await operation("wake");
			const initial = await client(["list"]);
			if (initial.kind !== "status") {
				throw new Error(JSON.stringify(initial));
			}
			daemonPid = initial.pid;
			const initialPolicy = await config(["show"]);
			expect(initialPolicy.active).toMatchObject({
				formulas: ["scripted"],
				// eslint-disable-next-line unicorn/no-null -- Missing canonical drone kind disables review.
				inactivityDrone: null,
				// eslint-disable-next-line unicorn/no-null -- No configured advisory inspector.
				postRunDrone: null,
				limits: { colony: 0 },
				ranking: "fifo",
			});
			await update(replacement, ["--actor", "explicit-actor"]);
			const beforeInvalid = await config(["show"]);
			const historyBeforeInvalid = await config(["history"]);
			expect(historyBeforeInvalid.history).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						actor: "explicit-actor",
						formulaName: "scripted",
						source: "formula",
					}),
				]),
			);
			await expect(
				update({
					formula: { argv: ["{{#if}}"], executable: process.execPath },
					kind: "formula",
					name: "scripted",
				}),
			).rejects.toBeInstanceOf(Error);
			await expect(
				update({
					formula: { argv: ["{{unknown}}"], executable: process.execPath },
					kind: "formula",
					name: "scripted",
				}),
			).rejects.toBeInstanceOf(Error);
			await expect(
				update({
					formula: { argv: ["{{#if cwd}}{{unknown}}{{/if}}"], executable: process.execPath },
					kind: "formula",
					name: "scripted",
				}),
			).rejects.toBeInstanceOf(Error);
			await expect(update({ kind: "recipe", model: "forbidden-change" })).rejects.toBeInstanceOf(
				Error,
			);
			expect(await config(["show"])).toEqual(beforeInvalid);
			expect(await config(["history"])).toEqual(historyBeforeInvalid);
			const applied = await update(limits);
			const first = await completed(captured.identity, captured.spawn);
			expect(first).toMatchObject({ model: "captured-model", version: SECRET_MARKER });
			const unchanged = await tracker(["show", captured.spawn]);
			expect(unchanged[FIRST].description).toBe(captured.description);
			const launch = await Bun.file(join(state, first.id, "receipt.json")).json();
			expect(launch.recipe.model).toBe("captured-model");
			expect(launch.policyRevisionId).toBe(applied.active?.revisionId);
			expect(launch.invocation).toEqual({
				argv: [join(repo, "worker.ts"), SECRET_MARKER, "captured-model"],
				executable: process.execPath,
			});
			const reset = await config(["reset", "--actor", "reset-actor"]);
			expect(reset.active).toMatchObject({ limits: { colony: 0 } });
			expect(reset.active?.revisionId).not.toBe(initialPolicy.active?.revisionId);
			expect(reset.history).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ actor: "reset-actor", source: "reset" }),
				]),
			);
			const second = await request("blue-calm-lynx");
			await update(limits);
			expect(await completed(second.identity, second.spawn)).toMatchObject({
				model: "captured-model",
				version: "canonical",
			});
			await update(replacement, ["--actor", "second-override"]);
			await operation("sleep");
			const asleep = await config(["show"]);
			expect(asleep.active).toBeNull();
			const third = await request("green-kind-bear");
			await operation("wake");
			const rewoken = await config(["show"]);
			expect(rewoken.active).toMatchObject({ limits: { colony: 0 } });
			expect(rewoken.active?.revisionId).not.toBe(reset.active?.revisionId);
			await update(limits);
			expect(await completed(third.identity, third.spawn)).toMatchObject({
				model: "captured-model",
				version: "canonical",
			});
			const history = await config(["history"]);
			expect(history.history).toEqual(expect.arrayContaining(historyBeforeInvalid.history));
			expect(history.history).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ actor: "environment-actor", source: "limits" }),
				]),
			);
			expect(JSON.stringify(history)).not.toContain(SECRET_MARKER);
			expect(JSON.stringify(history)).not.toContain("argv");
			expect(JSON.stringify(applied)).not.toContain(SECRET_MARKER);
			expect(JSON.stringify(rewoken)).not.toContain(SECRET_MARKER);
			const durable = new Database(join(state, "colony.sqlite"), { readonly: true });
			try {
				const row = durable
					.query(
						"SELECT attempts.snapshot AS attempt, policy_revisions.snapshot AS policy, policy_revisions.metadata AS metadata FROM attempts JOIN policy_revisions ON policy_revisions.id = json_extract(attempts.snapshot, '$.policyRevisionId') WHERE attempts.id = ?",
					)
					.get(first.id);
				const joined = z
					.object({ attempt: z.string(), metadata: z.string(), policy: z.string() })
					.parse(row);
				expect(JSON.parse(joined.attempt)).toMatchObject({
					policyRevisionId: applied.active?.revisionId,
					recipe: readSpawnRequest(beadSchema.parse(unchanged[FIRST])).recipe,
				});
				expect(JSON.parse(joined.policy)).toMatchObject({
					formulas: { scripted: replacement.formula },
					limits: limits.limits,
				});
				expect(JSON.parse(joined.metadata)).toMatchObject({
					actor: "environment-actor",
					id: applied.active?.revisionId,
					source: "limits",
				});
			} finally {
				durable.close();
			}

			passed = true;
		} catch (error) {
			throw new Error(`Config smoke artifacts retained at ${root}`, { cause: error });
		} finally {
			try {
				await cleanupDaemon(socket, daemonPid);
			} finally {
				await cleanupWorkers(state);
			}
			if (passed) {
				await rm(root, { force: true, recursive: true });
			}
		}
	},
	SMOKE_TIMEOUT,
);

// --- Private functions ---
async function writeFixture(repo: string): Promise<void> {
	await Bun.write(
		join(repo, ".hive", "bees.toml"),
		`owner="ct"
humans=["ct"]
ranking="fifo"
[limits]
colony=0
[kinds.worker]
description = "Implement the linked task beads and verify their outcomes."
harness="scripted"
model="captured-model"
effort="low"
prompt="fixture"
[formulas.scripted]
executable=${JSON.stringify(process.execPath)}
argv=[${JSON.stringify(join(repo, "worker.ts"))},"canonical","{{model}}"]
`,
	);
	await Bun.write(
		join(repo, "worker.ts"),
		`
const repo=${JSON.stringify(repo)};
const id=process.env.HIVE_ATTEMPT_ID;
const receipt=await Bun.file(process.env.HIVE_COLONY_STATE+"/"+id+"/receipt.json").json();
await Bun.write(repo+"/"+process.env.HIVE_AGENT_NAME+".json",JSON.stringify({id,model:process.argv[3],version:process.argv[2]}));
const child=Bun.spawn(["br","close",...receipt.taskIds,"--actor",process.env.BD_ACTOR,"--db",process.env.BEADS_DB,"--json"],{stdout:"ignore",stderr:"inherit"});
if(await child.exited!==0)throw new Error("Fixture completion failed");
`,
	);
}

async function until(label: string, condition: () => Promise<boolean>): Promise<void> {
	const deadline = Date.now() + DEADLINE;
	/* eslint-disable no-await-in-loop -- Bounded polling yields only while an observable condition is unmet. */
	while (!(await condition())) {
		if (Date.now() >= deadline) {
			throw new Error(`Timed out waiting for ${label}`);
		}
		await Bun.sleep(POLL_INTERVAL);
	}
	/* eslint-enable no-await-in-loop */
}

function alive(pid: number): boolean {
	try {
		process.kill(pid, SUCCESS);
		return true;
	} catch {
		return false;
	}
}

// eslint-disable-next-line max-statements -- Identify and stop only the server bound to the private test socket, including failed wake startup.
async function cleanupDaemon(socket: string, knownPid: number | undefined): Promise<void> {
	let pid = knownPid;
	try {
		const exists = await access(socket).then(
			() => true,
			() => false,
		);
		if (exists) {
			const request = async (kind: "status" | "stop") => {
				const response = await fetch("http://localhost/", {
					body: JSON.stringify({ kind }),
					method: "POST",
					signal: AbortSignal.timeout(DEADLINE),
					unix: socket,
				});
				return colonyResponseSchema.parse(await response.json());
			};
			const current = await request("status");
			if (current.kind !== "status") {
				throw new Error(`Cannot identify owned daemon at ${socket}: ${JSON.stringify(current)}`);
			}
			({ pid } = current);
			const stopped = await request("stop");
			if (stopped.kind !== "stopped") {
				throw new Error(`Cannot stop owned daemon at ${socket}: ${JSON.stringify(stopped)}`);
			}
			await until("private daemon cleanup", () => Promise.resolve(!alive(current.pid)));
		}
	} finally {
		if (pid !== undefined && alive(pid)) {
			process.kill(pid, "SIGTERM");
			const ownedPid = pid;
			await until("terminated private daemon", () => Promise.resolve(!alive(ownedPid)));
		}
	}
}

async function cleanupWorkers(state: string): Promise<void> {
	const entries = await readdir(state, { withFileTypes: true }).catch(() => []);
	await Promise.all(
		entries
			.filter((entry) => entry.isDirectory())
			.map(async (entry) => {
				const file = Bun.file(join(state, entry.name, "worker.json"));
				if (!(await file.exists())) {
					return;
				}
				const worker = await file.json();
				for (const pid of [worker.harnessPid, worker.supervisorPid]) {
					if (typeof pid === "number" && alive(pid)) {
						process.kill(pid, "SIGTERM");
					}
				}
			}),
	);
}

function parseCliResponse(output: string): ColonyResponse {
	const { ok, ...response } = JSON.parse(output);
	expect(ok).toBe(true);
	return colonyResponseSchema.parse(response);
}
