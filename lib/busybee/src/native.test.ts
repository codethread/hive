import {
	BusyBeeError,
	closeTask,
	conditionalUpdate,
	createServices,
	resolveMutation,
} from "./native.ts";
import { CommandError, createMemoryBeads } from "@hive/beads";
import { expect, test } from "bun:test";
import type { BeadsService } from "@hive/beads";
import type { Services } from "./native.ts";

const endpoint = { actor: "worker", db: "/tracker/beads.db", repo: "/execution" };
const scope = { actor: endpoint.actor, cwd: endpoint.repo, db: endpoint.db };
const VALIDATION = 4;
const CONFLICT = 6;

test("missing mutation actor fails before endpoint discovery or publication", async () => {
	const calls: string[] = [];
	const services: Services = {
		...createServices(),
		actor: undefined,
		beads: {
			...createMemoryBeads(),
			where: () => {
				calls.push("where");
				return Promise.reject(new Error("Actor must be checked before discovery"));
			},
		},
		beforeWrite: () => {
			calls.push("write");
		},
	};
	const failure: unknown = await resolveMutation({}, services).catch((error: unknown) => error);
	expect(failure).toBeInstanceOf(BusyBeeError);
	expect(failure).toMatchObject({ reason: "missing_actor" });
	expect(calls).toEqual([]);
});

test.each([
	{ code: CONFLICT, conflict: true },
	{ code: VALIDATION, conflict: false },
])(
	"conditional writes preserve revision guards and classify native failure $code",
	// Keep the CAS scope, publication marker and fault classification in one boundary check.
	// eslint-disable-next-line max-statements
	async ({ code, conflict }) => {
		const beads = createMemoryBeads();
		const bead = await beads.create(scope, { title: "Checkpoint" });
		const failure = new CommandError("br update", { code, stderr: "", stdout: "" });
		const updates: Parameters<BeadsService["update"]>[] = [];
		const calls: string[] = [];
		const services: Services = {
			...createServices(),
			beads: {
				...beads,
				update: (...args) => {
					updates.push(args);
					calls.push("update");
					return Promise.reject(failure);
				},
			},
			beforeWrite: () => {
				calls.push("beforeWrite");
			},
		};
		const result = conditionalUpdate({ bead, endpoint, input: { notes: "owner" } }, services);
		if (conflict) {
			expect(await result).toBe(false);
		} else {
			await expect(result).rejects.toBe(failure);
		}
		expect(updates).toEqual([
			[scope, [bead.id], { force: true, ifUnchanged: bead.updated_at, notes: "owner" }],
		]);
		expect(calls).toEqual(["beforeWrite", "update"]);
	},
);

test("closure reads state before marking a write and leaves an already closed task alone", async () => {
	const beads = createMemoryBeads();
	const task = await beads.create(scope, { title: "Worker" });
	const calls: string[] = [];
	const services: Services = {
		...createServices(),
		beads: {
			...beads,
			close: (...args) => {
				calls.push("close");
				return beads.close(...args);
			},
			show: (...args) => {
				calls.push("show");
				return beads.show(...args);
			},
		},
		beforeWrite: () => {
			calls.push("beforeWrite");
		},
	};
	await closeTask(endpoint, task.id, services);
	await closeTask(endpoint, task.id, services);
	expect(calls).toEqual(["show", "beforeWrite", "close", "show"]);
	await expect(beads.show(scope, task.id)).resolves.toMatchObject({
		close_reason: "Completed: XState step finished.",
		status: "closed",
	});
});
