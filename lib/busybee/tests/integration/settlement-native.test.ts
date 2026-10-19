/* eslint-disable import/no-nodejs-modules -- Disposable native endpoints verify retirement and tracker transport. */
/* eslint-disable max-statements -- Joined native proof keeps all subject setup and transport in measured bodies. */
import { expect, test } from "bun:test";
import { invoke, useNativeFixture, writeDefinition } from "./support.ts";
import type { Endpoint } from "../../src/native.ts";
import type { ExecutionClearanceSelection } from "@hive/shared";
import { start } from "../../src/runtime.ts";

const FIRST = 0;
const SECOND = 1;
const fixture = useNativeFixture("busybee-retirement-");
const body = `
export const commandSchemas={next:z.object({decision:z.string()})};
export const machine=createMachine({initial:"first",states:{
first:{meta:{title:"First",commands:{next:"NEXT"},task:()=>({instructions:"Decide"})},on:{NEXT:"second"}},
second:{meta:{title:"Second",commands:{next:"NEXT"},task:()=>({instructions:"Continue"})},on:{NEXT:"done"}},
done:{type:"final"}}});`;

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
