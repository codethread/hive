/* eslint-disable unicorn/no-null -- Disposable fixtures retain explicit absent policy and decisions. */
import { CommandError, execute, parseBeesConfig, showBead } from "@hive/shared";
import { DRONE_RUNTIME_MS, INACTIVITY_INTERVAL_MS } from "./drone.ts";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { claimRequest, newRequest, reconcileRequests } from "./request.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Disposable native tracker and owned process artifacts.
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { observeExecution, resumeExecution, stopExecution } from "./processes.ts";
import { prepareLaunch, startSupervisor, writeReceipt } from "./launch.ts";
import type { BeesConfig } from "@hive/shared";
import type { LaunchReceipt } from "./launch.ts";
import { dispatch } from "./dispatch.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Private fixture paths.
import { join } from "node:path";
import { openStore } from "./store.ts";
// eslint-disable-next-line import/no-nodejs-modules, import/max-dependencies -- Native fixture composes tracker, supervisor and OS temporary state.
import { tmpdir } from "node:os";

const FIRST = 0;
const ONE = 1;
const TWO = 2;
const POLL_MS = 20;
const WAIT_MS = 10_000;
const SMOKE_MS = 90_000;
const BEE = new URL("../bin/bee.ts", import.meta.url).pathname;
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
	"one-shot inactivity reviews preserve stdout and enforce verdict, retry and recovery policy",
	// eslint-disable-next-line max-statements -- One real tracker/process fixture verifies the full coordinated lifecycle and guaranteed cleanup.
	async () => {
		const temporary = await mkdtemp(join(tmpdir(), "colony-drone-"));
		const root = await realpath(temporary);
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
		const bee = async (args: string[], reportEnv: Record<string, string | undefined> = env) =>
			JSON.parse(
				await execute([process.execPath, BEE, ...args, "--json"], repo, { ...env, ...reportEnv }),
			);
		let store = openStore(state);
		const receipts = new Set<string>();
		let passed = false;
		try {
			await run(["git", "init"]);
			await br(["init", "--prefix", "smoke"]);
			await writeFixture(repo);
			const config = parseBeesConfig(await Bun.file(join(repo, ".hive", "bees.toml")).text());
			const runtime = { config, repository, store };
			// eslint-disable-next-line max-statements -- Reserve and launch a real current attempt through existing lifecycle boundaries.
			const startTarget = async (title: string) => {
				const task = await br(["create", "--title", title, "--owner", "ct"]);
				const spawn = await bee([
					"spawn",
					"worker",
					task.id,
					"--repo",
					repo,
					"--beads-db",
					repository.beadsDb,
					"--actor",
					"smoke-seed",
				]);
				const bead = await showBead(repository, "smoke-seed", spawn.request.id);
				const prepared = await prepareLaunch(
					{ ...repository, id: bead.id, state },
					config.formulas,
					crypto.randomUUID(),
					ONE,
					"target-policy-revision",
				);
				if (prepared.kind !== "prepared") {
					throw new Error("Expected prepared target");
				}
				const receipt = {
					...prepared.receipt,
					createdAt: new Date(Date.now() - INACTIVITY_INTERVAL_MS).toISOString(),
				};
				const claimed = await claimRequest(runtime, newRequest(bead, repository));
				if (claimed === null) {
					throw new Error("Expected claimed target");
				}
				store.reserve(repo, receipt, claimed);
				receipts.add(receipt.id);
				await writeReceipt(receipt);
				await startSupervisor(receipt, state);
				await resumeExecution(receipt, (supervisor) =>
					store.supervisor(receipt.id, supervisor.pid),
				);
				await until("target running", async () => {
					const inventory = await store.inventory(repo);
					return inventory.some((entry) => entry.id === receipt.id && entry.state === "running");
				});
				return { receipt, spawnId: bead.id, taskId: task.id as string };
			};
			const drone = async (targetAttemptId: string) => {
				const review = store.latestDroneReview(repo, targetAttemptId)!;
				receipts.add(review.id);
				await until("drone marker", () => Bun.file(join(repo, `${review.id}.json`)).exists());
				const marker = await Bun.file(join(repo, `${review.id}.json`)).json();
				return { marker, review };
			};
			const first = await startTarget("active legitimate wait then inactive retry");
			await reconcileRequests(runtime);
			const active = await drone(first.receipt.id);
			expect(active.review.deadline - active.review.startedAt).toBe(DRONE_RUNTIME_MS);
			expect(active.review.receipt?.recipe).toMatchObject({
				kind: "inspector",
				model: "user-selected",
			});
			expect(Object.keys(active.review.receipt!.recipe).toSorted()).toEqual([
				"cwd",
				"effort",
				"harness",
				"kind",
				"model",
				"prompt",
			]);
			expect(active.review.receipt?.recipe.prompt).toContain(first.receipt.directory);
			expect(active.review.receipt?.recipe.prompt).toContain("legitimate long-running waits");
			expect(active.review.receipt?.taskIds).toEqual([]);
			expect(await store.inventory(repo)).toHaveLength(ONE);
			expect(store.requests(repo)).toHaveLength(ONE);
			await reconcileRequests(runtime);
			expect(store.latestDroneReview(repo, first.receipt.id)?.id).toBe(active.review.id);
			expect(await showBead(repository, "smoke-seed", first.taskId)).toMatchObject({
				assignee: first.receipt.identity,
				status: "in_progress",
			});
			await expect(
				bee(["report", first.spawnId, "active"], {
					...active.marker.env,
					HIVE_ATTEMPT_TOKEN: crypto.randomUUID(),
				}),
			).rejects.toBeInstanceOf(CommandError);
			await expect(
				bee(["report", "other-spawn", "active"], active.marker.env),
			).rejects.toBeInstanceOf(CommandError);
			expect(await bee(["report", first.spawnId, "active"], active.marker.env)).toMatchObject({
				attemptId: first.receipt.id,
				kind: "drone_verdict_submitted",
				reviewId: active.review.id,
			});
			await expect(
				bee(["report", first.spawnId, "active"], active.marker.env),
			).rejects.toBeInstanceOf(CommandError);
			// Durable submitted verdict and current review survive a daemon/store restart.
			store.close();
			store = openStore(state);
			runtime.store = store;
			await reconcileRequests(runtime);
			expect(await observeExecution(first.receipt)).toEqual({ kind: "live" });
			expect(await observeExecution(active.review.receipt!)).toEqual({ kind: "stopped" });
			const stdout = await Bun.file(join(first.receipt.directory, "stdout.log")).text();
			expect(stdout).toBe("");
			const activeBead = await showBead(repository, "smoke-seed", first.spawnId);
			expect(activeBead.comments.some(({ text }) => text.includes("inactivity drone active"))).toBe(
				true,
			);
			await reconcileRequests(runtime);
			expect(store.latestDroneReview(repo, first.receipt.id)?.id).toBe(active.review.id);
			// Advance only the independent deferral checkpoint; the stdout evidence remains empty.
			const finished = store.latestDroneReview(repo, first.receipt.id)!;
			if (finished.phase !== "finished") {
				throw new Error("Expected finished active review");
			}
			store.saveDroneReview(repo, {
				...finished,
				decision: { ...finished.decision, at: Date.now() - INACTIVITY_INTERVAL_MS },
			});
			await reconcileRequests(runtime);
			const inactive = await drone(first.receipt.id);
			expect(inactive.review.id).not.toBe(active.review.id);
			expect(inactive.review.receipt?.policyRevisionId).toBeNull();
			await expect(
				bee(["report", first.spawnId, "inactive"], active.marker.env),
			).rejects.toBeInstanceOf(CommandError);
			await bee(["report", first.spawnId, "inactive"], inactive.marker.env);
			await reconcileRequests(runtime);
			expect(await observeExecution(first.receipt)).toEqual({ kind: "stopped" });
			expect(store.requests(repo)[FIRST]?.state).toBe("retrying");
			const releasedTask = await showBead(repository, "smoke-seed", first.taskId);
			expect(releasedTask.assignee).toBeUndefined();
			await dispatch({ repository, state, store }, config, "fixture-revision");
			await until("replacement attempt running", async () => {
				const inventory = await store.inventory(repo);
				return inventory.some(
					(entry) =>
						entry.spawnId === first.spawnId &&
						entry.receipt.attemptNumber === TWO &&
						entry.state === "running",
				);
			});
			const replacementInventory = await store.inventory(repo);
			const replacement = replacementInventory.find(
				(entry) => entry.spawnId === first.spawnId && entry.receipt.attemptNumber === TWO,
			)!;
			receipts.add(replacement.id);
			await expect(
				bee(["report", first.spawnId, "inactive"], inactive.marker.env),
			).rejects.toBeInstanceOf(CommandError);
			await reconcileRequests(runtime);
			expect(await observeExecution(replacement.receipt)).toEqual({ kind: "live" });
			await br(["close", first.spawnId, "--reason", "fixture cancellation"]);
			await reconcileRequests(runtime);

			const terminalConfig: BeesConfig = { ...config, max_retries: 0 };
			// A launched drone that exits before the deadline retains that diagnosis after a late wake.
			await Bun.write(join(repo, "drone-mode"), "exit");
			const exited = await startTarget("exit without verdict");
			await reconcileRequests({ ...runtime, config: terminalConfig });
			const exitReview = await drone(exited.receipt.id);
			await until("drone exit receipt", async () => {
				const worker = Bun.file(join(exitReview.review.receipt!.directory, "worker.json"));
				if (!(await worker.exists())) {
					return false;
				}
				const result = await worker.json();
				return result.kind === "exited";
			});
			await Bun.write(join(exitReview.review.receipt!.directory, "verdict.json"), "{invalid JSON");
			await reconcileRequests({
				...runtime,
				config: terminalConfig,
				now: () => exitReview.review.deadline,
			});
			expect(store.latestDroneReview(repo, exited.receipt.id)?.decision?.kind).toBe(
				"exited_without_verdict",
			);
			expect(await showBead(repository, "smoke-seed", exited.spawnId)).toMatchObject({
				close_reason: "exhausted",
				status: "closed",
			});

			await Bun.write(join(repo, "drone-mode"), "hang");
			const timed = await startTarget("timeout without verdict");
			await reconcileRequests({ ...runtime, config: terminalConfig });
			const timeoutReview = await drone(timed.receipt.id);
			// Even a forged stale verdict artifact cannot satisfy the current review.
			await Bun.write(
				join(timeoutReview.review.receipt!.directory, "verdict.json"),
				await Bun.file(join(active.review.receipt!.directory, "verdict.json")).text(),
			);
			await reconcileRequests({
				...runtime,
				config: terminalConfig,
				now: () => timeoutReview.review.deadline,
			});
			expect(store.latestDroneReview(repo, timed.receipt.id)?.decision?.kind).toBe("timeout");
			expect(await observeExecution(timed.receipt)).toEqual({ kind: "stopped" });
			expect(await observeExecution(timeoutReview.review.receipt!)).toEqual({ kind: "stopped" });
			await expect(
				bee(["report", timed.spawnId, "active"], timeoutReview.marker.env),
			).rejects.toBeInstanceOf(CommandError);
			await reconcileRequests({ ...runtime, config: terminalConfig });
			expect(store.latestDroneReview(repo, timed.receipt.id)?.id).toBe(timeoutReview.review.id);

			const failed = await startTarget("one failed drone launch");
			const launchFailureConfig: BeesConfig = {
				...terminalConfig,
				formulas: {
					...config.formulas,
					inspector: { argv: [], executable: join(root, "missing-harness") },
				},
			};
			await reconcileRequests({ ...runtime, config: launchFailureConfig });
			const failedReview = store.latestDroneReview(repo, failed.receipt.id)!;
			receipts.add(failedReview.id);
			await until("failed drone receipt", async () => {
				const worker = Bun.file(join(failedReview.receipt!.directory, "worker.json"));
				if (!(await worker.exists())) {
					return false;
				}
				const result = await worker.json();
				return result.kind === "failed";
			});
			await reconcileRequests({ ...runtime, config: launchFailureConfig });
			expect(store.latestDroneReview(repo, failed.receipt.id)?.decision?.kind).toBe(
				"launch_failed",
			);
			await reconcileRequests({ ...runtime, config: launchFailureConfig });
			expect(store.latestDroneReview(repo, failed.receipt.id)?.id).toBe(failedReview.id);
			const failedBead = await showBead(repository, "smoke-seed", failed.spawnId);
			expect(failedBead.labels).toContain("bee-outcome:failed");
			expect(failedBead.labels).toContain("bee-resolution:unresolved");
			expect(failedBead.comments.some(({ text }) => text.includes("launch_failed"))).toBe(true);
			const failedTask = await showBead(repository, "smoke-seed", failed.taskId);
			expect(failedTask.assignee).toBeUndefined();

			// Closing tasks while a review is pending cancels only the drone, retaining live-bee completion ownership.
			const cleanup = await startTarget("live cleanup after task closure");
			await reconcileRequests(runtime);
			const cleanupReview = await drone(cleanup.receipt.id);
			await br(["close", cleanup.taskId]);
			await reconcileRequests(runtime);
			expect(store.latestDroneReview(repo, cleanup.receipt.id)?.decision?.kind).toBe("cancelled");
			expect(await observeExecution(cleanup.receipt)).toEqual({ kind: "live" });
			expect(await observeExecution(cleanupReview.review.receipt!)).toEqual({ kind: "stopped" });
			await expect(
				bee(["report", cleanup.spawnId, "inactive"], cleanupReview.marker.env),
			).rejects.toBeInstanceOf(CommandError);
			const cleanupMarker = await Bun.file(join(repo, `${cleanup.receipt.id}.json`)).json();
			await bee(["finish", "success"], cleanupMarker.env);
			await reconcileRequests(runtime);
			expect(await observeExecution(cleanup.receipt)).toEqual({ kind: "stopped" });

			// Every pre-permission crash point fails once, without inferring launch from a receipt.
			/* eslint-disable no-await-in-loop -- Exercise serial recovery checkpoints in the shared native fixture. */
			for (const phase of ["empty", "prepared", "supervised"] as const) {
				const interrupted = await startTarget(`interrupted drone ${phase}`);
				const reviewId = crypto.randomUUID();
				const deadline = Date.now() + DRONE_RUNTIME_MS;
				let receipt: LaunchReceipt | null = null;
				if (phase !== "empty") {
					receipt = {
						...interrupted.receipt,
						directory: join(state, reviewId),
						id: reviewId,
						taskIds: [],
						token: crypto.randomUUID(),
					};
				}
				store.saveDroneReview(repo, {
					deadline,
					decision: null,
					id: reviewId,
					launched: false,
					phase: "reserved",
					receipt,
					spawnId: interrupted.spawnId,
					startedAt: Date.now(),
					targetAttemptId: interrupted.receipt.id,
				});
				if (phase === "supervised" && receipt !== null) {
					receipts.add(reviewId);
					await writeReceipt(receipt);
					await Bun.write(
						join(receipt.directory, "drone.json"),
						JSON.stringify({
							deadline,
							reviewId,
							targetAttemptId: interrupted.receipt.id,
							targetSpawnId: interrupted.spawnId,
						}),
					);
					await startSupervisor(receipt, state);
					await until("reserved supervisor handoff", () =>
						Bun.file(join(state, reviewId, "supervisor.json")).exists(),
					);
				}
				await reconcileRequests({ ...runtime, config: terminalConfig });
				expect(store.latestDroneReview(repo, interrupted.receipt.id)).toMatchObject({
					decision: { kind: "launch_failed" },
					id: reviewId,
					phase: "finished",
				});
				expect(await observeExecution(interrupted.receipt)).toEqual({ kind: "stopped" });
				expect(await Bun.file(join(state, reviewId, "permission.json")).exists()).toBe(false);
				if (phase === "supervised" && receipt !== null) {
					expect(await observeExecution(receipt)).toEqual({ kind: "stopped" });
				}
				await reconcileRequests({ ...runtime, config: terminalConfig });
				expect(store.latestDroneReview(repo, interrupted.receipt.id)?.id).toBe(reviewId);
			}
			/* eslint-enable no-await-in-loop */
			passed = true;
		} catch (error) {
			throw new Error(`Drone artifacts retained at ${root}`, { cause: error });
		} finally {
			for (const id of receipts) {
				const path = join(state, id, "receipt.json");
				// eslint-disable-next-line no-await-in-loop -- Verify and stop each private fixture execution before deleting its evidence.
				if (await Bun.file(path).exists()) {
					// eslint-disable-next-line no-await-in-loop -- Private launch receipts retain exact cleanup authority.
					const receipt = await Bun.file(path).json();
					// eslint-disable-next-line no-await-in-loop -- Existing owned-process cleanup is the fixture teardown boundary too.
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

// --- Private functions ---
async function writeFixture(repo: string): Promise<void> {
	await Bun.write(
		join(repo, ".hive", "bees.toml"),
		`owner="ct"
humans=["ct"]
ranking="fifo"
max_retries=1
retry_delay_ms=0
inactivity_drone="inspector"
[kinds.worker]
description = "Implement the linked task beads and verify their outcomes."
harness="worker"
model="fixture"
effort="low"
prompt="fixture"
[kinds.inspector]
description = "Execute the configured inspector role."
harness="inspector"
model="user-selected"
effort="low"
prompt="Inspect process evidence"
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
await Bun.write(${JSON.stringify(repo)}+"/"+env.HIVE_ATTEMPT_ID+".json",JSON.stringify({env:{HIVE_COLONY_STATE:env.HIVE_COLONY_STATE,HIVE_ATTEMPT_ID:env.HIVE_ATTEMPT_ID,HIVE_ATTEMPT_TOKEN:env.HIVE_ATTEMPT_TOKEN,HIVE_SPAWN_ID:env.HIVE_SPAWN_ID,HIVE_DRONE_REVIEW_ID:env.HIVE_DRONE_REVIEW_ID,HIVE_DRONE_TARGET_ATTEMPT_ID:env.HIVE_DRONE_TARGET_ATTEMPT_ID},pid:process.pid}));
if(env.HIVE_DRONE_REVIEW_ID && await Bun.file(${JSON.stringify(join(repo, "drone-mode"))}).exists() && (await Bun.file(${JSON.stringify(join(repo, "drone-mode"))}).text())==="exit")process.exit(0);
const deadline=Date.now()+90000;
while(!(await Bun.file(${JSON.stringify(repo)}+"/"+env.HIVE_ATTEMPT_ID+".release").exists())) {
 if(Date.now()>=deadline) throw new Error("Fixture deadline expired");
 await Bun.sleep(20);
}
`,
	);
}
async function until(label: string, condition: () => Promise<boolean>): Promise<void> {
	const deadline = Date.now() + WAIT_MS;
	/* eslint-disable no-await-in-loop -- Bounded condition polling mirrors the native lifecycle smoke fixtures. */
	while (!(await condition())) {
		if (Date.now() >= deadline) {
			throw new Error(`Timed out waiting for ${label}`);
		}
		await Bun.sleep(POLL_MS);
	}
	/* eslint-enable no-await-in-loop */
}
