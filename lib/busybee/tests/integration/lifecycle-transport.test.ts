/* eslint-disable max-statements -- Each measured body owns one complete native lifecycle trace. */
import {
	WORKFLOW_ACKNOWLEDGMENT_PREFIX,
	nativeWorkflowState,
	workflowAdvanceSchema,
} from "@hive/shared";
import {
	exchange,
	importTracker,
	inspectNative,
	removeSource,
	scenario,
} from "./lifecycle-transport-support.ts";
import { expect, test } from "bun:test";
import { invoke, useNativeFixture } from "./support.ts";
import { start } from "../../src/runtime.ts";

const FIRST = 0;
const SUCCESS = 0;
const FAILURE = 1;
const fixture = useNativeFixture("busybee-lifecycle-transport-");
const decisionBody = `
export const commandSchemas={reject:z.object({accepted:z.literal(false),detail:z.string()})};
export const machine=createMachine({initial:"group",states:{
group:{meta:{title:"Decision group",task:()=>({instructions:"Decide"})},initial:"work",states:{
work:{meta:{title:"Decide",commands:{reject:"REJECT"},
 task:()=>({instructions:"Reject the proposal"})},on:{REJECT:"done"}},
done:{type:"final"}},onDone:"done"},done:{type:"final"}}});`;
const sequenceBody = `
export const commandSchemas={next:z.object({decision:z.string()})};
export const machine=createMachine({initial:"first",states:{
first:{meta:{title:"First",commands:{next:"NEXT"},task:()=>({instructions:"Decide"})},on:{NEXT:"second"}},
second:{meta:{title:"Second",commands:{next:"NEXT"},task:()=>({instructions:"Continue"})},on:{NEXT:"done"}},
done:{type:"final"}}});`;
const singleBody = `
export const commandSchemas={next:z.object({})};
export const machine=createMachine({initial:"work",states:{
work:{meta:{title:"Work",commands:{next:"NEXT"},task:()=>({instructions:"Deliver"})},on:{NEXT:"done"}},
done:{type:"final"}}});`;

test("#test-300 grouped authored rejection retries native refusal and transports successful facts", async () => {
	const selected = await scenario(fixture, decisionBody);
	const { services, scope, run, args } = selected;
	const visit = run.active.find((entry) => entry.commands.includes("reject"))!.bead;
	const group = run.created.find((entry) => entry.bead !== visit)!.bead;
	const child = await services.beads.create(scope, { title: "Unfinished child", parent: visit });
	const data = {
		accepted: false,
		detail: "Authored rejection",
		extra: ["original", { retained: true }],
	};
	const original = JSON.stringify({ choice: "reject", data });
	const completion = [...args, "--data", JSON.stringify(data), "complete", run.id, visit, "reject"];
	expect(await invoke(completion, services)).toMatchObject({
		code: FAILURE,
		document: { ok: false, reason: "stage_close_failed", resultSaved: true },
	});
	const refused = await services.beads.showMany(scope, [visit, group, run.id]);
	expect(refused.find(({ id }) => id === visit)!.notes).toBe(original);
	for (const record of refused) {
		expect(record.status).not.toBe("closed");
		expect(record.close_reason).toBeUndefined();
		expect(record.closed_at).toBeUndefined();
	}
	const pending = refused.find(({ id }) => id === run.id)!;
	expect(pending.notes).toBe("");
	const checkpoint = pending.dependencies.find(
		({ dependency_type }) => dependency_type === "related",
	)!.id;
	expect(await services.beads.show(scope, checkpoint)).toMatchObject({ notes: "" });
	await services.beads.close(scope, child.id, { reason: "Child completed" });
	expect(await invoke(completion, services)).toMatchObject({
		code: SUCCESS,
		document: { ok: true },
	});
	const advanced = await invoke([...args, "advance", run.id], services);
	expect(advanced).toMatchObject({
		code: SUCCESS,
		document: {
			kind: "workflow_advance",
			mode: "results",
			runId: run.id,
			status: "done",
			active: [],
		},
	});
	await removeSource(selected);
	const imported = await importTracker(selected);
	expect(await inspectNative(imported, run.id)).toMatchObject({
		nativeStatus: "closed",
		lifecycle: { kind: "terminal", fact: { runId: run.id, scope: "run", outcome: "succeeded" } },
		resolution: { kind: "resolved" },
	});
	for (const [id, expectedScope] of [
		[run.id, "run"],
		[group, "group"],
		[visit, "visit"],
	] as const) {
		const record = imported.records.find((entry) => entry.id === id)!;
		expect(nativeWorkflowState(record, { runId: run.id, scope: expectedScope })).toMatchObject({
			kind: "terminal",
			fact: { outcome: "succeeded" },
		});
	}
	expect(imported.records.find(({ id }) => id === visit)!.notes).toBe(original);
});

test("#test-301 cancellation transports completed evidence and same-parent replacement provenance", async () => {
	const selected = await scenario(fixture, sequenceBody);
	const { services, scope, run, args } = selected;
	const visit = run.active[FIRST]!.bead;
	const data = { decision: "rejected", extra: ["unchanged"] };
	expect(
		await invoke(
			[...args, "--data", JSON.stringify(data), "complete", run.id, visit, "next"],
			services,
		),
	).toMatchObject({ code: SUCCESS });
	const completed = await services.beads.show(scope, visit);
	expect(completed.notes).toBe(JSON.stringify({ choice: "next", data }));
	expect(nativeWorkflowState(completed, { runId: run.id, scope: "visit" })).toMatchObject({
		kind: "terminal",
		fact: { outcome: "succeeded" },
	});
	const advanced = await invoke([...args, "advance", run.id], services);
	expect(advanced.code, advanced.stdout).toBe(SUCCESS);
	const frontier = workflowAdvanceSchema.options[FIRST].parse(advanced.document);
	const remaining = frontier.active[FIRST]!.bead;
	expect(remaining).not.toBe(visit);
	const replacement = await start(
		selected.source,
		{ ...fixture.options, parent: selected.parent },
		services,
	);
	await removeSource(selected);
	expect(
		await invoke(
			[
				...args,
				"settle",
				run.id,
				"cancel",
				"--reason",
				"Withdraw remaining scope",
				"--replacement",
				replacement.id,
			],
			selected.sourceFree,
		),
	).toMatchObject({
		code: SUCCESS,
		document: {
			kind: "workflow_settlement",
			lifecycle: { fact: { outcome: "cancelled" } },
			resolution: { kind: "superseded", replacementIds: [replacement.id] },
			publication: { locked: false, settlement: "none" },
		},
	});
	const imported = await importTracker(selected);
	expect(await inspectNative(imported, run.id)).toMatchObject({
		lifecycle: { kind: "terminal", fact: { outcome: "cancelled" } },
		resolution: { kind: "superseded", replacementIds: [replacement.id] },
	});
	const received = imported.records;
	const preserved = received.find(({ id }) => id === visit)!;
	expect({
		notes: preserved.notes,
		reason: preserved.close_reason,
		closedAt: preserved.closed_at,
		updatedAt: preserved.updated_at,
	}).toEqual({
		notes: completed.notes,
		reason: completed.close_reason,
		closedAt: completed.closed_at,
		updatedAt: completed.updated_at,
	});
	const cancelled = received.find(({ id }) => id === remaining)!;
	expect(cancelled.notes).toBe("");
	expect(nativeWorkflowState(cancelled, { runId: run.id, scope: "visit" })).toMatchObject({
		kind: "terminal",
		fact: { outcome: "cancelled" },
	});
	const incoming = received.find(({ id }) => id === run.id)!;
	const successor = received.find(({ id }) => id === replacement.id)!;
	expect(incoming.dependents).toContainEqual(
		expect.objectContaining({ id: replacement.id, dependency_type: "supersedes" }),
	);
	expect(successor.dependencies).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ id: run.id, dependency_type: "supersedes" }),
			expect.objectContaining({ id: selected.parent, dependency_type: "parent-child" }),
		]),
	);
	expect(incoming.notes).toBe("");
});

test("#test-302 failed closure transports acknowledgment then replacement without rewriting failure", async () => {
	const selected = await scenario(fixture, singleBody);
	const { services, scope, run, args } = selected;
	const replacement = await start(
		selected.source,
		{ ...fixture.options, parent: selected.parent },
		services,
	);
	await removeSource(selected);
	expect(
		await invoke(
			[...args, "settle", run.id, "fail", "--reason", "Cannot deliver"],
			selected.sourceFree,
		),
	).toMatchObject({
		code: SUCCESS,
		document: { lifecycle: { fact: { outcome: "failed" } }, resolution: { kind: "unresolved" } },
	});
	const closed = await services.beads.show(scope, run.id);
	expect(
		await invoke(
			[...args, "settle", run.id, "ack", "--reason", "Accept failed execution"],
			selected.sourceFree,
		),
	).toMatchObject({
		code: SUCCESS,
		document: {
			lifecycle: { fact: { outcome: "failed" } },
			resolution: { kind: "acknowledged", actor: scope.actor, reason: "Accept failed execution" },
		},
	});
	const imported = await importTracker(selected);
	const acknowledged = await inspectNative(imported, run.id);
	expect(acknowledged).toMatchObject({
		lifecycle: { kind: "terminal", closedAt: closed.closed_at, fact: { outcome: "failed" } },
		resolution: { kind: "acknowledged", actor: scope.actor, reason: "Accept failed execution" },
	});
	const transported = imported.records.find(({ id }) => id === run.id)!;
	expect(transported.close_reason).toBe(closed.close_reason);
	expect(transported.closed_at).toBe(closed.closed_at);
	const acknowledgment = transported.comments.find(({ text }) =>
		text.startsWith(WORKFLOW_ACKNOWLEDGMENT_PREFIX),
	)!;
	expect(JSON.parse(acknowledgment.text.slice(WORKFLOW_ACKNOWLEDGMENT_PREFIX.length))).toEqual({
		closedAt: closed.closed_at,
		closeReason: closed.close_reason,
		reason: "Accept failed execution",
	});
	expect(acknowledgment.author).toBe(scope.actor);
	expect(
		await invoke(
			[
				...args,
				"settle",
				run.id,
				"supersede",
				"--reason",
				"Replacement scope",
				"--replacement",
				replacement.id,
			],
			selected.sourceFree,
		),
	).toMatchObject({
		code: SUCCESS,
		document: {
			lifecycle: { fact: { outcome: "failed" } },
			resolution: { kind: "superseded", replacementIds: [replacement.id] },
		},
	});
	const received = await exchange(selected, imported);
	const final = received.find(({ id }) => id === run.id)!;
	expect(final.close_reason).toBe(closed.close_reason);
	expect(final.closed_at).toBe(closed.closed_at);
	expect(final.comments).toContainEqual(acknowledgment);
	expect(await inspectNative(imported, run.id)).toMatchObject({
		lifecycle: { kind: "terminal", closedAt: closed.closed_at, fact: { outcome: "failed" } },
		resolution: { kind: "superseded", replacementIds: [replacement.id] },
	});
});
