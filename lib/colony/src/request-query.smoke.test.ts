import { CommandError, execute } from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Disposable native tracker and traced executable boundary.
import { chmod, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { expect, test } from "bun:test";
// eslint-disable-next-line import/no-nodejs-modules -- Owned fixture paths.
import { join } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Isolated real I/O fixture root.
import { tmpdir } from "node:os";

const FIRST = 0;
const ONE = 1;
const TIMEOUT = 30_000;
const EXECUTABLE_MODE = 0o755;
const BEE = new URL("../bin/bee.ts", import.meta.url).pathname;
const RECIPE = JSON.stringify({
	// eslint-disable-next-line unicorn/no-null -- Canonical execution directory in the native recipe.
	cwd: null,
	effort: "low",
	harness: "fixture",
	kind: "worker",
	model: "fixture",
	prompt: "Query scope fixture",
});

test(
	"Bee queries only unresolved list candidates and task-related admission candidates, retaining history and exact inspection",
	// eslint-disable-next-line max-statements -- Native command trace verifies query cost without timing or mocked tracker semantics.
	async () => {
		const temporary = await mkdtemp(join(tmpdir(), "bee-query-"));
		const root = await realpath(temporary);
		const repo = join(root, "repo");
		const bin = join(root, "bin");
		const trace = join(root, "calls.jsonl");
		const database = join(repo, ".beads", "beads.db");
		const realBr = Bun.which("br");
		if (!realBr) {
			throw new Error("Native br required for query scope smoke");
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
		const task = async (title: string): Promise<string> => {
			const created = await br(["create", "--title", title, "--owner", "ct"]);
			return created.id;
		};
		const request = async (taskId: string, reason?: string) => {
			const created = await br([
				"create",
				"--title",
				"Request",
				"--owner",
				"ct",
				"--assignee",
				"fixture-bee",
				"--description",
				RECIPE,
				"--labels",
				"system,bee,agent:worker,bee-outcome:pending,bee-resolution:unresolved",
				"--deps",
				`related:${taskId}`,
			]);
			if (reason !== undefined) {
				await br(["close", created.id, "--reason", reason]);
				await bee(["stop", created.id]);
			}
			return created.id as string;
		};
		const calls = async (): Promise<string[][]> => {
			const content = await Bun.file(trace).text();
			return content
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line));
		};
		const listing = async (args: string[] = []) => {
			await Bun.write(trace, "");
			return bee(["list", ...args]);
		};
		try {
			await Promise.all([repo, bin].map((path) => mkdir(path)));
			await run(["git", "init"]);
			await br(["init", "--prefix", "smoke"]);
			await Bun.write(
				join(bin, "br"),
				`#!${process.execPath}
import {appendFileSync} from "node:fs";
const args=Bun.argv.slice(2);
appendFileSync(${JSON.stringify(trace)},JSON.stringify(args)+"\\n");
const child=Bun.spawn([${JSON.stringify(realBr)},...args],{stdin:"inherit",stdout:"inherit",stderr:"inherit"});
process.exit(await child.exited);
`,
			);
			await chmod(join(bin, "br"), EXECUTABLE_MODE);
			const activeTask = await task("Active work");
			const historyTask = await task("Historical work");
			const hiddenTask = await task("Accepted work with unpublished labels");
			const pending = await request(activeTask);
			const failed = await request(activeTask, "blocked");
			const completed = await request(historyTask, "completed");
			const acknowledged = await request(historyTask, "exhausted");
			await bee(["ack", acknowledged, "--reason", "Handled"]);
			const partial = await request(hiddenTask, "blocked");
			const [partialBead] = await br(["show", partial]);
			await br([
				"comments",
				"add",
				partial,
				"--message",
				`Bee acknowledgment: ${JSON.stringify({ closedAt: partialBead.closed_at, reason: "Accepted before publication" })}`,
			]);

			const current = await listing();
			expect(current.requests.map(({ id }: { id: string }) => id).toSorted()).toEqual(
				[pending, failed].toSorted(),
			);
			const currentCalls = await calls();
			expect(currentCalls.filter(([command]) => command === "list")).toHaveLength(ONE);
			expect(currentCalls[FIRST]).toContain("bee-resolution:unresolved");
			expect(currentCalls.find(([command]) => command === "ready")).toContain("--brief");
			const shown = currentCalls.filter(([command]) => command === "show").map((args) => args[ONE]);
			expect(new Set(shown)).toEqual(new Set([pending, failed, partial, activeTask]));

			const history = await listing(["--all"]);
			expect(history.requests.map(({ id }: { id: string }) => id).toSorted()).toEqual(
				[pending, failed, completed, acknowledged, partial].toSorted(),
			);
			const historyCalls = await calls();
			expect(historyCalls[FIRST]).not.toContain("bee-resolution:unresolved");
			const exact = await bee(["status", partial]);
			expect(exact.request).toMatchObject({
				labelPublication: "pending",
				resolution: { kind: "acknowledged" },
				tasks: [{ id: hiddenTask }],
			});

			await bee(["stop", pending]);
			await bee(["ack", failed, "--reason", "Handled"]);
			const resolved = await listing();
			expect(resolved.requests).toEqual([]);
			const resolvedCalls = await calls();
			expect(resolvedCalls.map(([command]) => command)).toEqual(["list", "show"]);
			expect(resolvedCalls.find(([command]) => command === "show")?.[ONE]).toBe(partial);
			await bee(["ack", partial, "--reason", "Repair publication"]);
			const empty = await listing();
			expect(empty.requests).toEqual([]);
			const emptyCalls = await calls();
			expect(emptyCalls.map(([command]) => command)).toEqual(["list"]);

			await Bun.write(
				join(repo, ".hive", "bees.toml"),
				`owner="ct"
humans=["ct"]
[kinds.worker]
description="Fixture worker"
harness="fixture"
model="fixture"
effort="low"
prompt="Fixture"
[formulas]
`,
			);
			const unrelated = await request(activeTask);
			const freshTask = await task("New admission");
			const oldRequest = await request(freshTask, "completed");
			const ordinary = await task("Ordinary related bead");
			await br(["dep", "add", ordinary, freshTask, "--type", "related"]);
			await br(["dep", "add", unrelated, freshTask, "--type", "blocks"]);
			await Bun.write(trace, "");
			const admitted = await bee(["spawn", "worker", freshTask]);
			expect(admitted.kind).toBe("spawn_created");
			const admissionCalls = await calls();
			expect(
				admissionCalls.filter(([command]) => command === "show").map((args) => args[ONE]),
			).toEqual([freshTask]);
			const admissionQuery = admissionCalls.find(([command]) => command === "list")!;
			const candidateIds = admissionQuery.flatMap((arg, index) => {
				if (arg === "--id") {
					return [admissionQuery[index + ONE]];
				}
				return [];
			});
			expect(candidateIds.toSorted()).toEqual([oldRequest, ordinary].toSorted());
			await expect(bee(["spawn", "worker", freshTask])).rejects.toBeInstanceOf(CommandError);
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	},
	TIMEOUT,
);
