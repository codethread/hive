// eslint-disable-next-line import/no-nodejs-modules -- Disposable native trackers verify offline attribution and endpoint selection.
import { cp, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { expect, test } from "bun:test";
import { execute } from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Owned fixture paths.
import { join } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Isolated real I/O fixture root.
import { tmpdir } from "node:os";

const FIRST = 0;
const SUCCESS = 0;
const ONE = 1;
const TIMEOUT = 30_000;
const BEE = new URL("../bin/bee.ts", import.meta.url).pathname;
const RECIPE = JSON.stringify({
	// eslint-disable-next-line unicorn/no-null -- Canonical execution directory in the native recipe.
	cwd: null,
	effort: "low",
	harness: "fixture",
	kind: "worker",
	model: "fixture",
	prompt: "Private captured instructions",
});

test(
	"ack resolves native failure attention offline with explicit and environment actors, preserving work and history",
	// eslint-disable-next-line max-statements -- One real CLI fixture checks the complete offline mutation and inspection contract.
	async () => {
		const temporary = await mkdtemp(join(tmpdir(), "bee-ack-"));
		const root = await realpath(temporary);
		const repo = join(root, "repo");
		const alternate = join(root, "alternate");
		const database = join(repo, ".beads", "beads.db");
		const alternateDb = join(alternate, ".beads", "beads.db");
		const env = {
			...process.env,
			BD_ACTOR: "environment-actor",
			BEADS_DB: alternateDb,
			XDG_STATE_HOME: join(root, "unused-state"),
		};
		const br = async (args: string[], db = database) =>
			JSON.parse(
				await execute(["br", ...args, "--db", db, "--actor", "seed", "--json"], repo, env),
			);
		const show = async (id: string, db = database) => {
			const rows = await br(["show", id], db);
			return rows[FIRST];
		};
		const bee = async (args: string[], environment: NodeJS.ProcessEnv = env) => {
			const child = Bun.spawn(
				[process.execPath, BEE, ...args, "--repo", repo, "--beads-db", database],
				{
					cwd: repo,
					env: environment,
					stderr: "pipe",
					stdout: "pipe",
				},
			);
			const [stdout, stderr, code] = await Promise.all([
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
				child.exited,
			]);
			expect(stderr).toBe("");
			return { code, stdout };
		};
		const json = async (args: string[]) => {
			const result = await bee([...args, "--json"]);
			expect(result.code).toBe(SUCCESS);
			return JSON.parse(result.stdout);
		};
		const request = async (task: string, reason: string) => {
			const created = await br([
				"create",
				"--title",
				"Failure",
				"--owner",
				"ct",
				"--assignee",
				"failed-bee",
				"--description",
				RECIPE,
				"--labels",
				"system,bee,agent:worker,bee-outcome:pending,bee-resolution:unresolved",
				"--deps",
				`related:${task}`,
			]);
			await br(["close", created.id, "--reason", reason]);
			await json(["stop", created.id]);
			return created.id as string;
		};
		try {
			await mkdir(repo);
			await mkdir(alternate);
			await execute(["git", "init"], repo, env);
			await br(["init", "--prefix", "smoke"]);
			const task = await br([
				"create",
				"--title",
				"Unfinished work",
				"--owner",
				"ct",
				"--assignee",
				"task-owner",
			]);
			const failed = await request(task.id, "exhausted");
			await br(["comments", "add", failed, "--message", "Colony observation: settled: exhausted"]);
			await br([
				"query",
				"save",
				"bee-attention",
				"--label",
				"system",
				"--label",
				"bee",
				"--label",
				"bee-outcome:failed",
				"--label",
				"bee-resolution:unresolved",
				"--all",
				"--limit",
				"0",
			]);
			await cp(join(repo, ".beads"), join(alternate, ".beads"), { recursive: true });
			const before = await show(failed);
			const taskBefore = await show(task.id);
			const attention = await br(["query", "run", "bee-attention"]);
			expect(attention.issues.map((row: { id: string }) => row.id)).toEqual([failed]);
			const acknowledged = await json([
				"ack",
				failed,
				"--actor",
				"explicit-actor",
				"--reason",
				"Handled separately",
			]);
			expect(acknowledged).toMatchObject({
				kind: "request_acknowledged",
				ok: true,
				repository: { beadsDb: database, root: repo },
				request: {
					acknowledgment: {
						actor: "explicit-actor",
						reason: "Handled separately",
					},
					disposition: { outcome: "failed", resolution: "resolved" },
					id: failed,
					labelPublication: "current",
					needsAttention: false,
					resolution: { kind: "acknowledged" },
				},
			});
			expect(acknowledged.request).not.toHaveProperty("recipe");
			expect(acknowledged.request).not.toHaveProperty("tasks");
			const after = await show(failed);
			const comments = after.comments.filter((comment: { text: string }) =>
				comment.text.startsWith("Bee acknowledgment:"),
			);
			expect(comments).toHaveLength(ONE);
			expect(acknowledged.request.acknowledgment.acknowledgedAt).toBe(comments[FIRST].created_at);
			expect(comments[FIRST].author).toBe("explicit-actor");
			expect(after).toMatchObject({
				assignee: before.assignee,
				close_reason: before.close_reason,
				closed_at: before.closed_at,
				dependencies: before.dependencies,
				description: before.description,
				status: before.status,
			});
			expect(after.comments).toEqual(expect.arrayContaining(before.comments));
			expect(await show(task.id)).toEqual(taskBefore);
			expect(await show(failed, alternateDb)).toEqual(before);
			const resolvedAttention = await br(["query", "run", "bee-attention"]);
			expect(resolvedAttention.issues).toEqual([]);
			const listing = await json(["list"]);
			expect(listing.requests).toEqual([]);
			const history = await json(["list", "--all"]);
			expect(history.requests[FIRST].acknowledgment).toEqual(acknowledged.request.acknowledgment);
			const status = await json(["status", failed]);
			expect(status.request.acknowledgment).toEqual(acknowledged.request.acknowledgment);
			const human = await bee(["status", failed]);
			expect(human.code).toBe(SUCCESS);
			expect(human.stdout).toContain("Acknowledged by explicit-actor");
			expect(human.stdout).toContain("Handled separately");
			const repeated = await json([
				"ack",
				failed,
				"--actor",
				"another-actor",
				"--reason",
				"A later reason",
			]);
			expect(repeated).toEqual(acknowledged);
			expect(await show(failed)).toEqual(after);
			const stopped = await json(["stop", failed]);
			expect(stopped.request.acknowledgment).toEqual(acknowledged.request.acknowledgment);
			const retry = await bee(["retry", failed, "--json"]);
			expect(retry.code).not.toBe(SUCCESS);
			expect(JSON.parse(retry.stdout).ok).toBe(false);
			const blocked = await request(task.id, "blocked");
			const envAck = await json(["ack", blocked, "--reason", "Accepted blocker"]);
			expect(envAck.request.acknowledgment.actor).toBe("environment-actor");
			const humanAck = await bee(["ack", blocked, "--reason", "Accepted blocker"]);
			expect(humanAck.code).toBe(SUCCESS);
			expect(humanAck.stdout).toContain("Acknowledged by environment-actor");
			const invalid = await request(task.id, "completed");
			const invalidBefore = await show(invalid);
			const refused = await bee(["ack", invalid, "--reason", "Should fail", "--json"]);
			expect(refused.code).not.toBe(SUCCESS);
			expect(JSON.parse(refused.stdout)).toMatchObject({ kind: "error", ok: false });
			expect(await show(invalid)).toEqual(invalidBefore);
			await br(["dep", "add", invalid, blocked, "--type", "supersedes"]);
			const superseded = await json(["ack", blocked, "--reason", "Already replaced"]);
			expect(superseded.request.resolution).toEqual({
				kind: "superseded",
				replacementIds: [invalid],
			});
			expect(superseded.request.acknowledgment).toEqual(envAck.request.acknowledgment);
			const supersededHuman = await bee(["status", blocked]);
			expect(supersededHuman.stdout).toContain(`Replacement: ${invalid}`);
			expect(supersededHuman.stdout).toContain("Acknowledged by environment-actor");
			const claimFailed = await request(task.id, "claim_failed");
			await br(["dep", "add", invalid, claimFailed, "--type", "supersedes"]);
			const beforeSupersededAck = await show(claimFailed);
			const noOp = await json(["ack", claimFailed, "--reason", "Already replaced"]);
			expect(noOp.request.resolution).toEqual({ kind: "superseded", replacementIds: [invalid] });
			expect(noOp.request.acknowledgment).toBeNull();
			expect(noOp.request.labelPublication).toBe("current");
			const afterSupersededAck = await show(claimFailed);
			expect(afterSupersededAck.comments).toEqual(beforeSupersededAck.comments);
			const beforeOrdinaryAck = await show(task.id);
			const ordinaryTask = await bee(["ack", task.id, "--reason", "Not a request", "--json"]);
			expect(ordinaryTask.code).not.toBe(SUCCESS);
			expect(await show(task.id)).toEqual(beforeOrdinaryAck);
			const missingActor = await bee(["ack", failed, "--reason", "Required actor", "--json"], {
				...env,
				BD_ACTOR: undefined,
			});
			expect(missingActor.code).not.toBe(SUCCESS);
			expect(JSON.parse(missingActor.stdout)).toMatchObject({ kind: "error", ok: false });
			const blankActor = await bee([
				"ack",
				failed,
				"--actor",
				" ",
				"--reason",
				"Required actor",
				"--json",
			]);
			expect(blankActor.code).not.toBe(SUCCESS);
			const blankReason = await bee(["ack", failed, "--reason", " ", "--json"]);
			expect(blankReason.code).not.toBe(SUCCESS);
			expect(
				await Bun.file(join(env.XDG_STATE_HOME, "hive", "colony", "colony.sqlite")).exists(),
			).toBe(false);
			expect(await Bun.file(join(repo, ".hive", "bees.toml")).exists()).toBe(false);
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	},
	TIMEOUT,
);
