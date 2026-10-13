/* eslint-disable unicorn/no-null -- Engine checkpoints encode absent Bee requests as null. */
import type { BeadSelection, BeadsScope } from "@hive/beads";
import type { Definition, Metadata } from "../../src/definition.ts";
import { assessRun, preflight } from "../../src/preflight.ts";
import { createMachine, fromCallback } from "xstate";
import { expect, test } from "bun:test";
import type { Run } from "../../src/checkpoint.ts";
import type { Services } from "../../src/native.ts";
import { captureCli } from "./support.ts";
import { createMemoryBeads } from "@hive/beads";
import { createServices } from "../../src/native.ts";
import { z } from "zod";

const FIRST = 0;
const TARGET = 2;
const SUCCESS = 0;
const FAILURE = 1;
const ACTOR_TYPE = 1;
const repo = "/candidate";
const db = "/tracker/beads.db";
const source = `${repo}/.workflows/example/workflow.ts`;
const context = { revision: "abc" };
const emptySchema = z.compile(z.object({}));
const rootContextSchema = z.compile(z.object({ revision: z.string() }));
const actorRefSchema = z.object({ xstate$$type: z.literal(ACTOR_TYPE), id: z.literal("child") });
const persistedRootSchema = z.compile(
	rootContextSchema.extend({
		childRef: actorRefSchema,
	}),
);
const definition = makeDefinition();
const run = savedRun("run");

// Verify one complete CLI report and its no-effect boundary together.
test(
	"preflight CLI retains failed and unchecked runs, filters " +
		"completed/other runs, and never writes or starts #test-37",
	// eslint-disable-next-line max-statements
	async () => {
		let started = FIRST;
		let rendered = FIRST;
		const candidate = makeDefinition(
			() => {
				rendered += FAILURE;
			},
			() => {
				started += FAILURE;
			},
		);
		const invalid = savedRun("invalid");
		invalid.snapshot = { ...invalid.snapshot, context: { revision: FAILURE } };
		const other = savedRun("other");
		other.definition = { kind: "named", name: "another", version: "1.0.0" };
		const fixture = await memoryTracker(candidate, [invalid, run, savedRun("closed"), other]);
		await fixture.beads.close(fixture.scope, fixture.ids.get("closed")!);
		const before = await fixture.records();
		const result = await captureCli(
			["--repo", repo, "--db", db, "preflight", "example", "--json"],
			fixture.services,
		);
		expect(result.code).toBe(FAILURE);
		expect(result.stderr).toBe("");
		expect(JSON.parse(result.stdout)).toMatchObject({
			kind: "preflight",
			ok: false,
			reason: "preflight_incompatible",
			message: expect.any(String),
			repo,
			db,
			source,
			version: "1.1.0",
			status: "incompatible",
			runs: [
				{ id: fixture.ids.get("run"), status: "unchecked" },
				{ id: fixture.ids.get("invalid"), status: "incompatible" },
			],
		});
		expect(started).toBe(FIRST);
		expect(rendered).toBe(TARGET);
		expect(await fixture.records()).toEqual(before);
		expect(fixture.calls).toContainEqual({
			scope: { cwd: repo, db },
			selection: { labels: ["system", "busybee-checkpoint"], all: true, limit: FIRST },
		});
		expect(fixture.reads.toSorted()).toEqual(
			["closed", "invalid", "run"].map((name) => fixture.ids.get(name)!).toSorted(),
		);
	},
);

test(
	"successful CLI reports explicit uncertainty and resolves proposed " +
		"source from invoking directory #test-41",
	async () => {
		const fixture = await memoryTracker(definition, []);
		fixture.services.readDirectory = () => {
			throw new Error("Standalone proposal must not require catalogue");
		};
		const result = await captureCli(
			["preflight", "example", "--source", "proposed.ts", "--json"],
			fixture.services,
		);
		expect(result.code).toBe(SUCCESS);
		expect(JSON.parse(result.stdout)).toMatchObject({
			kind: "preflight",
			ok: true,
			version: null,
			source: `${repo}/proposed.ts`,
			status: "unchecked",
			runs: [],
		});
		expect(fixture.imports).toEqual([`${repo}/proposed.ts`]);
	},
);

test("missing resumeSchema leaves context unchecked despite successful restore and rendering", () => {
	const { resumeSchema: _schema, ...unchecked } = definition;
	const report = assessRun({
		run,
		checkpoint: "checkpoint",
		definition: unchecked,
		version: null,
	});
	expect(report.status).toBe("unchecked");
	expect(report.findings.find((finding) => finding.check === "version")).toMatchObject({
		status: "unchecked",
	});
	expect(report.findings).toContainEqual({
		check: "context:root",
		message: "No resumeSchema supplied; restored context is unchecked.",
		status: "unchecked",
	});
	expect(report.findings.filter((finding) => finding.status === "failed")).toEqual([]);
});

test("snapshot restoration reports removed states #test-40", () => {
	const invalid = savedRun("invalid");
	invalid.snapshot = { ...invalid.snapshot, value: "removed" };
	const report = assessRun({
		run: invalid,
		checkpoint: "checkpoint",
		definition,
		version: "1.1.0",
	});
	expect(report.status).toBe("incompatible");
	expect(report.findings.slice(FIRST, TARGET)).toMatchObject([
		{ check: "version", status: "passed" },
		{ check: "snapshot_restore", status: "failed" },
	]);
});

test("missing child actor logic is structural incompatibility even when XState drops it silently #test-36", () => {
	const invalid = savedRun("invalid");
	invalid.snapshot = {
		...invalid.snapshot,
		children: { missing: { src: "removed", snapshot: run.snapshot } },
	};
	const report = assessRun({
		run: invalid,
		checkpoint: "checkpoint",
		definition,
		version: "1.1.0",
	});
	expect(report.findings).toContainEqual({
		check: "snapshot_restore",
		message: "Saved child actor missing has no proposed actor logic",
		status: "failed",
	});
});

test("independent root context, active path, and frozen command failures retain all findings #test-34", () => {
	const invalid = savedRun("invalid");
	invalid.snapshot = { ...invalid.snapshot, context: { revision: FAILURE } };
	invalid.active.push({
		...invalid.active[FIRST]!,
		bead: "bad-path",
		key: "missing:example.work",
		path: ["missing"],
	});
	invalid.active[FIRST]!.meta.commands = { next: "OLD_EVENT" };
	const report = assessRun({
		run: invalid,
		checkpoint: "checkpoint",
		definition,
		version: "2.0.0",
	});
	expect(
		report.findings
			.filter((finding) => finding.status === "failed")
			.map((finding) => finding.check),
	).toEqual([
		"version",
		"context:root",
		"event_contract:invalid-task",
		"command_contract:invalid-task",
		"active_state:bad-path",
	]);
});

test("task renderer exceptions remain findings alongside other incompatibilities #test-42", () => {
	const candidate = makeDefinition(() => {
		throw new Error("Missing render input");
	});
	const report = assessRun({
		run,
		checkpoint: "checkpoint",
		definition: candidate,
		version: "2.0.0",
	});
	expect(report.findings).toContainEqual({
		check: "task_render::example.work",
		message: "Missing render input",
		status: "failed",
	});
	expect(report.findings).toContainEqual({
		check: "command_contract:run-task",
		message: "No proposed task could be rendered; frozen command mapping is unchecked.",
		status: "unchecked",
	});
});

test("native tracker failures keep their diagnostic instead of becoming a missing workflow", async () => {
	const fixture = await memoryTracker(definition, []);
	const nativeFailure = new Error("Tracker unavailable");
	fixture.services.beads.where = () => Promise.reject(nativeFailure);
	await expect(preflight("example", {}, fixture.services)).rejects.toBe(nativeFailure);
});

// Assess malformed matching, unrelated and completed checkpoint records in one query.
// eslint-disable-next-line max-statements
test(
	"unsupported matching checkpoints preserve other runs and exclude " +
		"malformed closed/other-name records #test-43",
	async () => {
		const other = savedRun("other");
		other.definition = { kind: "named", name: "another", version: "1.0.0" };
		const fixture = await memoryTracker(definition, [
			savedRun("legacy"),
			run,
			savedRun("closed"),
			other,
		]);
		await fixture.corruptFormat("legacy");
		await fixture.beads.close(fixture.scope, fixture.ids.get("closed")!);
		await fixture.corruptFormat("closed");
		await fixture.corruptFormat("other");
		const report = await preflight("example", {}, fixture.services);
		expect(report.runs).toMatchObject([
			{ id: fixture.ids.get("run"), status: "unchecked" },
			{ checkpoint: fixture.checkpoints.get("legacy"), status: "incompatible" },
		]);
	},
);

// Retain independent diagnostics and prove subsequent observations read fresh lock and relation state.
// eslint-disable-next-line max-statements
test("malformed identity, orphan checkpoint relations and retained locks stay visible #test-35", async () => {
	const fixture = await memoryTracker(definition, [savedRun("unknown"), run]);
	await fixture.beads.update(fixture.scope, [fixture.checkpoints.get("unknown")!], {
		description: "invalid JSON",
		force: true,
	});
	await fixture.beads.update(fixture.scope, [fixture.checkpoints.get("run")!], {
		notes: '{"owner":"uncertain-writer","pid":123}',
	});
	await fixture.beads.dep.remove(
		fixture.scope,
		fixture.ids.get("run")!,
		fixture.checkpoints.get("run")!,
		"related",
	);
	const report = await preflight("example", {}, fixture.services);
	expect(report.discovery).toMatchObject([{ checkpoint: fixture.checkpoints.get("unknown") }]);
	expect(report.status).toBe("incompatible");
	expect(report.runs).toHaveLength(FAILURE);
	expect(
		report.runs[FIRST]!.findings.find((finding) => finding.check === "checkpoint_relation"),
	).toMatchObject({ status: "failed" });
	expect(
		report.runs[FIRST]!.findings.find((finding) => finding.check === "checkpoint_lock"),
	).toMatchObject({ status: "unchecked" });
	await fixture.beads.update(fixture.scope, [fixture.checkpoints.get("run")!], {
		notes: "",
		force: true,
	});
	await fixture.beads.dep.add(
		fixture.scope,
		fixture.ids.get("run")!,
		fixture.checkpoints.get("run")!,
		"related",
	);
	const refreshed = await preflight("example", {}, fixture.services);
	expect(refreshed.runs[FIRST]!.findings).not.toContainEqual(
		expect.objectContaining({ check: "checkpoint_lock" }),
	);
	expect(
		refreshed.runs[FIRST]!.findings.find((finding) => finding.check === "checkpoint_relation"),
	).toMatchObject({ status: "passed" });
});

test("frozen effective choices use the saved visit context and allow additional candidate choices #test-32", () => {
	const candidate = makeDefinition(
		() => {},
		() => {},
		({ context: visitContext }) => {
			const { revision } = visitContext;
			visitContext["revision"] = "renderer mutation";
			if (revision === "abc") {
				return { instructions: "Work", commands: { next: "NEXT", extra: "NEXT" } };
			}
			return { instructions: "Work", commands: { next: "CHANGED" } };
		},
	);
	candidate.commandSchemas["extra"] = emptySchema;
	const saved = savedRun("run");
	saved.snapshot = { ...saved.snapshot, context: { revision: "current" } };
	const before = JSON.stringify(saved);
	const report = assessRun({
		run: saved,
		checkpoint: "checkpoint",
		definition: candidate,
		version: "1.1.0",
	});
	expect(report.findings.filter((finding) => finding.status === "failed")).toEqual([]);
	expect(
		report.findings.find((finding) => finding.check === "command_contract:run-task"),
	).toMatchObject({ status: "passed" });
	expect(JSON.stringify(saved)).toBe(before);
});

test("frozen events require a transition on the active node or its ancestors #test-33", () => {
	const candidate = {
		...definition,
		machine: createMachine({
			id: "example",
			initial: "work",
			states: {
				work: {
					meta: {
						title: "Worker",
						commands: { next: "NEXT" },
						task: () => ({ instructions: "Work" }),
					},
				},
			},
		}),
	};
	const report = assessRun({
		run,
		checkpoint: "checkpoint",
		definition: candidate,
		version: "1.1.0",
	});
	expect(
		report.findings.find((finding) => finding.check === "event_contract:run-task"),
	).toMatchObject({ status: "failed" });
});

test.each([
	{ value: "work", status: "passed", testId: "#test-39" },
	{ value: "removed", status: "failed", testId: "#test-38" },
])(
	"restored child state $value is checked while resumeSchema receives raw root data only $testId",
	({ value, status }) => {
		const child = createMachine({
			id: "child",
			initial: "work",
			states: { work: { meta: { title: "Child", task: () => ({ instructions: "Child work" }) } } },
		});
		const machine = createMachine(
			{
				id: "example",
				initial: "work",
				states: {
					work: {
						invoke: { src: "child", id: "child" },
						meta: {
							title: "Worker",
							commands: { next: "NEXT" },
							task: () => ({ instructions: "Work" }),
						},
						on: { NEXT: "done" },
					},
					done: { type: "final" },
				},
			},
			{ actors: { child } },
		);
		const saved = savedRun("run");
		saved.snapshot = {
			...saved.snapshot,
			context: { ...context, childRef: { xstate$$type: ACTOR_TYPE, id: "child" } },
			children: {
				child: {
					src: "child",
					snapshot: {
						status: "active",
						value,
						context: { group: "example.work", count: FAILURE },
						historyValue: {},
						children: {},
					},
				},
			},
		};
		const report = assessRun({
			run: saved,
			checkpoint: "checkpoint",
			definition: { ...definition, machine, resumeSchema: persistedRootSchema },
			version: "1.1.0",
		});
		expect(report.findings.find((finding) => finding.check === "context:root")).toMatchObject({
			status: "passed",
		});
		expect(report.findings.find((finding) => finding.check === "snapshot_restore")).toMatchObject({
			status,
		});
		expect(report.findings.find((finding) => finding.check === "child_contexts")).toMatchObject({
			status: "unchecked",
		});
	},
);

function makeDefinition(
	render: () => void = () => {},
	effect: () => void = () => {},
	task: Metadata["task"] = () => ({ instructions: "Work" }),
): Definition {
	return {
		commandSchemas: { next: emptySchema },
		inputSchema: emptySchema,
		resumeSchema: rootContextSchema,
		runBrief: () => ({ title: "Example", description: "Example run" }),
		machine: createMachine({
			id: "example",
			initial: "work",
			context,
			states: {
				work: {
					entry: effect,
					invoke: { src: fromCallback(effect) },
					meta: {
						title: "Worker",
						commands: { next: "NEXT" },
						task: (input: Parameters<Metadata["task"]>[typeof FIRST]) => {
							render();
							return task(input);
						},
					},
					on: { NEXT: "done" },
				},
				done: { type: "final" },
			},
		}),
	};
}

function savedRun(id: string): Run & {
	snapshot: Run["snapshot"] & {
		context: Record<string, unknown>;
		value: string;
		children: Record<string, unknown>;
		historyValue: Record<string, unknown>;
	};
} {
	return {
		formatVersion: FAILURE,
		id,
		hash: "original-provenance",
		definition: { kind: "named", name: "example", version: "1.0.0" },
		snapshot: {
			status: "active",
			output: undefined,
			error: undefined,
			value: "work",
			historyValue: {},
			context,
			children: {},
		},
		active: [
			{
				bead: `${id}-task`,
				context,
				key: ":example.work",
				node: "example.work",
				path: [],
				meta: { title: "Worker", commands: { next: "NEXT" }, instructions: "Frozen original work" },
				request: null,
			},
		],
		created: [],
		history: [],
		visits: {},
	};
}

// Keep isolated memory seeding and read-only observations local to this report fixture.
// eslint-disable-next-line max-statements
async function memoryTracker(candidate: Definition, runs: Run[]) {
	const beads = createMemoryBeads({ db });
	const scope = { actor: "test-agent", cwd: repo, db };
	const ids = new Map<string, string>();
	const checkpoints = new Map<string, string>();
	for (const saved of runs) {
		// eslint-disable-next-line no-await-in-loop -- Seed each run and its related checkpoint together.
		const parent = await beads.create(scope, { title: saved.id, owner: "ct" });
		ids.set(saved.id, parent.id);
		// eslint-disable-next-line no-await-in-loop -- Seed each run and its related checkpoint together.
		const checkpoint = await beads.create(scope, {
			title: `${saved.id}-checkpoint`,
			description: JSON.stringify({ ...saved, id: parent.id }),
			labels: ["system", "busybee-checkpoint"],
			owner: "ct",
		});
		checkpoints.set(saved.id, checkpoint.id);
		// eslint-disable-next-line no-await-in-loop -- Seed each run and its related checkpoint together.
		await beads.dep.add(scope, parent.id, checkpoint.id, "related");
	}
	const calls: { scope: BeadsScope; selection: BeadSelection | undefined }[] = [];
	const reads: string[] = [];
	const imports: string[] = [];
	const services: Services = {
		...createServices(),
		actor: undefined,
		cwd: repo,
		beads: {
			...beads,
			show: (selected, id) => {
				reads.push(id);
				return beads.show(selected, id);
			},
			list: (selected, selection) => {
				calls.push({ scope: selected, selection });
				return beads.list(selected, selection);
			},
		},
		beforeWrite: () => {
			throw new Error("Preflight must never write");
		},
		execute: () => Promise.resolve(repo),
		readDirectory: () => Promise.resolve([{ kind: "file", name: "workflow.ts" }]),
		readText: () => Promise.resolve('description="Example"\nrun="./workflow.ts"\nversion="1.1.0"'),
		readBytes: () => Promise.resolve(new ArrayBuffer(FIRST)),
		isFile: () => Promise.resolve(true),
		importModule: (path) => {
			imports.push(path);
			return Promise.resolve(candidate);
		},
	};
	return {
		beads,
		scope,
		ids,
		checkpoints,
		calls,
		reads,
		imports,
		services,
		records: () => beads.showMany(scope, [...ids.values(), ...checkpoints.values()]),
		corruptFormat: async (name: string) => {
			const id = checkpoints.get(name)!;
			const record = await beads.show(scope, id);
			await beads.update(scope, [id], {
				description: JSON.stringify({ ...JSON.parse(record.description), formatVersion: FIRST }),
			});
		},
	};
}
