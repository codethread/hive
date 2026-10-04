// eslint-disable-next-line import/no-nodejs-modules -- Real private repositories, executable boundary wrapper, and owned cleanup.
import { access, chmod, mkdir, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { colonyResponseSchema, execute } from "@hive/shared";
import { expect, test } from "bun:test";
import type { ColonyResponse } from "@hive/shared";
import { Database } from "bun:sqlite";
// eslint-disable-next-line import/no-nodejs-modules -- Private fixture paths.
import { join } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Private OS temporary fixture root.
import { tmpdir } from "node:os";

const SUCCESS = 0;
const FIRST = 0;
const ONE = 1;
const TWO = 2;
const NONE = 0;
const EXECUTABLE_MODE = 0o755;
const ATTEMPTS = 4;
const POLL_INTERVAL = 20;
const DEADLINE = 15_000;
const SMOKE_TIMEOUT = 90_000;
const COLONY = new URL("../bin/colony.ts", import.meta.url).pathname;
const BEE = new URL("../bin/bee.ts", import.meta.url).pathname;

test(
	"real retry budget preserves identity and claim ownership across exhaustion, completion and partial claim races",
	// eslint-disable-next-line max-statements -- One real process/tracker lifecycle shares its controlled boundary and owned teardown.
	async () => {
		const temporary = await mkdtemp(join(tmpdir(), "colony-retry-"));
		const root = await realpath(temporary);
		const repo = join(root, "repo");
		const state = join(root, "state");
		const socket = join(root, "daemon.sock");
		const bin = join(root, "bin");
		const runs = join(root, "runs");
		const realBr = Bun.which("br");
		if (!realBr) {
			throw new Error("Real br executable required for retry smoke");
		}
		const database = join(repo, ".beads", "beads.db");
		const env = {
			...process.env,
			BD_ACTOR: "smoke-seed",
			BEADS_DB: database,
			PATH: `${bin}:${process.env.PATH}`,
			XDG_STATE_HOME: join(root, "unused"),
		};
		const run = (args: string[]) => execute(args, repo, env);
		const tracker = async (args: string[]) =>
			JSON.parse(await run([realBr, ...args, "--db", database, "--actor", "smoke-seed", "--json"]));
		const task = async (title: string) => {
			const created = await tracker(["create", "--title", title, "--owner", "ct"]);
			return created.id as string;
		};
		const request = async (identity: string, tasks: string[]) => {
			await Bun.write(join(root, `${identity}.tasks.json`), JSON.stringify(tasks));
			const result = JSON.parse(
				await run([
					process.execPath,
					BEE,
					"spawn",
					"worker",
					...tasks,
					"--repo",
					repo,
					"--beads-db",
					database,
					"--actor",
					"smoke-seed",
					"--identity",
					identity,
					"--json",
				]),
			);
			return result.request.id as string;
		};
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
		const terminal = (spawn: string, reason: string) =>
			until(`spawn ${spawn} ${reason}`, async () => {
				const rows = await tracker(["show", spawn]);
				return rows[FIRST].status === "closed" && rows[FIRST].close_reason === reason;
			});
		const receipt = (identity: string, attempt: number) =>
			Bun.file(join(runs, `${identity}-${attempt}.json`));
		const release = async (identity: string, attempt: number) => {
			await until(`attempt ${identity} ${attempt}`, () => receipt(identity, attempt).exists());
			const record = await receipt(identity, attempt).json();
			expect(record).toMatchObject({ attempt, identity, pid: expect.any(Number) });
			await Bun.write(join(root, `${identity}-${attempt}.release`), "release");
			await until(`harness ${identity} ${attempt} exited`, () =>
				Promise.resolve(!alive(record.pid)),
			);
			return record;
		};
		// eslint-disable-next-line unicorn/no-useless-undefined -- Lazy startup can fail before returning a PID.
		let daemonPid: number | undefined = undefined;
		let passed = false;
		try {
			await Promise.all([repo, bin, runs].map((path) => mkdir(path)));
			await run(["git", "init"]);
			await tracker(["init", "--prefix", "smoke"]);
			await writeFixture({ bin, realBr, root });
			const sentinel = await task("Unrelated owned task");
			await tracker([
				"update",
				sentinel,
				"--assignee",
				"sentinel-owner",
				"--status",
				"in_progress",
			]);
			const unfinished = await task("Exit zero without completing");
			const exhausted = await request("amber-quiet-otter", [unfinished]);
			await client(["wake", "--repo", repo, "--beads-db", database]);
			const current = await client(["list"]);
			if (current.kind !== "status") {
				throw new Error(JSON.stringify(current));
			}
			daemonPid = current.pid;
			const records = [];
			/* eslint-disable no-await-in-loop -- Release each actual attempt only after its handshake and verified predecessor exit. */
			for (let attempt = ONE; attempt <= ATTEMPTS; attempt += ONE) {
				records.push(await release("amber-quiet-otter", attempt));
			}
			/* eslint-enable no-await-in-loop */
			await terminal(exhausted, "exhausted");
			expect(new Set(records.map((record) => record.id)).size).toBe(ATTEMPTS);
			const exhaustedTask = await tracker(["show", unfinished]);
			expect(exhaustedTask[FIRST]).toMatchObject({ status: "open" });
			expect(exhaustedTask[FIRST].assignee).toBeUndefined();
			const native = new Database(database, { readonly: true });
			try {
				const changes = native
					.query(
						"SELECT new_value FROM events WHERE issue_id = ? AND event_type = 'assignee_changed' ORDER BY id",
					)
					.all(unfinished);
				expect(changes).toEqual(
					Array.from({ length: ATTEMPTS }, () => [
						{ new_value: "amber-quiet-otter" },
						// eslint-disable-next-line unicorn/no-null -- Native SQLite records unassigned ownership as NULL.
						{ new_value: null },
					]).flat(),
				);
			} finally {
				native.close();
			}
			const completeTask = await task("Actually complete work");
			const completed = await request("blue-calm-lynx", [completeTask]);
			await release("blue-calm-lynx", ONE);
			await terminal(completed, "completed");
			const completedTask = await tracker(["show", completeTask]);
			expect(completedTask[FIRST].status).toBe("closed");
			const first = await task("Partial claim first");
			const second = await task("Partial claim raced");
			await Bun.write(join(root, "gate-tasks.json"), JSON.stringify([first, second]));
			const partial = await request("green-kind-bear", [first, second]);
			await until("second claim reached real br boundary", () =>
				Bun.file(join(root, "claim-gated")).exists(),
			);
			const gated = await Bun.file(join(root, "claim-gated")).json();
			const firstClaim = await tracker(["show", gated.first]);
			expect(firstClaim[FIRST].assignee).toBe("green-kind-bear");
			await run([
				realBr,
				"update",
				gated.second,
				"--claim",
				"--owner",
				"ct",
				"--actor",
				"competing-actor",
				"--db",
				database,
				"--json",
			]);
			await Bun.write(join(root, "allow-claim"), "continue");
			await terminal(partial, "claim_failed");
			const [released, retained, unrelated] = await Promise.all(
				[gated.first, gated.second, sentinel].map((id) => tracker(["show", id])),
			);
			expect(released[FIRST].status).toBe("open");
			expect(released[FIRST].assignee).toBeUndefined();
			expect(retained[FIRST]).toMatchObject({ assignee: "competing-actor", status: "in_progress" });
			expect(unrelated[FIRST]).toMatchObject({ assignee: "sentinel-owner", status: "in_progress" });
			expect(await receipt("green-kind-bear", ONE).exists()).toBe(false);
			expect(await receipt("blue-calm-lynx", TWO).exists()).toBe(false);
			expect(await receipt("amber-quiet-otter", ATTEMPTS + ONE).exists()).toBe(false);
			expect(await Bun.file(join(root, "released-while-alive")).exists()).toBe(false);
			const status = await client(["list"]);
			if (status.kind !== "status") {
				throw new Error(JSON.stringify(status));
			}
			expect(
				status.colonies[FIRST]?.attempts.filter((attempt) => attempt.spawnId === exhausted),
			).toHaveLength(ATTEMPTS);
			expect(
				status.colonies[FIRST]?.attempts.filter((attempt) => attempt.spawnId === completed),
			).toHaveLength(ONE);
			expect(
				status.colonies[FIRST]?.attempts.filter((attempt) => attempt.spawnId === partial),
			).toHaveLength(NONE);

			const durable = new Database(join(state, "colony.sqlite"), { readonly: true });
			try {
				const attempts = durable
					.query(
						"SELECT json_extract(snapshot, '$.attemptNumber') AS number, json_extract(snapshot, '$.identity') AS identity FROM attempts WHERE spawn_id = ? ORDER BY rowid",
					)
					.all(exhausted);
				expect(attempts).toEqual(
					Array.from({ length: ATTEMPTS }, (_value, index) => ({
						identity: "amber-quiet-otter",
						number: index + ONE,
					})),
				);
				const outcomes = durable
					.query(
						"SELECT spawn_id AS id, json_extract(snapshot, '$.state') AS state, json_extract(snapshot, '$.context.outcome') AS outcome, json_extract(snapshot, '$.context.claims') AS claims FROM requests ORDER BY rowid",
					)
					.all();
				expect(outcomes).toEqual([
					{ claims: "[]", id: exhausted, outcome: "exhausted", state: "terminal" },
					{ claims: "[]", id: completed, outcome: "completed", state: "terminal" },
					{ claims: "[]", id: partial, outcome: "claim_failed", state: "terminal" },
				]);
			} finally {
				durable.close();
			}
			passed = true;
		} catch (error) {
			throw new Error(`Retry smoke artifacts retained at ${root}`, { cause: error });
		} finally {
			await Bun.write(join(root, "allow-claim"), "cleanup");
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
async function writeFixture(input: { bin: string; realBr: string; root: string }): Promise<void> {
	const { bin, realBr, root } = input;
	await Bun.write(
		join(root, "repo", "bees.toml"),
		`owner="ct"
humans=["ct"]
ranking="fifo"
retry_delay_ms=0
[kinds.worker]
harness="fixture"
model="fixture"
effort="low"
prompt="fixture"
[formulas.fixture]
executable=${JSON.stringify(process.execPath)}
argv=[${JSON.stringify(join(root, "worker.ts"))}]
`,
	);
	await Bun.write(
		join(root, "worker.ts"),
		`
const root=${JSON.stringify(root)};
const identity=process.env.HIVE_AGENT_NAME;
const attempt=Number(process.env.HIVE_ATTEMPT_NUMBER);
const tasks=await Bun.file(root+"/"+identity+".tasks.json").json();
for(const id of tasks){
 const claim=Bun.spawn(["br","update",id,"--claim","--owner","ct","--actor",identity,"--db",process.env.BEADS_DB,"--json"],{stdout:"pipe",stderr:"pipe"});
 if(await claim.exited!==0)throw new Error(await new Response(claim.stderr).text());
}
await Bun.write(root+"/runs/"+identity+"-"+attempt+".json",JSON.stringify({attempt,id:process.env.HIVE_ATTEMPT_ID,identity,pid:process.pid,tasks}));
const deadline=Date.now()+60000;
while(!(await Bun.file(root+"/"+identity+"-"+attempt+".release").exists())){
 if(Date.now()>=deadline)throw new Error("Fixture deadline expired");
 await Bun.sleep(20);
}
if(identity==="blue-calm-lynx"){
 for(const id of tasks){
 const close=Bun.spawn(["br","close",id,"--actor",identity,"--db",process.env.BEADS_DB,"--json"],{stdout:"pipe",stderr:"pipe"});
 if(await close.exited!==0)throw new Error(await new Response(close.stderr).text());
 }
}
`,
	);
	await Bun.write(
		join(bin, "br"),
		`#!${process.execPath}
import {readdir} from "node:fs/promises";
const root=${JSON.stringify(root)};
const args=process.argv.slice(2);
const gate=Bun.file(root+"/gate-tasks.json");
let gatedTask;
const firstClaim=Bun.file(root+"/first-claim");
if(args.includes("--claim")&&await gate.exists()){
 const candidates=await gate.json();
 gatedTask=args.find((arg)=>candidates.includes(arg));
 if(gatedTask&&await firstClaim.exists()){
 await Bun.write(root+"/claim-gated",JSON.stringify({first:await firstClaim.text(),second:gatedTask}));
 const deadline=Date.now()+15000;
 while(!(await Bun.file(root+"/allow-claim").exists())){
 if(Date.now()>=deadline)throw new Error("Claim boundary deadline expired");
 await Bun.sleep(20);
 }
 }
}
if(args.includes("--assignee")&&args[args.indexOf("--assignee")+1]===""){
 for(const file of await readdir(root+"/runs")){
 const record=await Bun.file(root+"/runs/"+file).json();
 if(record.tasks.some((task)=>args.includes(task))){
 let live=false;
 try{process.kill(record.pid,0);live=true;}catch{}
 if(live){await Bun.write(root+"/released-while-alive",file);throw new Error("Release attempted while owned harness alive");}
 }
 }
}
const child=Bun.spawn([${JSON.stringify(realBr)},...args],{stdin:"inherit",stdout:"inherit",stderr:"inherit"});
const code=await child.exited;
if(code===0&&gatedTask&&!(await firstClaim.exists()))await Bun.write(root+"/first-claim",gatedTask);
process.exit(code);
`,
	);
	await chmod(join(bin, "br"), EXECUTABLE_MODE);
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
