/* eslint-disable import/no-nodejs-modules -- Exercise the CLI/runtime with a real disposable author module. */
import { createServices, nativeBeadSchema } from "../../src/native.ts";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import type { NativeBead } from "../../src/native.ts";
import { captureCli } from "./support.ts";
import { join } from "node:path";
import { runViewSchema } from "../../src/runtime.ts";
import { tmpdir } from "node:os";

const FIRST = 0;
const ONE = 1;
const SUCCESS = 0;
const COMMAND = 1;
const TARGET = 2;
const DEPENDENCY = 3;
const DEPENDENCY_TARGET = 4;
const PRIORITY = 2;
const imports = `import {createMachine} from ${JSON.stringify(import.meta.resolve("xstate"))};import {z} from ${JSON.stringify(import.meta.resolve("zod"))};`;

// eslint-disable-next-line max-statements -- Keep one successful start and its observable CLI/projection contract in one case.
test("start publishes an initial worker and one JSON success document through the CLI/runtime", async () => {
	const root = await mkdtemp(join(tmpdir(), "busybee-start-"));
	try {
		const source = join(root, "workflow.ts");
		await Bun.write(
			source,
			`${imports}export const inputSchema=z.object({});export const commandSchemas={next:z.object({})};export function runBrief(){return {title:"Example",description:"Example workflow"};}export const machine=createMachine({initial:"work",states:{work:{meta:{title:"Worker",task:()=>({instructions:"Complete work"}),commands:{next:"NEXT"}},on:{NEXT:"done"}},done:{type:"final"}}});`,
		);
		const db = join(root, ".beads/beads.db");
		const tracker = startTracker(db);
		const services = { ...createServices(), actor: undefined, cwd: root, execute: tracker.execute };
		const result = await captureCli(
			["--actor", "starting-agent", "--owner", "responsible-human", "start", source, "--json"],
			services,
		);
		expect(result.code).toBe(SUCCESS);
		expect(result.stderr).toBe("");
		const document: unknown = JSON.parse(result.stdout);
		expect(document).toMatchObject({ kind: "start", ok: true });
		const started = runViewSchema.parse(document);
		expect(started.status).toBe("active");
		expect(started.active).toHaveLength(ONE);
		expect(started.active).toMatchObject([
			{
				commands: ["next"],
				context: {},
				instructions: "Complete work",
				path: [],
				title: "Worker",
			},
		]);
		expect(tracker.records.get(started.id)).toMatchObject({
			assignee: "starting-agent",
			created_by: "starting-agent",
			owner: "responsible-human",
			status: "in_progress",
		});
		expect(tracker.records.get(started.active[FIRST]!.bead)).toMatchObject({
			assignee: "starting-agent",
			created_by: "starting-agent",
			dependencies: [{ dependency_type: "parent-child", id: started.id }],
			owner: "responsible-human",
			status: "in_progress",
		});
		for (const { argv, cwd } of tracker.calls) {
			expect(cwd).toBe(root);
			if (argv[COMMAND] !== "where") {
				expect(flag(argv, "--db")).toBe(db);
			}
			if (["create", "dep", "update"].includes(argv[COMMAND]!)) {
				expect(flag(argv, "--actor")).toBe("starting-agent");
			}
		}
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});

// Only the native operations needed by successful start are represented here.
// Live database selection/attribution is covered in native.test.ts; this is not a concurrency fake.
function startTracker(db: string) {
	const records = new Map<string, NativeBead>();
	const calls: { argv: string[]; cwd: string }[] = [];
	function execute(argv: string[], cwd: string): Promise<string> {
		calls.push({ argv, cwd });
		return Promise.resolve(JSON.stringify(operate(argv)));
	}
	// eslint-disable-next-line max-statements -- Keep the small successful-start native adapter local to its one consumer.
	function operate(argv: readonly string[]): unknown {
		switch (argv[COMMAND]) {
			case "where": {
				return { database_path: db };
			}
			case "create": {
				const id = `start-${records.size + ONE}`;
				records.set(id, createdRecord(argv, id));
				return { id };
			}
			case "show": {
				return [records.get(argv[TARGET]!)!];
			}
			case "dep": {
				const record = records.get(argv[DEPENDENCY]!)!;
				record.dependencies.push({
					dependency_type: flag(argv, "--type")!,
					id: argv[DEPENDENCY_TARGET]!,
				});
				return {};
			}
			case "update": {
				const record = records.get(argv[TARGET]!)!;
				for (const field of ["notes", "description"] as const) {
					const value = flag(argv, `--${field}`);
					if (value !== undefined) {
						record[field] = value;
					}
				}
				return record;
			}
			default: {
				throw new Error(`Unsupported start fixture command: ${argv.join(" ")}`);
			}
		}
	}
	return { calls, execute, records };
}

function createdRecord(argv: readonly string[], id: string): NativeBead {
	const dependencies = [];
	const parent = flag(argv, "--parent");
	if (parent) {
		dependencies.push({ dependency_type: "parent-child", id: parent });
	}
	const labels: string[] = [];
	for (const [index, value] of argv.entries()) {
		if (value === "--labels") {
			labels.push(argv[index + ONE]!);
		}
	}
	return nativeBeadSchema.parse({
		assignee: flag(argv, "--assignee"),
		created_at: "2026-01-01T00:00:00Z",
		created_by: flag(argv, "--actor"),
		dependencies,
		description: flag(argv, "--description"),
		id,
		labels,
		owner: flag(argv, "--owner"),
		priority: PRIORITY,
		status: flag(argv, "--status"),
		updated_at: "2026-01-01T00:00:00Z",
	});
}

function flag(argv: readonly string[], name: string): string | undefined {
	const index = argv.indexOf(name);
	if (index < FIRST) {
		return undefined;
	}
	return argv[index + ONE];
}
