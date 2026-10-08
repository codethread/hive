import { CommandError, beadSchema, execute, parseBeesConfig } from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Own a disposable native tracker and executable failure boundary.
import { chmod, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { expect, test } from "bun:test";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve owned fixture paths.
import { join } from "node:path";
import { openStore } from "./store.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Isolated real IO fixture root.
import { tmpdir } from "node:os";

const TIMEOUT = 30_000;
const FIRST = 0;
const ONE = 1;
const EXECUTABLE_MODE = 0o755;
const BEE = new URL("../bin/bee.ts", import.meta.url).pathname;

test(
	"native publication failures preserve provenance and recover through repeat commands and reopened runtime checkpoints",
	// eslint-disable-next-line max-statements -- One native boundary fixture exercises ordered writes and restart recovery without live workers.
	async () => {
		const temporary = await mkdtemp(join(tmpdir(), "bee-labels-"));
		const root = await realpath(temporary);
		const repo = join(root, "repo");
		const state = join(root, "state");
		const bin = join(root, "bin");
		const database = join(repo, ".beads", "beads.db");
		const fault = join(root, "fault.json");
		const realBr = Bun.which("br");
		if (!realBr) {
			throw new Error("Native br required for request label smoke");
		}
		const env = {
			...process.env,
			BD_ACTOR: "smoke-seed",
			BEADS_DB: database,
			PATH: `${bin}:${process.env.PATH}`,
		};
		const run = (args: string[]) => execute(args, repo, env);
		const br = async (args: string[]) =>
			JSON.parse(await run([realBr, ...args, "--db", database, "--actor", "smoke-seed", "--json"]));
		const show = async (id: string) => {
			const rows = await br(["show", id]);
			return beadSchema.parse(rows[FIRST]);
		};
		const bee = async (args: string[]) =>
			JSON.parse(
				await run([
					process.execPath,
					BEE,
					...args,
					"--repo",
					repo,
					"--beads-db",
					database,
					"--json",
				]),
			);
		const task = async (title: string) => {
			const created = await br(["create", "--title", title, "--owner", "ct"]);
			return created.id as string;
		};
		const spawn = async (id: string) => {
			const created = await bee(["spawn", "worker", id]);
			return created.request.id as string;
		};
		const fail = (id: string, operation = "labels") =>
			Bun.write(fault, JSON.stringify({ id, operation, writes: 0 }));
		const clear = () => rm(fault);
		const labels = async (id: string) => {
			const bead = await show(id);
			return bead.labels.filter((label) => label.startsWith("bee-")).toSorted();
		};
		const replacementIds = async (id: string) => {
			const bead = await show(id);
			return bead.dependents
				.filter((edge) => edge.dependency_type === "supersedes")
				.map((edge) => edge.id);
		};
		const pass = () => run([process.execPath, join(root, "pass.ts")]);
		const failedRequest = async (taskId: string) => {
			const id = await spawn(taskId);
			await br(["close", id, "--reason", "exhausted"]);
			await bee(["stop", id]);
			return id;
		};
		try {
			await Promise.all([repo, state, bin].map((path) => mkdir(path)));
			await run(["git", "init"]);
			await br(["init", "--prefix", "smoke"]);
			await writeFixture({ bin, fault, realBr, repo, root, state });
			const unfinished = await task("Unfinished work");
			const original = await failedRequest(unfinished);
			await br(["update", original, "--add-label", "area:colony"]);
			expect(await labels(original)).toEqual(["bee-outcome:failed", "bee-resolution:unresolved"]);
			await fail(original, "create");
			await expect(bee(["retry", original])).rejects.toBeInstanceOf(CommandError);
			expect(await replacementIds(original)).toEqual([]);
			expect(await labels(original)).toEqual(["bee-outcome:failed", "bee-resolution:unresolved"]);
			await fail(original);
			const failure = await commandFailure(() => bee(["retry", original]));
			const syncConflict = await Bun.file(fault).json();
			expect(syncConflict.writes).toBe(ONE);
			const replacements = await replacementIds(original);
			expect(replacements).toHaveLength(ONE);
			expect(failure).toMatchObject({
				ok: false,
				reason: "request_labels_pending",
				replacementIds: replacements,
				requestId: original,
			});
			const partial = await bee(["status", original]);
			expect(partial.request).toMatchObject({
				disposition: { outcome: "failed", resolution: "resolved" },
				labelPublication: "pending",
				needsAttention: false,
			});
			expect(await labels(replacements[FIRST]!)).toEqual([
				"bee-outcome:pending",
				"bee-resolution:unresolved",
			]);
			await expect(bee(["retry", original])).rejects.toBeInstanceOf(CommandError);
			expect(await replacementIds(original)).toEqual(replacements);
			await clear();
			await expect(bee(["retry", original])).rejects.toBeInstanceOf(CommandError);
			expect(await labels(original)).toEqual(["bee-outcome:failed", "bee-resolution:resolved"]);
			const repaired = await show(original);
			expect(repaired.labels).toContain("area:colony");
			await bee(["stop", original]);
			expect(await show(original)).toEqual(repaired);
			await bee(["stop", replacements[FIRST]!]);
			expect(await labels(replacements[FIRST]!)).toEqual([
				"bee-outcome:cancelled",
				"bee-resolution:resolved",
			]);

			const second = await failedRequest(unfinished);
			await fail(second);
			await expect(bee(["retry", second])).rejects.toBeInstanceOf(CommandError);
			const [stoppedReplacement] = await replacementIds(second);
			await br(["close", stoppedReplacement!, "--reason", "Operator cancelled before wake"]);
			await clear();
			await pass();
			expect(await labels(second)).toEqual(["bee-outcome:failed", "bee-resolution:resolved"]);
			expect(await labels(stoppedReplacement!)).toEqual([
				"bee-outcome:cancelled",
				"bee-resolution:resolved",
			]);

			const unreadable = await failedRequest(unfinished);
			await fail(unreadable, "read");
			const readFailure = await commandFailure(() => bee(["retry", unreadable]));
			const afterReadFailure = await replacementIds(unreadable);
			expect(readFailure).toMatchObject({
				reason: "request_labels_pending",
				replacementIds: afterReadFailure,
				requestId: unreadable,
			});
			expect(afterReadFailure).toHaveLength(ONE);
			await clear();
			await pass();
			expect(await labels(unreadable)).toEqual(["bee-outcome:failed", "bee-resolution:resolved"]);
			await bee(["stop", afterReadFailure[FIRST]!]);

			const completedTask = await task("Already complete");
			await br(["close", completedTask]);
			const completed = await spawn(completedTask);
			await fail(completed);
			await expect(pass()).rejects.toBeInstanceOf(CommandError);
			expect(await show(completed)).toMatchObject({ close_reason: "completed", status: "closed" });
			expect(await labels(completed)).toEqual(["bee-outcome:pending", "bee-resolution:unresolved"]);
			const interrupted = openStore(state);
			try {
				expect(interrupted.requests(repo).find(({ id }) => id === completed)).toMatchObject({
					context: { outcome: "completed" },
					state: "settling",
				});
			} finally {
				interrupted.close();
			}
			await clear();
			await pass();
			expect(await labels(completed)).toEqual(["bee-outcome:succeeded", "bee-resolution:resolved"]);
			const recovered = openStore(state);
			try {
				expect(recovered.requests(repo).find(({ id }) => id === completed)).toMatchObject({
					context: { outcome: "completed" },
					state: "terminal",
				});
			} finally {
				recovered.close();
			}
			const settled = await show(completed);
			await pass();
			expect(await show(completed)).toEqual(settled);

			const cancelled = await spawn(unfinished);
			await fail(cancelled);
			const stopped = await commandFailure(() => bee(["stop", cancelled]));
			expect(stopped).toMatchObject({
				reason: "request_labels_pending",
				replacementIds: [],
				requestId: cancelled,
			});
			await clear();
			await bee(["stop", cancelled]);
			expect(await labels(cancelled)).toEqual(["bee-outcome:cancelled", "bee-resolution:resolved"]);

			const drifted = await spawn(unfinished);
			await br(["close", drifted, "--reason", "exhausted"]);
			await Bun.write(
				fault,
				JSON.stringify({
					commands: [
						[
							"create",
							"--title",
							"Concurrent replacement",
							"--owner",
							"ct",
							"--deps",
							"supersedes:$id",
						],
					],
					id: drifted,
					operation: "race",
					writes: 0,
				}),
			);
			const driftFailure = await commandFailure(() => bee(["stop", drifted]));
			expect(driftFailure).toMatchObject({
				reason: "request_labels_pending",
				replacementIds: await replacementIds(drifted),
				requestId: drifted,
			});
			expect(await labels(drifted)).toEqual(["bee-outcome:failed", "bee-resolution:unresolved"]);
			const drift = await Bun.file(fault).json();
			expect(drift.writes).toBe(ONE);
			await clear();
			await bee(["stop", drifted]);
			expect(await labels(drifted)).toEqual(["bee-outcome:failed", "bee-resolution:resolved"]);
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	},
	TIMEOUT,
);

test.each([
	{
		commands: [["update", "$id", "--set-labels", "$labels"]],
		name: "accepts an identical publication by another writer",
		succeeds: true,
		unrelatedLabels: ["area:old"],
		writes: 1,
	},
	{
		commands: [
			[
				"update",
				"$id",
				"--add-label",
				"area:new",
				"--remove-label",
				"area:old",
				"--append-notes",
				"Intervening note",
			],
		],
		name: "rebases once onto unrelated label and notes edits",
		succeeds: true,
		unrelatedLabels: ["area:new"],
		writes: 2,
	},
	{
		commands: [
			["update", "$id", "--append-notes", "Intervening note"],
			["update", "$id", "--set-labels", "$labels"],
		],
		name: "accepts convergence after the second write conflicts",
		succeeds: true,
		unrelatedLabels: ["area:old"],
		writes: 2,
	},
	{
		commands: [
			["update", "$id", "--append-notes", "Intervening note"],
			["update", "$id", "--append-notes", "Another edit"],
			["update", "$id", "--append-notes", "Must not run"],
		],
		name: "stops after two writes when revisions keep changing",
		succeeds: false,
		unrelatedLabels: ["area:old"],
		writes: 2,
	},
	{
		commands: [["update", "$id", "--assignee", ""]],
		name: "refuses a refreshed request whose identity was removed",
		succeeds: false,
		unrelatedLabels: ["area:old"],
		writes: 1,
	},
])(
	"native label publication $name",
	// eslint-disable-next-line max-statements -- Deterministic competing native writes share one disposable CLI fixture per scenario.
	async ({ commands, succeeds, writes, unrelatedLabels }) => {
		const temporary = await mkdtemp(join(tmpdir(), "bee-label-race-"));
		const root = await realpath(temporary);
		const repo = join(root, "repo");
		const bin = join(root, "bin");
		const state = join(root, "state");
		const database = join(repo, ".beads", "beads.db");
		const fault = join(root, "fault.json");
		const realBr = Bun.which("br");
		if (!realBr) {
			throw new Error("Native br required for request label smoke");
		}
		const env = {
			...process.env,
			BD_ACTOR: "smoke-seed",
			BEADS_DB: database,
			PATH: `${bin}:${process.env.PATH}`,
		};
		const run = (args: string[]) => execute(args, repo, env);
		const br = async (args: string[]) =>
			JSON.parse(await run([realBr, ...args, "--actor", "smoke-seed", "--db", database, "--json"]));
		const bee = async (args: string[]) =>
			JSON.parse(
				await run([
					process.execPath,
					BEE,
					...args,
					"--repo",
					repo,
					"--beads-db",
					database,
					"--json",
				]),
			);
		try {
			await Promise.all([repo, bin, state].map((path) => mkdir(path)));
			await run(["git", "init"]);
			await br(["init", "--prefix", "smoke"]);
			await writeFixture({ bin, fault, realBr, repo, root, state });
			const task = await br(["create", "--title", "Unfinished work", "--owner", "ct"]);
			const created = await bee(["spawn", "worker", task.id]);
			const original = created.request.id;
			await br(["close", original, "--reason", "exhausted"]);
			await br(["update", original, "--add-label", "area:old"]);
			await Bun.write(
				fault,
				JSON.stringify({ commands, id: original, operation: "race", writes: 0 }),
			);
			const retry = () => bee(["retry", original]);
			let invoke = retry;
			if (!succeeds) {
				invoke = () => commandFailure(retry);
			}
			const result = await invoke();
			const [published] = await br(["show", original]);
			const replacements = published.dependents
				.filter((edge: { dependency_type: string }) => edge.dependency_type === "supersedes")
				.map((edge: { id: string }) => edge.id);
			expect(replacements).toHaveLength(ONE);
			const observed = await Bun.file(fault).json();
			expect(observed.writes).toBe(writes);
			expect(published.labels.filter((label: string) => label.startsWith("area:"))).toEqual(
				unrelatedLabels,
			);
			if (writes > ONE) {
				expect(published.notes).toContain("Intervening note");
				expect(published.notes).not.toContain("Must not run");
			}
			if (succeeds) {
				expect(result).toMatchObject({
					kind: "spawn_created",
					request: { id: replacements[FIRST] },
				});
				expect(published.labels.filter((label: string) => label.startsWith("bee-"))).toEqual([
					"bee-outcome:failed",
					"bee-resolution:resolved",
				]);
				await run([process.execPath, join(root, "pass.ts")]);
				const store = openStore(state);
				try {
					expect(store.requests(repo).find(({ id }) => id === replacements[FIRST])).toMatchObject({
						state: "waiting",
					});
				} finally {
					store.close();
				}
			} else {
				expect(result).toMatchObject({
					reason: "request_labels_pending",
					replacementIds: replacements,
					requestId: original,
				});
				expect(published.labels.filter((label: string) => label.startsWith("bee-"))).toEqual([
					"bee-outcome:pending",
					"bee-resolution:unresolved",
				]);
			}
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	},
	TIMEOUT,
);

// --- Private functions ---
async function commandFailure(command: () => Promise<unknown>): Promise<unknown> {
	try {
		await command();
	} catch (error) {
		expect(error).toBeInstanceOf(CommandError);
		return JSON.parse((error as CommandError).stdout);
	}
	throw new Error("Expected a failing command");
}

async function writeFixture(input: {
	bin: string;
	fault: string;
	realBr: string;
	repo: string;
	root: string;
	state: string;
}): Promise<void> {
	const { bin, fault, realBr, repo, root, state } = input;
	await Bun.write(
		join(repo, "bees.toml"),
		`owner="ct"
humans=["ct"]
ranking="fifo"
[limits]
colony=0
[kinds.worker]
harness="fixture"
model="fixture"
effort="low"
prompt="fixture"
[formulas.fixture]
executable="/usr/bin/true"
argv=[]
`,
	);
	await Bun.write(
		join(bin, "br"),
		`#!${process.execPath}
const args=process.argv.slice(2);
const fault=Bun.file(${JSON.stringify(fault)});
const created=Bun.file(${JSON.stringify(`${fault}.created`)});
let failure;
if(await fault.exists()) {
 failure=await fault.json();
 const {id,operation}=failure;
 const labels=operation==="labels" && args[0]==="update" && args[1]===id && args.includes("--set-labels");
 const create=operation==="create" && args[0]==="create" && args.some(arg=>arg.includes("supersedes:"+id));
 const read=operation==="read" && args[0]==="show" && args[1]===id && await created.exists();
 if(labels||create||read) {
 if(labels) { failure.writes+=1; await Bun.write(fault,JSON.stringify(failure)); }
 console.log(JSON.stringify({error:{code:"SYNC_CONFLICT",message:"Injected native publication failure",context:null}}));
 process.exit(6);
 }
 if(operation==="race" && args[0]==="update" && args[1]===id && args.includes("--set-labels")) {
 failure.writes+=1;
 const command=failure.commands.shift();
 await Bun.write(fault,JSON.stringify(failure));
 if(command) {
 const labels=args[args.indexOf("--set-labels")+1];
 const mutation=command.map(arg=>arg.replaceAll("$id",id).replaceAll("$labels",labels));
 const rival=Bun.spawn([${JSON.stringify(realBr)},...mutation,"--actor","competing-publisher","--db",process.env.BEADS_DB,"--json"],{stdout:"pipe",stderr:"pipe"});
 const [stdout,stderr,code]=await Promise.all([new Response(rival.stdout).text(),new Response(rival.stderr).text(),rival.exited]);
 if(code!==0)throw new Error(stdout+stderr);
 }
 }
}
const child=Bun.spawn([${JSON.stringify(realBr)},...args],{stdin:"inherit",stdout:"inherit",stderr:"inherit"});
const code=await child.exited;
if(code===0 && failure?.operation==="read" && args[0]==="create" && args.some(arg=>arg.includes("supersedes:"+failure.id)))await Bun.write(created,"created");
process.exit(code);
`,
	);
	await chmod(join(bin, "br"), EXECUTABLE_MODE);
	const config = parseBeesConfig(await Bun.file(join(repo, "bees.toml")).text());
	await Bun.write(
		join(root, "pass.ts"),
		`
import {dispatch} from ${JSON.stringify(new URL("dispatch.ts", import.meta.url).pathname)};
import {openStore} from ${JSON.stringify(new URL("store.ts", import.meta.url).pathname)};
const root=${JSON.stringify(repo)};
const state=${JSON.stringify(state)};
const store=openStore(state);
try {
 await dispatch({repository:{root,beadsDb:root+"/.beads/beads.db"},state,store},${JSON.stringify(config)},"fixture");
} finally {store.close();}
`,
	);
}
