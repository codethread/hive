/* eslint-disable import/no-nodejs-modules -- Integration fixtures own disposable native repositories and filesystem setup. */
import type { MutationEndpoint, Services } from "../../src/native.ts";
import { afterEach, beforeEach, expect } from "bun:test";
import { createServices, readBead, tracker } from "../../src/native.ts";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { execute } from "@hive/shared";
import { join } from "node:path";
import { runCli } from "../../src/cli.ts";
import { runViewSchema } from "../../src/runtime.ts";
import { tmpdir } from "node:os";
import { z } from "zod";

const SUCCESS = 0;
const issue = z.object({ id: z.string() });
const issueList = z.object({ issues: z.array(issue) });
const imports = `import {createMachine,setup,assign} from ${JSON.stringify(import.meta.resolve("xstate"))};import {z} from ${JSON.stringify(import.meta.resolve("zod"))};`;

export interface NativeFixture {
	/** Disposable fixture root, including the execution repository. */
	root: string;
	/** Separate native tracker authority and mutation identity. */
	options: MutationEndpoint & { owner: string };
	/** Live native I/O with fixture-local environment and execution directory. */
	services: Services;
	/** Environment passed only to owned subprocesses. */
	env: NodeJS.ProcessEnv;
}

export function useNativeFixture(prefix: string): NativeFixture {
	const fixture: NativeFixture = {
		env: {},
		options: { actor: "test-agent", db: "", owner: "test-human", repo: "" },
		root: "",
		services: createServices(),
	};
	beforeEach(async () => {
		fixture.root = await mkdtemp(join(tmpdir(), prefix));
		const repo = join(fixture.root, "repo");
		fixture.options = { ...fixture.options, db: join(repo, ".beads/beads.db"), repo };
		fixture.env = { ...process.env };
		delete fixture.env.BEADS_DB;
		delete fixture.env.BD_ACTOR;
		delete fixture.env.GIT_INDEX_FILE;
		fixture.services = {
			...createServices(),
			actor: undefined,
			cwd: repo,
			execute: (argv, cwd) => execute(argv, cwd, fixture.env),
		};
		await initializeNativeRepository(fixture);
	});
	afterEach(async () => {
		await rm(fixture.root, { force: true, recursive: true });
	});
	return fixture;
}

export async function createRepository(fixture: NativeFixture, repo: string): Promise<void> {
	await mkdir(repo, { recursive: true });
	await fixture.services.execute(["git", "init", "--quiet", repo], fixture.root);
	await symlink(
		new URL("../../../../node_modules", import.meta.url).pathname,
		join(repo, "node_modules"),
	);
}

export async function writeDefinition(
	fixture: NativeFixture,
	name: string,
	body: string,
): Promise<string> {
	const source = join(fixture.root, name, "workflow.ts");
	await Bun.write(
		source,
		`${imports}export const inputSchema=z.object({});export function runBrief(){return {title:"Integration workflow",description:"Complete the fixture tasks"};}${body}`,
	);
	return source;
}

export function optionsArgs(fixture: NativeFixture): string[] {
	const { actor, db, owner, repo } = fixture.options;
	return ["--db", db, "--repo", repo, "--actor", actor, "--owner", owner];
}

export async function captureCli(argv: string[], services: Services) {
	const stdout: string[] = [];
	const stderr: string[] = [];
	const code = await runCli(argv, services, {
		stderr: (value) => {
			stderr.push(value);
		},
		stdout: (value) => {
			stdout.push(value);
		},
	});
	return { code, stderr: stderr.join(""), stdout: stdout.join("") };
}

export async function invoke(argv: string[], services: Services) {
	const result = await captureCli([...argv, "--json"], services);
	expect(result.stderr).toBe("");
	const document: unknown = JSON.parse(result.stdout);
	return { ...result, document };
}

export async function view(fixture: NativeFixture, command: string[], services = fixture.services) {
	const result = await invoke([...optionsArgs(fixture), ...command], services);
	expect(result.code, result.stdout).toBe(SUCCESS);
	return runViewSchema.parse(result.document);
}

export function record(fixture: NativeFixture, id: string) {
	return readBead(fixture.options, id, fixture.services);
}

export async function close(fixture: NativeFixture, id: string): Promise<void> {
	await tracker(
		fixture.options,
		[
			"close",
			id,
			"--actor",
			fixture.options.actor,
			"--reason",
			"Completed: disposable integration fixture.",
		],
		fixture.services,
	);
}

export async function checkpoint(fixture: NativeFixture, id: string) {
	const run = await record(fixture, id);
	return record(fixture, run.dependencies.find((edge) => edge.dependency_type === "related")!.id);
}

export async function issueIds(fixture: NativeFixture): Promise<string[]> {
	const result = issueList.parse(
		await tracker(fixture.options, ["list", "--all", "--limit", "0"], fixture.services),
	);
	return result.issues.map((entry) => entry.id).toSorted();
}

export async function observations(fixture: NativeFixture, id: string) {
	const state = await checkpoint(fixture, id);
	return {
		checkpoint: state.id,
		description: state.description,
		issues: await issueIds(fixture),
		notes: state.notes,
	};
}

export async function assertUnchanged(
	fixture: NativeFixture,
	before: Awaited<ReturnType<typeof observations>>,
): Promise<void> {
	const state = await record(fixture, before.checkpoint);
	expect(state).toMatchObject({ description: before.description, notes: before.notes });
	expect(await issueIds(fixture)).toEqual(before.issues);
}

// --- Private helpers ---

async function initializeNativeRepository(fixture: NativeFixture): Promise<void> {
	const { repo, db, actor } = fixture.options;
	await createRepository(fixture, repo);
	await fixture.services.execute(
		["br", "init", "--db", db, "--prefix", "test", "--actor", actor],
		repo,
	);
	const path = join(repo, ".beads/config.yaml");
	const original = await Bun.file(path).text();
	// These fixtures exercise live SQLite contracts, without a published JSONL endpoint.
	await Bun.write(path, `${original}\nsync.auto_flush: false\nsync.auto_import: false\n`);
}
