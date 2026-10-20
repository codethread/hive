/* eslint-disable unicorn/no-null -- The restart checkpoint explicitly records an unobserved prior daemon. */
import type { DaemonLifecycle, RestartCheckpoint } from "./daemon-lifecycle.ts";
import { afterAll, expect, test } from "bun:test";
import { memoryTracker, unusedWorkReviewCommands } from "./tracker.test-support.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Create and remove isolated state for the socket fixture.
import { mkdtemp, rm } from "node:fs/promises";
import { beesConfigSchema } from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve fixture repository, tracker and socket paths.
import { join } from "node:path";
import { openStore } from "./store.ts";
import { requestServer } from "./client.ts";
import { restartServer } from "./daemon-lifecycle.ts";
import { serve } from "./server.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Allocate daemon state in the OS temporary directory.
import { tmpdir } from "node:os";

const NONE = 0;
const ONE = 1;
const FIRST_PROBE_ENTRIES = 4;
const POLL_STEP_MS = 10_000;
const BOTH_PASSES_MS = 20_000;
const state = await mkdtemp(join(tmpdir(), "colony-recovery-"));
const target = { state, socket: join(state, "s"), runtimeEntry: "/unused" };
const repositories = ["first", "second"].map((name) => ({
	root: join(state, name),
	beadsDb: join(state, name, "tracker.db"),
}));
const store = openStore(state);
for (const repository of repositories) {
	store.register(repository);
	store.setActivity(repository.root, "awake");
}
store.close();
const gates = repositories.map(() => Promise.withResolvers<void>());
const entered = repositories.map(() => Promise.withResolvers<void>());
const { beads } = memoryTracker();
const { list } = beads;
beads.list = async (scope, selection) => {
	const index = repositories.findIndex((repository) => repository.root === scope.cwd);
	entered[index]!.resolve();
	await gates[index]!.promise;
	return list(scope, selection);
};
function unexpected(): never {
	throw new Error("Disabled fixture operation");
}
await serve(target, beads, {
	loadActivity: () =>
		Promise.resolve({
			state: "awake",
			config: beesConfigSchema.parse({ owner: "ct", humans: ["ct"], formulas: {} }),
		}),
	workReview: unusedWorkReviewCommands(),
});
await Promise.all(entered.map(({ promise }) => promise));
const before = await requestServer(target, { kind: "status" });
if (before.kind !== "status") {
	throw new Error("Expected fixture status");
}
let clock = 0;
let probes = 0;
const progress: string[] = [];
const checkpoint: RestartCheckpoint = {
	state: "failed",
	previous: null,
	daemon: before,
	registrations: repositories.map((repository) => ({ repository, intent: "awake", attempts: [] })),
	confirmedEffects: ["native_service_submitted", "replacement_observed"],
};
const lifecycle: DaemonLifecycle = {
	prepare: () => Promise.resolve(),
	handoff: unexpected,
	pending: () => Promise.resolve(checkpoint),
	record: () => Promise.resolve(),
	request: async (selected, command) => {
		const result = await requestServer(selected, command);
		if (command.kind === "recover") {
			probes += ONE;
			progress.push(result.kind);
		}
		return result;
	},
	owner: unexpected,
	observe: unexpected,
	start: unexpected,
	supervisor: () => ({ kind: "launchd", service: "fixture" }),
	verify: () => Promise.resolve(),
	now: () => clock,
	pause: async () => {
		clock += POLL_STEP_MS;
		const status = await requestServer(target, { kind: "status" });
		progress.push(`progress:${status.kind}`);
		if (probes === ONE) {
			gates[NONE]!.resolve();
		} else {
			gates[ONE]!.resolve();
		}
	},
};
const result = await restartServer(target, lifecycle);
await requestServer(target, { kind: "stop", expectedId: before.id });
afterAll(() => rm(state, { force: true, recursive: true }));

test("recovery leaves the command queue available while both scheduling passes finish", () => {
	expect(progress.slice(NONE, FIRST_PROBE_ENTRIES)).toEqual([
		"recovering",
		"progress:status",
		"recovering",
		"progress:status",
	]);
	expect(progress.at(-ONE)).toBe("status");
	expect(clock).toBeGreaterThanOrEqual(BOTH_PASSES_MS);
	expect(result.daemon.id).toBe(before.id);
	expect(result.daemon.colonies.map(({ repository }) => repository)).toEqual(repositories);
	expect(result.confirmedEffects).toEqual([
		"native_service_submitted",
		"replacement_observed",
		"replacement_ready",
		"recovery_verified",
	]);
});
