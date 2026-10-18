// Disposable native endpoints verify closure publication and tracker transport.
/* eslint-disable import/no-nodejs-modules */
import { complete, navigate, start } from "../../src/runtime.ts";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { expect, test } from "bun:test";
import { invoke, useNativeFixture, writeDefinition } from "./support.ts";
import { createNativeBeads } from "@hive/beads";
import { join } from "node:path";
import { parseWorkflowClosure } from "@hive/shared";

const MAX_INSPECTION_BYTES = 1500;
const FIRST = 0;
const SECOND = 1;
const fixture = useNativeFixture("busybee-lifecycle-");

// This complete native round trip is the acceptance boundary, rather than an adapter mock.
// eslint-disable-next-line max-statements
test("#test-73 authored rejection survives independent native exchange as successful execution", async () => {
	const { services, options } = fixture;
	const scope = { actor: options.actor, cwd: options.repo, db: options.db };
	const parent = await services.beads.create(scope, { title: "Pilot", owner: options.owner });
	const source = await writeDefinition(
		fixture,
		"negative",
		`
export const commandSchemas={reject:z.object({accepted:z.literal(false),detail:z.string()})};
export const machine=createMachine({initial:"group",states:{
group:{meta:{title:"Decision group",task:()=>({instructions:"Decide"})},initial:"work",states:{
work:{meta:{title:"Decide",commands:{reject:"REJECT"},
 task:()=>({instructions:"Reject the proposal"})},on:{REJECT:"done"}},
done:{type:"final"}},onDone:"done"},done:{type:"final"}}});`,
	);
	const run = await start(source, { ...options, parent: parent.id }, services);
	const visit = run.active.find((entry) => entry.commands.includes("reject"))!.bead;
	const child = await services.beads.create(scope, { title: "Outstanding child", parent: visit });
	const data = { accepted: false, detail: "Authored rejection", extra: ["preserved"] };
	const request = { id: run.id, bead: visit, choice: "reject", data };
	await expect(complete(request, options, services)).rejects.toMatchObject({
		reason: "stage_close_failed",
	});
	const refusedRecords = await services.beads.showMany(scope, [visit, run.id]);
	const savedVisit = refusedRecords[FIRST]!;
	const pendingRun = refusedRecords[SECOND]!;
	expect(savedVisit).toMatchObject({
		status: "in_progress",
		notes: JSON.stringify({ choice: "reject", data }),
	});
	expect(savedVisit.close_reason).toBeUndefined();
	expect(pendingRun).toMatchObject({ status: "in_progress" });
	expect(pendingRun.close_reason).toBeUndefined();
	const checkpointId = pendingRun.dependencies.find(
		(edge) => edge.dependency_type === "related",
	)!.id;
	const savedCheckpoint = await services.beads.show(scope, checkpointId);
	expect(savedCheckpoint.notes).toBe("");
	const original = savedVisit.notes;
	await services.beads.close(scope, child.id, { reason: "Child satisfied" });
	await complete(request, options, services);
	expect(await navigate({ id: run.id, operation: "collect" }, options, services)).toMatchObject({
		status: "done",
	});
	const generatedIds = [run.id, ...run.created.map((entry) => entry.bead)];
	const closedEntries = await services.beads.showMany(scope, generatedIds);
	for (const closed of closedEntries) {
		let expectedScope = "group";
		if (closed.id === run.id) {
			expectedScope = "run";
		}
		if (closed.id === visit) {
			expectedScope = "visit";
			expect(closed.notes).toBe(original);
		}
		expect(parseWorkflowClosure(closed.close_reason)).toMatchObject({
			runId: run.id,
			outcome: "succeeded",
			scope: expectedScope,
		});
	}
	await services.beads.sync.flush(scope);
	const remote = join(fixture.root, "independent");
	await mkdir(remote);
	const remoteDb = join(remote, ".beads/beads.db");
	await services.execute(
		["br", "init", "--db", remoteDb, "--prefix", "test", "--actor", options.actor],
		remote,
	);
	await copyFile(join(options.repo, ".beads/issues.jsonl"), join(remote, ".beads/issues.jsonl"));
	const native = createNativeBeads({ env: fixture.env });
	const remoteScope = {
		...scope,
		cwd: remote,
		db: remoteDb,
		noAutoImport: true,
		noAutoFlush: true,
	};
	await native.sync.import(remoteScope);
	await rm(join(fixture.root, "negative"), { recursive: true });
	const isolated = {
		...services,
		beads: native,
		importModule: () => Promise.reject(new Error("Source unavailable")),
		readBytes: () => Promise.reject(new Error("Source unavailable")),
	};
	const inspected = await invoke(["--repo", remote, "--db", remoteDb, "inspect", run.id], isolated);
	expect(inspected).toMatchObject({
		code: 0,
		stderr: "",
		document: {
			ok: true,
			kind: "workflow_lifecycle",
			runId: run.id,
			nativeStatus: "closed",
			lifecycle: { kind: "terminal", fact: { scope: "run", outcome: "succeeded", runId: run.id } },
			publication: { locked: false },
		},
	});
	const importedRecords = await native.showMany(remoteScope, generatedIds);
	expect(importedRecords).toEqual(closedEntries);
	expect(inspected.stdout.length).toBeLessThan(MAX_INSPECTION_BYTES);
});
