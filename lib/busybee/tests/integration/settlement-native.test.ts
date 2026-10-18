/* eslint-disable import/no-nodejs-modules -- Disposable native endpoints verify retirement and tracker transport. */
/* eslint-disable max-statements -- Joined native proof keeps all subject setup and transport in measured bodies. */
import { complete, navigate, start } from "../../src/runtime.ts";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { expect, test } from "bun:test";
import { invoke, useNativeFixture, writeDefinition } from "./support.ts";
import type { Endpoint } from "../../src/native.ts";
import type { ExecutionClearanceSelection } from "@hive/shared";
import { createNativeBeads } from "@hive/beads";
import { join } from "node:path";
import { parseWorkflowClosure } from "@hive/shared";

const FIRST = 0;
const SECOND = 1;
const fixture = useNativeFixture("busybee-retirement-");
const body = `
export const commandSchemas={next:z.object({decision:z.string()})};
export const machine=createMachine({initial:"first",states:{
first:{meta:{title:"First",commands:{next:"NEXT"},task:()=>({instructions:"Decide"})},on:{NEXT:"second"}},
second:{meta:{title:"Second",commands:{next:"NEXT"},task:()=>({instructions:"Continue"})},on:{NEXT:"done"}},
done:{type:"final"}}});`;

test(
	"#test-82 cancelled replacement and preserved successful visit survive " +
		"native export/import without source",
	async () => {
		const selected = await scenario();
		const visit = selected.run.active[FIRST]!.bead;
		const data = { decision: "rejected", extra: ["original"] };
		await complete(
			{ id: selected.run.id, bead: visit, choice: "next", data },
			selected.options,
			selected.services,
		);
		const completed = await selected.services.beads.show(selected.scope, visit);
		const advanced = await navigate(
			{ id: selected.run.id, operation: "collect" },
			selected.options,
			selected.services,
		);
		const replacement = await start(
			selected.source,
			{ ...selected.options, parent: selected.parent },
			selected.services,
		);
		await rm(join(fixture.root, "retirement"), { recursive: true });
		const result = await invoke(
			[
				...selected.args,
				"settle",
				selected.run.id,
				"cancel",
				"--reason",
				"Withdraw remaining scope",
				"--replacement",
				replacement.id,
			],
			selected.sourceFree,
		);
		expect(result).toMatchObject({
			code: 0,
			document: {
				kind: "workflow_settlement",
				lifecycle: { fact: { outcome: "cancelled" } },
				resolution: { kind: "superseded", replacementIds: [replacement.id] },
				publication: { locked: false, settlement: "none" },
			},
		});
		const preserved = await selected.services.beads.show(selected.scope, visit);
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
		const remaining = await selected.services.beads.show(
			selected.scope,
			advanced.active[FIRST]!.bead,
		);
		expect(parseWorkflowClosure(remaining.close_reason)).toMatchObject({
			scope: "visit",
			outcome: "cancelled",
			runId: selected.run.id,
		});
		expect(remaining.notes).toBe("");
		const imported = await transport(selected);
		const inspected = await invoke(
			[...imported.args, "inspect", selected.run.id],
			imported.services,
		);
		expect(inspected).toMatchObject({
			code: 0,
			document: {
				lifecycle: { fact: { outcome: "cancelled" } },
				resolution: { kind: "superseded", replacementIds: [replacement.id] },
			},
		});
		expect(
			await imported.services.beads.showMany(imported.scope, [
				selected.run.id,
				visit,
				remaining.id,
				replacement.id,
			]),
		).toEqual(
			await selected.services.beads.showMany(selected.scope, [
				selected.run.id,
				visit,
				remaining.id,
				replacement.id,
			]),
		);
	},
);

test("#test-83 failed acknowledgment and replacement remain failed after independent native transport", async () => {
	const selected = await scenario();
	const replacement = await start(
		selected.source,
		{ ...selected.options, parent: selected.parent },
		selected.services,
	);
	await rm(join(fixture.root, "retirement"), { recursive: true });
	expect(
		await invoke(
			[
				...selected.args,
				"settle",
				selected.run.id,
				"fail",
				"--reason",
				"Cannot deliver the remaining scope",
			],
			selected.sourceFree,
		),
	).toMatchObject({
		code: 0,
		document: { lifecycle: { fact: { outcome: "failed" } }, resolution: { kind: "unresolved" } },
	});
	const closed = await selected.services.beads.show(selected.scope, selected.run.id);
	expect(
		await invoke(
			[...selected.args, "settle", selected.run.id, "ack", "--reason", "Accepted failure"],
			selected.sourceFree,
		),
	).toMatchObject({
		code: 0,
		document: {
			lifecycle: { fact: { outcome: "failed" } },
			resolution: {
				kind: "acknowledged",
				actor: selected.options.actor,
				reason: "Accepted failure",
			},
		},
	});
	const acknowledged = await transport(selected);
	expect(
		await invoke([...acknowledged.args, "inspect", selected.run.id], acknowledged.services),
	).toMatchObject({
		code: 0,
		document: {
			lifecycle: { fact: { outcome: "failed" } },
			resolution: { kind: "acknowledged", actor: selected.options.actor },
		},
	});
	expect(
		await invoke(
			[
				...selected.args,
				"settle",
				selected.run.id,
				"supersede",
				"--reason",
				"Replacement scope",
				"--replacement",
				replacement.id,
			],
			selected.sourceFree,
		),
	).toMatchObject({
		code: 0,
		document: {
			lifecycle: { fact: { outcome: "failed" } },
			resolution: { kind: "superseded", replacementIds: [replacement.id] },
		},
	});
	await selected.services.beads.sync.flush(selected.scope);
	await copyFile(
		join(selected.options.repo, ".beads/issues.jsonl"),
		join(acknowledged.scope.cwd, ".beads/issues.jsonl"),
	);
	await acknowledged.services.beads.sync.import(acknowledged.scope);
	const final = await acknowledged.services.beads.show(acknowledged.scope, selected.run.id);
	expect(final.close_reason).toBe(closed.close_reason);
	expect(final.closed_at).toBe(closed.closed_at);
	expect(
		await invoke([...acknowledged.args, "inspect", selected.run.id], acknowledged.services),
	).toMatchObject({
		code: 0,
		document: {
			lifecycle: { fact: { outcome: "failed" } },
			resolution: { kind: "superseded", replacementIds: [replacement.id] },
		},
	});
});

test("#test-84 ordinary native close refusal retains intent and truthful unfinished retirement", async () => {
	const selected = await scenario();
	const visit = selected.run.active[FIRST]!.bead;
	const services = {
		...selected.sourceFree,
		beads: {
			...selected.services.beads,
			close: async (...args: Parameters<typeof selected.services.beads.close>) => {
				if (args[SECOND] === visit) {
					await selected.services.beads.create(selected.scope, {
						title: "Concurrent manual child",
						parent: visit,
					});
				}
				return selected.services.beads.close(...args);
			},
		},
	};
	const result = await invoke(
		[...selected.args, "settle", selected.run.id, "fail", "--reason", "Refused native closure"],
		services,
	);
	expect(result).toMatchObject({
		code: 1,
		document: { ok: false, reason: "partial_effects", attemptedId: visit, confirmedClosedIds: [] },
	});
	expect(
		await invoke([...selected.args, "inspect", selected.run.id], selected.sourceFree),
	).toMatchObject({
		code: 0,
		document: {
			lifecycle: { kind: "pending" },
			publication: { locked: true, settlement: "pending" },
		},
	});
	const record = await selected.services.beads.show(selected.scope, visit);
	expect(record.status).toBe("in_progress");
	expect(record.close_reason).toBeUndefined();
	expect(record.notes).toBe("");
});

// --- Private functions ---

async function scenario() {
	const { options } = fixture;
	const scope = { actor: options.actor, cwd: options.repo, db: options.db };
	const services = {
		...fixture.services,
		executionClearance: (selection: ExecutionClearanceSelection, endpoint: Endpoint) =>
			Promise.resolve({
				kind: "execution-clearance" as const,
				repository: { root: endpoint.repo, beadsDb: endpoint.db },
				host: "fixture-host",
				observedAt: "sampled",
				scope: selection,
				result: { kind: "clear" as const, proof: "no-managed-requests" as const, requests: [] },
			}),
	};
	const parent = await services.beads.create(scope, { title: "Pilot B", owner: options.owner });
	const source = await writeDefinition(fixture, "retirement", body);
	const run = await start(source, { ...options, parent: parent.id }, services);
	return {
		options,
		scope,
		source,
		run,
		parent: parent.id,
		services,
		args: ["--repo", options.repo, "--db", options.db, "--actor", options.actor],
		sourceFree: {
			...services,
			importModule: () => Promise.reject(new Error("No source access")),
			readBytes: () => Promise.reject(new Error("No source access")),
		},
	};
}

async function transport(selected: Awaited<ReturnType<typeof scenario>>) {
	await selected.services.beads.sync.flush(selected.scope);
	const remote = join(fixture.root, "independent");
	await mkdir(remote);
	const db = join(remote, ".beads/beads.db");
	await fixture.services.execute(
		["br", "init", "--db", db, "--prefix", "test", "--actor", selected.options.actor],
		remote,
	);
	await copyFile(
		join(selected.options.repo, ".beads/issues.jsonl"),
		join(remote, ".beads/issues.jsonl"),
	);
	const beads = createNativeBeads({ env: fixture.env });
	const scope = { ...selected.scope, cwd: remote, db, noAutoImport: true, noAutoFlush: true };
	await beads.sync.import(scope);
	return {
		scope,
		services: { ...selected.sourceFree, beads },
		args: ["--repo", remote, "--db", db],
	};
}
