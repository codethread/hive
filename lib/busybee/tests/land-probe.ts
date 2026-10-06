/* eslint-disable import/no-nodejs-modules -- Native integration probe operates on disposable directories and processes. */
import { cp, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { expect } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";

const success = 0;
const taskSchema = z.object({ bead: z.string(), instructions: z.string(), title: z.string() });
const runSchema = z.object({
	active: z.array(taskSchema),
	id: z.string(),
	ok: z.literal(true),
	status: z.string(),
});
const root = await mkdtemp(join(tmpdir(), "busybee-land-"));
const feature = join(root, "feature");
const surviving = join(root, "surviving");
const trackerRoot = join(root, "tracker");
const db = join(trackerRoot, ".beads/beads.db");
const source = new URL("../../..", import.meta.url).pathname;
const runner = join(source, "lib/busybee/bin/busybee.ts");
const inputFile = join(root, "input.json");
const env = { ...process.env, BD_ACTOR: "land-probe", BEADS_DB: db };
const trace: unknown[] = [];

await Promise.all(
	[feature, surviving, trackerRoot].map(async (repo) => {
		await mkdir(repo);
		await command(["git", "init", "--quiet", repo], root);
	}),
);
await Promise.all(
	[feature, surviving].map(async (repo) => {
		await mkdir(join(repo, ".workflows"));
		await cp(join(source, ".workflows/land"), join(repo, ".workflows/land"), { recursive: true });
		await symlink(join(source, "node_modules"), join(repo, "node_modules"));
	}),
);
await command(["br", "init", "--prefix", "land", "--db", db, "--actor", "land-probe"], trackerRoot);
const input = {
	beadsDb: db,
	canonicalRoot: surviving,
	completedTasks: ["simulated-task-reference"],
	expectedCommits: ["simulated-commit-reference"],
	request: "SIMULATED TRANSPORT ONLY: no user authorization to land real work.",
};
await Bun.write(inputFile, JSON.stringify(input));
const listed = await invoke(["list"], feature);
expect(listed.code).toBe(success);
expect(listed.document).toMatchObject({ workflows: [{ name: "land", run: "./workflow.ts" }] });
const discoveredInput = await invoke(["input-schema", "land"], feature);
expect(discoveredInput.code).toBe(success);
const missingInput = await invoke(["run", "land", "--owner", "probe-human"], feature);
expect(missingInput.code).not.toBe(success);
const started = await invoke(
	["run", "land", "--owner", "probe-human", "--input-file", inputFile],
	feature,
);
let run = runSchema.parse(started.document);
const stages = [
	"Verify explicit landing authorization and prerequisites",
	"Tidy the completed work",
	"Prove the complete change",
	"Commit remaining changes",
	"Land through Honeycomb",
	"Verify canonical main and cleanup",
	"Publish completed task state",
	"Report landing and publish final bookkeeping",
];
let repo = feature;
// Each command consumes the previous native state; concurrent transitions would invalidate the probe.
/* eslint-disable no-await-in-loop -- Each stage consumes the previous native state; transitions cannot run concurrently. */
for (const stage of stages) {
	const [task] = run.active;
	expect(task).toBeDefined();
	if (!task) {
		throw new Error("Missing active land task");
	}
	expect(task.title).toBe(stage);
	expect(task.instructions).toContain(input.canonicalRoot);
	expect(task.instructions).toContain(input.beadsDb);
	expect(task.instructions).toContain("simulated-commit-reference");
	expect(task.instructions).toContain(input.request);
	expect(task.instructions).toContain("simulated-task-reference");
	const discovery = await invoke(["discover", run.id], repo);
	expect(discovery.code).toBe(success);
	expect(discovery.document).toMatchObject({
		active: [{ choices: [{ choice: "next", schema: { properties: {}, type: "object" } }] }],
	});
	const blocked = await invoke(["next", run.id, task.bead], repo);
	expect(blocked.code).not.toBe(success);
	const shown = await invoke(["show", run.id], repo);
	const unchanged = runSchema.parse(shown.document);
	expect(unchanged.active).toEqual(run.active);
	// The probe closes only disposable tasks, simulating worker evidence, never the real action.
	await command(
		[
			"br",
			"close",
			task.bead,
			"--db",
			db,
			"--actor",
			"land-probe",
			"--reason",
			"Completed: SIMULATED transport test only; no actual landing or publication.",
		],
		trackerRoot,
	);
	const invalidData = await invoke(["next", run.id, task.bead, "--data", "null"], repo);
	expect(invalidData.code).not.toBe(success);
	const invalidChoice = await invoke(["choice", run.id, task.bead, "skip"], repo);
	expect(invalidChoice.code).not.toBe(success);
	if (stage === "Land through Honeycomb") {
		await rm(feature, { recursive: true });
		repo = surviving;
	}
	const advanced = await invoke(["next", run.id, task.bead], repo);
	run = runSchema.parse(advanced.document);
}
/* eslint-enable no-await-in-loop */
/* eslint-enable no-await-in-loop */
expect(run.status).toBe("done");
expect(run.active).toEqual([]);
await Bun.write(join(root, "trace.json"), JSON.stringify(trace, undefined, "\t"));
console.log(
	`PASS: land transport navigation, native closure gates, invalid choices and surviving-checkout restoration. SIMULATED ONLY: no merge, push, Honeycomb finish or real task closure. Traces: ${root}`,
);

async function command(args: string[], cwd: string): Promise<string> {
	const result = Bun.spawn(args, { cwd, env, stderr: "pipe", stdout: "pipe" });
	const [stdout, stderr, code] = await Promise.all([
		new Response(result.stdout).text(),
		new Response(result.stderr).text(),
		result.exited,
	]);
	expect(code, stderr).toBe(success);
	return stdout;
}

async function invoke(args: string[], cwd: string): Promise<{ code: number; document: unknown }> {
	const result = Bun.spawn(["bun", runner, ...args, "--json"], {
		cwd,
		env,
		stderr: "pipe",
		stdout: "pipe",
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(result.stdout).text(),
		new Response(result.stderr).text(),
		result.exited,
	]);
	expect(stderr).toBe("");
	const document: unknown = JSON.parse(stdout);
	trace.push({ args, code, cwd, document });
	return { code, document };
}
