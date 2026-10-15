/* eslint-disable unicorn/no-null -- Engine checkpoints use null for optional dispatch references. */
import { BusyBeeError, createServices } from "../../src/native.ts";
import { beforeEach, expect, test } from "bun:test";
import { createMachine, fromPromise } from "xstate";
import type { Run } from "../../src/checkpoint.ts";
import { captureCli } from "./support.ts";
import { createMemoryBeads } from "@hive/beads";
import { machine as landMachine } from "../../../../.workflows/land/workflow.ts";
import { preview } from "../../src/preview.ts";
import { workflowPreviewSchema } from "@hive/shared";
import { z } from "zod";

const ZERO = 0;
const SUCCESS = 0;
const FAILURE = 1;
const repo = "/preview";
const db = "/tracker/beads.db";
const scope = { actor: "test-agent", cwd: repo, db };
const options = { repo, db };
const emptySchema = z.object({});
const bytes = new TextEncoder().encode("original").buffer;
const originalHash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
let fixture = await memoryTracker();

beforeEach(async () => {
	fixture = await memoryTracker();
});

// eslint-disable-next-line max-statements -- Assert the complete public privacy/no-effects contract in one invocation.
test("preview CLI returns saved root/child state and stripped guarded structure without effects", async () => {
	const before = await fixture.records();
	const result = await captureCli(["preview", fixture.id, "--json"], fixture.services);
	expect(result.code).toBe(SUCCESS);
	expect(result.stderr).toBe("");
	const document: unknown = JSON.parse(result.stdout);
	expect(document).toMatchObject({ kind: "workflow_preview", ok: true });
	const output = workflowPreviewSchema.parse(document);
	expect(output).toMatchObject({
		runId: fixture.id,
		title: "Saved run title",
		checkpoint: fixture.checkpointId,
		savedAt: before[FAILURE]!.updated_at,
		definition: {
			label: "Explicit workflow",
			savedHash: originalHash,
			currentHash: originalHash,
			sourceMatch: "exact",
		},
		actors: [
			{
				id: "actor:[]",
				path: [],
				snapshot: { status: "active", value: { work: { left: "later", right: "waiting" } } },
			},
			{ id: 'actor:["worker"]', path: ["worker"], snapshot: { status: "done", value: "done" } },
		],
	});
	expect(output.actors[ZERO]!.machine).toMatchObject({
		id: "root",
		type: "compound",
		initial: "initial",
		states: {
			work: {
				type: "parallel",
				states: {
					left: {
						initial: "first",
						states: {
							later: {
								on: {
									NEXT: [
										{ guard: "permitted", target: ["#root.done"] },
										{ guard: "inline guard", target: ["#root.initial"] },
										{ target: ["#root.done"] },
									],
								},
							},
							history: { type: "history", history: "deep", target: "later" },
						},
					},
					right: {
						states: {
							waiting: {
								always: [{ guard: "inline guard", target: ["#root.done"] }],
								on: { "xstate.after.500.root.work.right.waiting": [{ target: ["#root.done"] }] },
							},
						},
					},
				},
			},
			done: { type: "final" },
		},
	});
	const serialized = JSON.stringify(document);
	for (const secret of [
		"private-value",
		"private-params",
		"private-meta",
		"private-body",
		"private-description",
		"private-output",
		"/preview/workflow.ts",
	]) {
		expect(serialized).not.toContain(secret);
	}
	expect(fixture.effects).toEqual([]);
	expect(await fixture.records()).toEqual(before);
});

test("named compatible source reports provenance and leaves the saved checkpoint untouched", async () => {
	await fixture.save({ definition: { kind: "named", name: "example", version: "1.0.0" } });
	const before = await fixture.records();
	const output = await preview(fixture.id, options, fixture.services);
	expect(output.definition).toMatchObject({
		label: "example",
		sourceMatch: "compatible",
		savedHash: originalHash,
	});
	expect(output.definition.currentHash).not.toBe(originalHash);
	expect(await fixture.records()).toEqual(before);
});

test.each([
	{ title: "changed explicit file", kind: "source", version: "", reason: "definition_changed" },
	{
		title: "incompatible named version",
		kind: "named",
		version: "2.0.0",
		reason: "definition_changed",
	},
])("preview rejects $title before importing", async ({ kind, version, reason }) => {
	if (kind === "source") {
		fixture.services.readBytes = () => Promise.resolve(new TextEncoder().encode("changed").buffer);
	} else {
		await fixture.save({ definition: { kind: "named", name: "example", version } });
	}
	const failure: unknown = await preview(fixture.id, options, fixture.services).catch(
		(error: unknown) => error,
	);
	expect(failure).toBeInstanceOf(BusyBeeError);
	expect(failure).toMatchObject({ reason });
	expect(fixture.imports).toEqual([]);
});

test.each([
	{
		title: "removed root state",
		value: "removed",
		child: "worker",
		src: "worker",
		status: "done",
		childValue: "done",
	},
	{
		title: "missing saved child logic",
		value: { work: { left: "later", right: "waiting" } },
		child: "removed",
		src: "removed",
		status: "done",
		childValue: "done",
	},
	{
		title: "removed child state",
		value: { work: { left: "later", right: "waiting" } },
		child: "worker",
		src: "worker",
		status: "active",
		childValue: "removed",
	},
	{
		title: "incomplete parallel state",
		value: { work: { left: "later" } },
		child: "worker",
		src: "worker",
		status: "done",
		childValue: "done",
	},
	{
		title: "unsupported promise actor",
		value: { work: { left: "later", right: "waiting" } },
		child: "promise",
		src: "promise",
		status: "active",
		childValue: "waiting",
	},
])("preview fails clearly for $title", async ({ value, child, src, status, childValue }) => {
	await fixture.save({
		snapshot: {
			...fixture.saved.snapshot,
			status: "active",
			output: undefined,
			error: undefined,
			value,
			children: {
				[child]: {
					src,
					snapshot: { value: childValue, status, context: {}, historyValue: {}, children: {} },
				},
			},
		} as unknown as Run["snapshot"],
	});
	const result = await captureCli(["preview", fixture.id, "--json"], fixture.services);
	expect(result.code).toBe(FAILURE);
	expect(result.stderr).toBe("");
	expect(JSON.parse(result.stdout)).toMatchObject({
		kind: "workflow_preview",
		ok: false,
		reason: "preview_unavailable",
	});
	expect(fixture.effects).toEqual([]);
});

test.each(["active", "done", "error", "stopped"] as const)(
	"preview preserves saved %s status without disclosing actor errors",
	async (status) => {
		await fixture.save({
			snapshot: {
				...fixture.saved.snapshot,
				status,
				error: "private-value",
				output: "private-output",
			} as unknown as Run["snapshot"],
		});
		const output = await preview(fixture.id, options, fixture.services);
		expect(output.actors[ZERO]!.snapshot.status).toBe(status);
		expect(JSON.stringify(output)).not.toContain("private-value");
		expect(JSON.stringify(output)).not.toContain("private-output");
		expect(fixture.effects).toEqual([]);
	},
);

test("preview resolves inline invoked machine sources and preserves invocation completion edges", async () => {
	const child = createMachine({ id: "inline", initial: "first", states: { first: {}, later: {} } });
	const machine = createMachine({
		id: "inline-root",
		initial: "work",
		states: {
			work: { invoke: { id: "child", src: child, onDone: "done", onError: "failed" } },
			done: { type: "final" },
			failed: {},
		},
	});
	const definition = { ...makeDefinition(fixture.effects), machine };
	fixture.services.importModule = () => Promise.resolve(definition);
	await fixture.save({
		snapshot: {
			status: "active",
			output: undefined,
			error: undefined,
			value: "work",
			context: {},
			historyValue: {},
			children: {
				child: {
					src: "xstate.invoke.0.inline-root.work",
					snapshot: {
						status: "active",
						value: "later",
						context: {},
						historyValue: {},
						children: {},
					},
				},
			},
		} as Run["snapshot"],
	});
	const output = await preview(fixture.id, options, fixture.services);
	expect(output.actors).toMatchObject([
		{
			path: [],
			machine: {
				states: {
					work: {
						on: {
							"xstate.done.actor.child": [{ target: ["#inline-root.done"] }],
							"xstate.error.actor.child": [{ target: ["#inline-root.failed"] }],
						},
					},
				},
			},
		},
		{ path: ["child"], machine: { id: "inline" }, snapshot: { value: "later" } },
	]);
});

test("preview includes closed runs and rejects missing or malformed saved state", async () => {
	await fixture.beads.close(scope, fixture.id);
	const output = await preview(fixture.id, options, fixture.services);
	expect(output.runId).toBe(fixture.id);
	await fixture.beads.update(scope, [fixture.checkpointId], {
		force: true,
		description: "invalid JSON",
	});
	await expect(preview(fixture.id, options, fixture.services)).rejects.toBeInstanceOf(BusyBeeError);
	await fixture.beads.dep.remove(scope, fixture.id, fixture.checkpointId);
	await expect(preview(fixture.id, options, fixture.services)).rejects.toMatchObject({
		reason: "invalid_checkpoint",
	});
});

test("preview retains both eventless Land route alternatives", async () => {
	fixture.services.importModule = () =>
		Promise.resolve({ ...makeDefinition(fixture.effects), machine: landMachine });
	await fixture.save({
		snapshot: {
			status: "active",
			output: undefined,
			error: undefined,
			value: "triage",
			context: {},
			children: {},
			historyValue: {},
		} as Run["snapshot"],
	});
	const output = await preview(fixture.id, options, fixture.services);
	expect(output.actors[ZERO]!.machine).toMatchObject({
		states: {
			route: { always: [{ guard: "isPr", target: ["#land.pr"] }, { target: ["#land.finish"] }] },
		},
	});
});

// --- Fixture helpers ---

function makeDefinition(effects: string[]) {
	const effect = () => {
		effects.push("executed");
	};
	const guard = () => {
		effect();
		return false;
	};
	const worker = createMachine({
		id: "child",
		initial: "first",
		context: { secret: "private-value" },
		states: { first: { entry: effect }, done: { type: "final", output: "private-output" } },
	});
	return {
		inputSchema: emptySchema,
		commandSchemas: {},
		runBrief: () => {
			effect();
			return {};
		},
		machine: createMachine(
			{
				id: "root",
				initial: "initial",
				context: () => {
					effect();
					return {};
				},
				states: {
					initial: { entry: effect },
					work: {
						type: "parallel",
						entry: effect,
						meta: {
							title: "private-meta",
							task: () => {
								effect();
								return { instructions: "private-body" };
							},
						},
						description: "private-description",
						states: {
							left: {
								initial: "first",
								states: {
									first: {},
									later: {
										on: {
											NEXT: [
												{
													target: "#root.done",
													guard: { type: "permitted", params: { secret: "private-params" } },
													actions: effect,
												},
												{ target: "#root.initial", guard },
												{ target: "#root.done" },
											],
										},
									},
									history: { type: "history", history: "deep", target: "later" },
								},
							},
							right: {
								initial: "waiting",
								states: {
									waiting: {
										always: { target: "#root.done", guard },
										after: { 500: "#root.done" },
										invoke: { src: "worker", id: "worker" },
									},
								},
							},
						},
					},
					done: { type: "final" },
				},
			},
			{
				guards: { permitted: guard },
				actors: {
					worker,
					promise: fromPromise(() => {
						effect();
						return Promise.resolve("private-output");
					}),
				},
			},
		),
	};
}

// Seed engine-owned records through the existing memory Beads/service seam.
// eslint-disable-next-line max-statements
async function memoryTracker() {
	const beads = createMemoryBeads({ db });
	const parent = await beads.create(scope, { title: "Saved run title", owner: "ct" });
	const saved: Run = {
		formatVersion: FAILURE,
		id: parent.id,
		hash: originalHash,
		definition: { kind: "source", source: `${repo}/workflow.ts` },
		active: [],
		created: [],
		history: [],
		visits: {},
		snapshot: {
			status: "active",
			output: undefined,
			error: undefined,
			value: { work: { left: "later", right: "waiting" } },
			context: { secret: "private-value" },
			historyValue: {},
			children: {
				worker: {
					src: "worker",
					snapshot: {
						status: "done",
						value: "done",
						context: { secret: "private-value" },
						output: "private-output",
						children: {},
						historyValue: {},
					},
				},
			},
		} as Run["snapshot"],
	};
	const checkpoint = await beads.create(scope, {
		title: "Checkpoint",
		description: JSON.stringify(saved),
		labels: ["system", "busybee-checkpoint"],
	});
	await beads.dep.add(scope, parent.id, checkpoint.id, "related");
	const effects: string[] = [];
	const imports: string[] = [];
	const definition = makeDefinition(effects);
	const services: ReturnType<typeof createServices> = {
		...createServices(),
		actor: undefined,
		cwd: repo,
		beads,
		beforeWrite: () => {
			throw new Error("Preview must not write");
		},
		execute: () => Promise.resolve(repo),
		readDirectory: () => Promise.resolve([{ kind: "file", name: "workflow.ts" }]),
		readText: () => Promise.resolve('description="Example"\nrun="workflow.ts"\nversion="1.1.0"'),
		readBytes: () => Promise.resolve(bytes),
		isFile: () => Promise.resolve(true),
		importModule: (source) => {
			imports.push(source);
			return Promise.resolve(definition);
		},
	};
	return {
		id: parent.id,
		checkpointId: checkpoint.id,
		saved,
		services,
		beads,
		effects,
		imports,
		records: () => beads.showMany(scope, [parent.id, checkpoint.id]),
		save: (change: Partial<Run>) =>
			beads.update(scope, [checkpoint.id], {
				force: true,
				description: JSON.stringify({ ...saved, ...change }),
			}),
	};
}
