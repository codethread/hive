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
			Bun.write(fault, JSON.stringify({ id, operation }));
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
 if(labels||create||read) { console.error("Injected native publication failure"); process.exit(1); }
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
