/* eslint-disable unicorn/no-await-expression-member, unicorn/max-nested-calls -- Native smoke assertions inspect asynchronous evidence at the assertion site. */
/* eslint-disable unicorn/no-null -- Fixtures exercise disabled policy and absent results explicitly. */
import { CommandError, execute, parseBeesConfig, showBead } from "@hive/shared";
import { afterAll, beforeAll, expect, test } from "bun:test";
// eslint-disable-next-line import/no-nodejs-modules -- Disposable native tracker and process fixture.
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { observeExecution, stopExecution } from "./processes.ts";
import { prepareAssessment, reconcileAssessments } from "./postrun.ts";
import type { Assessment } from "./postrun.ts";
import type { BeesConfig } from "@hive/shared";
import { dispatch } from "./dispatch.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Fixture artifact paths.
import { join } from "node:path";
import { openStore } from "./store.ts";
import { readAssessments } from "./assessments.ts";
import { reconcileRequests } from "./request.ts";
// eslint-disable-next-line import/no-nodejs-modules, import/max-dependencies -- Native smoke composes real tracker, supervisor and private OS state.
import { tmpdir } from "node:os";

const FIRST = 0;
const ONE = 1;
const TWO = 2;
const LIMIT = 20;
const WAIT_MS = 10_000;
const POLL_MS = 20;
const SMOKE_MS = 90_000;
const BEE = new URL("../bin/bee.ts", import.meta.url).pathname;
const COLONY = new URL("../bin/colony.ts", import.meta.url).pathname;
const report = {
	findings: [
		{
			evidence: [{ detail: "Captured brief", source: "source.json:brief" }],
			finding: "Scope was clear",
			stage: "brief",
		},
	],
	heuristic: "welcoming_hive",
	orientation: {
		kind: "unavailable",
		reason: "Native events do not expose within-turn onboarding tokens",
	},
	summary: "Crisp scope; attribution unknown",
	uncertainty: ["Fixture has no native token events"],
};
const originalTimezone = process.env.TZ;
beforeAll(() => {
	process.env.TZ = "UTC";
});
afterAll(() => {
	if (originalTimezone === undefined) {
		delete process.env.TZ;
	} else {
		process.env.TZ = originalTimezone;
	}
});

test(
	"post-run queue is durable, non-recursive, bounded and independent of request outcomes",
	// eslint-disable-next-line max-statements -- One native fixture proves coordinated lifecycle invariants and guarantees cleanup.
	async () => {
		const root = await realpath(await mkdtemp(join(tmpdir(), "colony-postrun-")));
		const repo = join(root, "repo");
		const state = join(root, "state");
		await mkdir(repo);
		await mkdir(state);
		const repository = { beadsDb: join(repo, ".beads", "beads.db"), root: repo };
		const env = { ...process.env, BD_ACTOR: "smoke-seed", BEADS_DB: repository.beadsDb, TZ: "UTC" };
		const run = (args: string[]) => execute(args, repo, env);
		const br = async (args: string[]) =>
			JSON.parse(
				await run(["br", ...args, "--db", repository.beadsDb, "--actor", "smoke-seed", "--json"]),
			);
		const bee = async (args: string[], authority: Record<string, string | undefined> = {}) =>
			JSON.parse(
				await execute([process.execPath, BEE, ...args, "--json"], repo, { ...env, ...authority }),
			);
		let store = openStore(state);
		let passed = false;
		try {
			await run(["git", "init"]);
			await br(["init", "--prefix", "smoke"]);
			await writeFixture(repo);
			const config = parseBeesConfig(await Bun.file(join(repo, ".hive", "bees.toml")).text());
			const runtime = () => ({ config, repository, store });
			const create = async (title: string, cwd = repo) => {
				const task = await br([
					"create",
					"--title",
					title,
					"--owner",
					"ct",
					"--description",
					"Focused fixture task",
					"--acceptance-criteria",
					"Verified fixture",
				]);
				const spawned = await bee([
					"spawn",
					"worker",
					task.id,
					"--cwd",
					cwd,
					"--repo",
					repo,
					"--beads-db",
					repository.beadsDb,
					"--actor",
					"smoke-seed",
				]);
				return { requestId: spawned.request.id as string, taskId: task.id as string };
			};
			const start = async (requestId: string, selected: BeesConfig = config) => {
				await dispatch({ repository, state, store }, selected, "fixture-revision");
				await until("target running", async () =>
					(await store.inventory(repo)).some(
						(attempt) => attempt.spawnId === requestId && attempt.state === "running",
					),
				);
				return store
					.retainedInventory(repo)
					.filter((attempt) => attempt.spawnId === requestId)
					.at(-ONE)!.receipt;
			};
			const assessment = (requestId: string) =>
				store.assessments(repo).find((item) => item.requestId === requestId)!;
			const inspector = async (requestId: string) => {
				const item = assessment(requestId);
				expect(item.phase).toBe("reviewing");
				await until("inspector marker", () => Bun.file(join(repo, `${item.id}.json`)).exists());
				return { item, authority: await Bun.file(join(repo, `${item.id}.json`)).json() };
			};
			const cancel = async (requestId: string) => {
				await br(["close", requestId, "--reason", "cancelled"]);
				await reconcileRequests(runtime());
			};

			const executionDirectory = join(root, "removed-task-directory");
			await mkdir(executionDirectory);
			const source = await create("all attempts", executionDirectory);
			const first = await start(source.requestId);
			await Bun.write(join(repo, `${first.id}.release`), "exit");
			await until("first stopped", async () => (await observeExecution(first)).kind === "stopped");
			await reconcileRequests(runtime());
			expect(store.assessments(repo)).toHaveLength(FIRST);
			const second = await start(source.requestId);
			await br(["update", source.taskId, "--append-notes", "Delivered a cohesive fixture report"]);
			await br(["close", source.taskId]);
			await Bun.write(join(repo, `${second.id}.release`), "exit");
			await until(
				"second stopped",
				async () => (await observeExecution(second)).kind === "stopped",
			);
			await reconcileRequests(runtime());
			await rm(executionDirectory, { recursive: true });
			const settledSource = store.requests(repo).find((item) => item.id === source.requestId)!;
			const missingSnapshot = await prepareAssessment(
				{ ...runtime(), repository: { ...repository, beadsDb: join(root, "unavailable.db") } },
				settledSource,
			);
			expect(missingSnapshot?.phase).toBe("queued");
			expect(missingSnapshot?.source.tasks).toEqual([]);
			expect(missingSnapshot?.source.unavailableTasks.map(({ id }) => id)).toEqual([source.taskId]);
			expect(missingSnapshot?.source.unavailableTasks[FIRST]?.reason).toContain("ISSUE_NOT_FOUND");
			const queued = assessment(source.requestId);
			expect(queued.source).toMatchObject({
				brief: "Complete the crisp task",
				systemPrompt: "Worker role",
			});
			expect(queued.phase).toBe("queued");
			expect(queued.source.attempts.map(({ id }) => id)).toEqual([first.id, second.id]);
			expect(queued.source.tasks[FIRST]).toMatchObject({
				acceptance: "Verified fixture",
				notes: "Delivered a cohesive fixture report",
				title: "all attempts",
			});
			// Persist unavailable source coverage through the same atomic settlement boundary.
			store.settleRequest(repo, settledSource, { ...queued, source: missingSnapshot!.source });
			await reconcileRequests(runtime());
			expect(store.assessments(repo)).toHaveLength(ONE);
			store.close();
			store = openStore(state);
			await dispatch({ repository, state, store }, config, "fixture-revision");
			const active = await inspector(source.requestId);
			expect(active.item).toMatchObject({
				receipt: { recipe: { system_prompt: "Assessment role" } },
			});
			expect(active.authority.cwd).toBe(repo);
			expect(active.authority.HIVE_SPAWN_ID).toBe(active.item.id);
			expect(store.retainedInventory(repo)).toHaveLength(TWO);
			expect(store.requests(repo)).toHaveLength(ONE);
			const queuedNext = await create("FIFO cancellation");
			await start(queuedNext.requestId);
			await cancel(queuedNext.requestId);
			await reconcileAssessments(runtime());
			expect(assessment(queuedNext.requestId).phase).toBe("queued");
			await Bun.write(join(root, "report.json"), JSON.stringify(report));
			await expect(
				bee(["assess", "--file", join(root, "report.json")], {
					...active.authority,
					HIVE_ATTEMPT_TOKEN: crypto.randomUUID(),
				}),
			).rejects.toBeInstanceOf(CommandError);
			await bee(["assess", "--file", join(root, "report.json")], active.authority);
			await expect(
				bee(["assess", "--file", join(root, "report.json")], active.authority),
			).rejects.toBeInstanceOf(CommandError);
			store.close();
			store = openStore(state);
			await reconcileAssessments({
				...runtime(),
				config: { ...config, post_run_drone: null },
				// eslint-disable-next-line no-ternary -- Timely artifacts survive reconciliation after the review deadline.
				now: () => (active.item.phase === "reviewing" ? active.item.deadline + ONE : FIRST),
			});
			expect(assessment(source.requestId)).toMatchObject({
				phase: "finished",
				result: { kind: "completed", report },
			});
			expect(assessment(queuedNext.requestId).phase).toBe("queued");
			expect(await showBead(repository, "smoke-seed", source.requestId)).toMatchObject({
				close_reason: "completed",
				status: "closed",
			});

			const selected = JSON.parse(
				await run([
					process.execPath,
					COLONY,
					"assessments",
					"--repo",
					repo,
					"--beads-db",
					repository.beadsDb,
					"--state",
					state,
					"--request",
					source.requestId,
					"--json",
				]),
			);
			expect(selected.assessments).toHaveLength(ONE);
			expect(selected.assessments[FIRST].source.attempts).toHaveLength(TWO);
			expect(selected.assessments[FIRST].source.usage[FIRST].measured).toBeNull();
			expect(selected.assessments[FIRST].source.unavailableTasks).toEqual(
				missingSnapshot!.source.unavailableTasks,
			);
			const summaries = await readAssessments(state, { limit: ONE, repository });
			expect(summaries.assessments).toHaveLength(ONE);
			expect(summaries.assessments[FIRST]!.source).toBeNull();
			expect(
				(
					await readAssessments(state, {
						limit: LIMIT,
						repository: { ...repository, beadsDb: join(root, "other.db") },
					})
				).assessments,
			).toHaveLength(FIRST);
			await expect(
				readAssessments(join(root, "absent"), { limit: LIMIT, repository }),
			).rejects.toBeInstanceOf(Error);
			expect(await Bun.file(join(root, "absent", "colony.sqlite")).exists()).toBe(false);
			const schema = JSON.parse(
				await run([process.execPath, COLONY, "assessments", "--schema", "--json"]),
			);
			expect(schema.kind).toBe("assessment_schema");

			await reconcileAssessments(runtime());
			const timed = await inspector(queuedNext.requestId);
			if (timed.item.phase !== "reviewing") {
				throw new Error("Expected reviewing assessment");
			}
			const { deadline } = timed.item;
			await reconcileAssessments({
				...runtime(),
				now: () => deadline,
			});
			expect(assessment(queuedNext.requestId)).toMatchObject({
				phase: "finished",
				result: { kind: "failed", reason: "timeout" },
			});
			expect(await observeExecution(timed.item.receipt)).toEqual({ kind: "stopped" });
			expect(await showBead(repository, "smoke-seed", queuedNext.requestId)).toMatchObject({
				close_reason: "cancelled",
			});

			const disabled = await create("disabled enrollment");
			await start(disabled.requestId, { ...config, post_run_drone: null });
			await br(["close", disabled.requestId, "--reason", "cancelled"]);
			await reconcileRequests({ ...runtime(), config: { ...config, post_run_drone: null } });
			await reconcileRequests(runtime());
			expect(assessment(disabled.requestId)).toBeUndefined();
			const noLaunch = await create("closed without launch");
			await br(["close", noLaunch.taskId]);
			await dispatch({ repository, state, store }, config, "fixture-revision");
			expect(assessment(noLaunch.requestId)).toBeUndefined();

			const failed = await create("failed inspector");
			await start(failed.requestId);
			await cancel(failed.requestId);
			await reconcileAssessments({
				...runtime(),
				config: {
					...config,
					formulas: {
						...config.formulas,
						inspector: { argv: [], executable: join(root, "missing-harness"), headless: [] },
					},
				},
			});
			const failure = assessment(failed.requestId);
			if (failure.phase !== "reviewing") {
				throw new Error("Expected reviewing assessment");
			}
			await until("failed inspector", async () => {
				const file = Bun.file(join(failure.receipt.directory, "worker.json"));
				return (await file.exists()) && (await file.json()).kind === "failed";
			});
			await reconcileAssessments(runtime());
			expect(assessment(failed.requestId)).toMatchObject({
				phase: "finished",
				result: { kind: "failed", reason: "launch_failed" },
			});
			expect(await showBead(repository, "smoke-seed", failed.requestId)).toMatchObject({
				close_reason: "cancelled",
			});

			const exhausted = await create("source failure with missing inspector report");
			const exhaustedReceipt = await start(exhausted.requestId);
			await Bun.write(join(repo, `${exhaustedReceipt.id}.release`), "exit");
			await until(
				"exhausted source stopped",
				async () => (await observeExecution(exhaustedReceipt)).kind === "stopped",
			);
			await reconcileRequests({ ...runtime(), config: { ...config, max_retries: FIRST } });
			expect(assessment(exhausted.requestId).source.outcome).toBe("exhausted");
			await reconcileAssessments(runtime());
			const missing = await inspector(exhausted.requestId);
			if (missing.item.phase !== "reviewing") {
				throw new Error("Expected reviewing assessment");
			}
			await Bun.write(join(repo, `${missing.item.id}.release`), "exit");
			const { receipt: missingReceipt } = missing.item;
			await until(
				"inspector stopped without report",
				async () => (await observeExecution(missingReceipt)).kind === "stopped",
			);
			await reconcileAssessments(runtime());
			expect(assessment(exhausted.requestId)).toMatchObject({
				phase: "finished",
				result: { kind: "failed", reason: "missing_report" },
			});
			expect(await showBead(repository, "smoke-seed", exhausted.requestId)).toMatchObject({
				close_reason: "exhausted",
			});

			const malformed = await create("malformed report");
			await start(malformed.requestId);
			await cancel(malformed.requestId);
			await reconcileAssessments(runtime());
			const bad = await inspector(malformed.requestId);
			if (bad.item.phase !== "reviewing") {
				throw new Error("Expected reviewing assessment");
			}
			await Bun.write(join(bad.item.receipt.directory, "assessment-report.json"), "{invalid");
			await reconcileAssessments(runtime());
			expect(assessment(malformed.requestId)).toMatchObject({
				phase: "finished",
				result: { kind: "failed", reason: "invalid_report" },
			});

			const interrupted = await create("reservation recovery");
			await start(interrupted.requestId);
			await cancel(interrupted.requestId);
			const reservation = assessment(interrupted.requestId);
			const reserved: Assessment = {
				...reservation,
				deadline: Date.now() + SMOKE_MS,
				phase: "reserved",
				launched: false,
				receipt: {
					...bad.item.receipt,
					id: reservation.id,
					directory: join(state, reservation.id),
				},
				startedAt: Date.now(),
			};
			store.saveAssessment(repo, reserved);
			await reconcileAssessments(runtime());
			expect(assessment(interrupted.requestId)).toMatchObject({
				phase: "finished",
				result: { kind: "failed", reason: "launch_failed" },
			});
			await reconcileAssessments(runtime());
			expect(assessment(interrupted.requestId).id).toBe(reservation.id);
			const terminal = store.requests(repo).find(({ id }) => id === interrupted.requestId)!;
			const duplicate = await prepareAssessment(runtime(), terminal);
			expect(() => store.settleRequest(repo, terminal, duplicate)).toThrow();
			passed = true;
		} catch (error) {
			throw new Error(`Post-run artifacts retained at ${root}`, { cause: error });
		} finally {
			const receipts = [
				...store.retainedInventory(repo).map(({ receipt }) => receipt),
				...store
					.assessments(repo)
					// eslint-disable-next-line no-ternary -- Queued entries have no subprocess receipt.
					.flatMap((item) => (item.phase === "queued" ? [] : [item.receipt])),
			];
			for (const receipt of receipts) {
				// eslint-disable-next-line no-await-in-loop -- Stop each verified private fixture execution before artifact removal.
				if (await Bun.file(join(receipt.directory, "supervisor.json")).exists()) {
					// eslint-disable-next-line no-await-in-loop -- Ownership cleanup is intentionally serial.
					await stopExecution(receipt);
				}
			}
			store.close();
			if (passed) {
				await rm(root, { force: true, recursive: true });
			}
		}
	},
	SMOKE_MS,
);

async function writeFixture(repo: string): Promise<void> {
	await Bun.write(
		join(repo, ".hive", "bees.toml"),
		`owner="ct"
humans=["ct"]
ranking="fifo"
max_retries=1
retry_delay_ms=0
post_run_drone="inspector"
[kinds.worker]
description="Fixture worker"
harness="worker"
model="fixture"
effort="low"
prompt="Complete the crisp task"
system_prompt="Worker role"
[kinds.inspector]
description="Fixture assessment"
harness="inspector"
model="fixture"
effort="low"
prompt="Read docs/agents/welcoming-hive.md"
system_prompt="Assessment role"
[formulas.worker]
executable=${JSON.stringify(process.execPath)}
argv=[${JSON.stringify(join(repo, "fixture.ts"))}]
[formulas.inspector]
executable=${JSON.stringify(process.execPath)}
argv=[${JSON.stringify(join(repo, "fixture.ts"))}]
`,
	);
	await Bun.write(
		join(repo, "fixture.ts"),
		`const env=process.env;
await Bun.write(${JSON.stringify(repo)}+"/"+env.HIVE_ATTEMPT_ID+".json",JSON.stringify({HIVE_COLONY_STATE:env.HIVE_COLONY_STATE,HIVE_ATTEMPT_ID:env.HIVE_ATTEMPT_ID,HIVE_ATTEMPT_TOKEN:env.HIVE_ATTEMPT_TOKEN,HIVE_SPAWN_ID:env.HIVE_SPAWN_ID,HIVE_ASSESSMENT_ID:env.HIVE_ASSESSMENT_ID,cwd:process.cwd()}));
const deadline=Date.now()+90000;
while(!(await Bun.file(${JSON.stringify(repo)}+"/"+env.HIVE_ATTEMPT_ID+".release").exists())) { if(Date.now()>=deadline) throw new Error("Fixture timeout"); await Bun.sleep(20); }
`,
	);
}
async function until(label: string, condition: () => Promise<boolean>): Promise<void> {
	const deadline = Date.now() + WAIT_MS;
	// eslint-disable-next-line no-await-in-loop -- Bounded condition polling through real process boundaries.
	while (!(await condition())) {
		if (Date.now() >= deadline) {
			throw new Error(`Timed out waiting for ${label}`);
		}
		// eslint-disable-next-line no-await-in-loop -- Wait only between condition checks.
		await Bun.sleep(POLL_MS);
	}
}
