/* eslint-disable import/max-dependencies --
 * Keep dispatch's tracker, admission and store fixtures together.
 */
import { SPAWN_REQUEST_LABELS, readSpawnRequest } from "@hive/shared";
import { createSpawn, createTask, memoryTracker } from "./tracker.test-support.ts";
import { expect, mock, test } from "bun:test";
import { newRequest, transitionRequest } from "./request.ts";
import type { BeesConfig } from "@hive/shared";
import { CommandError } from "@hive/beads";
import type { DispatchInput } from "./dispatch.ts";
import type { RequestRecord } from "./request.ts";
import type { Store } from "./store.ts";
import { createAdmissionGate } from "./admission.ts";
import { dispatch } from "./dispatch.ts";
import { trackerScope } from "./tracker.ts";

const ONE = 1;
const state = "/fixture/dispatch-projection";
const config: BeesConfig = {
	formulas: {},
	humans: ["ct"],
	owner: "ct",
	kinds: {},
	limits: { colony: 4, kind: 2, kinds: {}, worktree: 2 },
	max_retries: 3,
	ranking: "bv-pagerank",
	retry_delay_ms: 250,
};
const failureCases = ["closed", "open"];
const driftCases = ["host", "tasks"];

/* eslint-disable-next-line max-statements --
 * Keep paused repair, concurrent creation and the resulting read/write order in one test.
 */
test("discovery waits for closed repair and sees a misprojected request created during repair #test-669", async () => {
	const serial = await projectionFixture();
	const closed = await createSpawn(serial, serial.task);
	await serial.beads.close(serial.scope, closed, { reason: "completed" });
	const { beads, scope, store } = serial;
	const entered = Promise.withResolvers<void>();
	const resume = Promise.withResolvers<void>();
	const order: string[] = [];
	const list = mock(beads.list);
	const listProjected = mock((...args: Parameters<typeof beads.listProjected>) => {
		order.push(`list:${args[ONE].status?.join(",")}`);
		return beads.listProjected(...args);
	});
	const update = mock(async (...args: Parameters<typeof beads.update>) => {
		if (args[ONE].includes(closed)) {
			order.push("repair:pending");
			entered.resolve();
			await resume.promise;
		}
		const result = await beads.update(...args);
		if (args[ONE].includes(closed)) {
			order.push("repair:written");
		}
		return result;
	});
	const showMany = mock((...args: Parameters<typeof beads.showMany>) => {
		order.push("retained");
		return beads.showMany(...args);
	});
	const running = dispatch(
		{ ...serial, beads: { ...beads, list, listProjected, update, showMany }, state },
		config,
		"fixture",
	);
	await entered.promise;
	let created = "";
	try {
		expect(order).toEqual(["retained", "list:closed", "repair:pending"]);
		expect(store.requests(serial.repository.root)).toEqual([]);
		created = await createSpawn(serial, serial.task, {
			labels: [
				...SPAWN_REQUEST_LABELS,
				"agent:worker",
				"bee-outcome:failed",
				"bee-resolution:resolved",
			],
		});
	} finally {
		resume.resolve();
		await running;
	}
	expect(order).toEqual([
		"retained",
		"list:closed",
		"repair:pending",
		"repair:written",
		"list:open",
	]);
	expect(list).not.toHaveBeenCalled();
	expect(listProjected.mock.calls).toEqual([
		[
			scope,
			{ status: ["closed"], labels: [...SPAWN_REQUEST_LABELS, "bee-outcome:pending"], limit: 0 },
			["id", "description"],
		],
		[scope, { status: ["open"], labels: SPAWN_REQUEST_LABELS, limit: 0 }, ["id", "description"]],
	]);
	expect(store.requests(serial.repository.root)).toMatchObject([
		{ id: created, state: "waiting", context: { taskIds: [serial.task], claims: [] } },
	]);
	expect(await beads.show(scope, closed)).toMatchObject({
		status: "closed",
		labels: expect.arrayContaining(["bee-outcome:succeeded", "bee-resolution:resolved"]),
	});
	expect(await beads.show(scope, created)).toMatchObject({
		labels: expect.arrayContaining(["bee-outcome:pending", "bee-resolution:unresolved"]),
	});
	expect(await beads.show(scope, serial.task)).toMatchObject({ status: "open", labels: ["hitl"] });
	expect(update.mock.calls.map(([, ids]) => ids)).toEqual([[closed], [created]]);
});

test.each(failureCases)(
	"native %s projection errors propagate without falling back to full lists",
	async (status) => {
		const fixture = await projectionFixture();
		const error = new CommandError("br list", {
			code: 1,
			stdout: "",
			stderr: "fixture query failure",
		});
		const list = mock(fixture.beads.list);
		const listProjected = mock((...args: Parameters<typeof fixture.beads.listProjected>) => {
			if (args[ONE].status?.includes(status)) {
				return Promise.reject(error);
			}
			return fixture.beads.listProjected(...args);
		});
		await expect(
			dispatch(
				{ ...fixture, beads: { ...fixture.beads, list, listProjected }, state },
				config,
				"fixture",
			),
		).rejects.toBe(error);
		expect(list).not.toHaveBeenCalled();
		expect(fixture.store.requests(fixture.repository.root)).toEqual([]);
	},
);

test.each(driftCases)(
	"waiting discovery rejects %s drift without replacing captured authority",
	async (field) => {
		const fixture = await waitingFixture();
		const { beads, scope, id, record } = fixture;
		const listProjected = mock(async (...args: Parameters<typeof beads.listProjected>) => {
			const page = await beads.listProjected(...args);
			if (args[ONE].status?.includes("open")) {
				if (field === "host") {
					const captured = readSpawnRequest(await beads.show(scope, id));
					await beads.update(scope, [id], {
						description: JSON.stringify({
							...captured.recipe,
							assignment: captured.assignment,
							host: "foreign-host",
						}),
					});
				} else {
					await beads.dep.add(scope, id, fixture.extra, "related");
				}
			}
			return page;
		});
		const update = mock(beads.update);
		await expect(
			dispatch(
				{ ...fixture, beads: { ...beads, listProjected, update }, state },
				config,
				"fixture",
			),
		).rejects.toBeInstanceOf(Error);
		expect(update).not.toHaveBeenCalled();
		expect(fixture.store.requests(fixture.repository.root)).toEqual([record]);
		const task = await beads.show(scope, fixture.task);
		expect(task.assignee).toBeUndefined();
	},
);

async function projectionFixture() {
	const tracker = memoryTracker();
	const scope = trackerScope(tracker.repository, "sys-colony");
	const task = await createTask(tracker, { labels: ["hitl"] });
	const records = new Map<string, RequestRecord>();
	const store: DispatchInput["store"] = {
		reserve: unexpectedLaunch,
		supervisor: unexpectedLaunch,
		history: {
			run: (_input, action) =>
				action({ completed: () => {}, failed: () => {}, reference: () => {}, step: () => {} }),
		} satisfies Store["history"],
		request: (_root: string, id: string) => records.get(id),
		requests: (_root: string) => [...records.values()],
		saveRequest: (_root: string, record: RequestRecord) => {
			records.set(record.id, record);
		},
		advanceRequest: ((_root, record, event) => {
			const next = transitionRequest(record, event);
			records.set(next.id, next);
			return next;
		}) satisfies Store["advanceRequest"],
		inventory: () => Promise.resolve([]),
		retainedInventory: () => [],
		currentAttempts: () => [],
	};
	return {
		...tracker,
		bv: {
			readPageRanks: () => {
				throw new Error("Unexpected ranking for ineligible requests");
			},
		},
		store,
		scope,
		task,
		withAdmission: createAdmissionGate(),
	};
}

async function waitingFixture() {
	const fixture = await projectionFixture();
	const id = await createSpawn(fixture, fixture.task);
	const extra = await createTask(fixture);
	const record = newRequest(await fixture.beads.show(fixture.scope, id), fixture.repository);
	fixture.store.saveRequest(fixture.repository.root, record);
	return { ...fixture, id, extra, record };
}

function unexpectedLaunch(): never {
	throw new Error("Ineligible fixture unexpectedly launched an attempt");
}
