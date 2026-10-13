// Integration fixtures own disposable native repositories and filesystem setup.
/* eslint-disable import/no-nodejs-modules */
import type { MutationEndpoint, Services } from "../../src/native.ts";
import { afterEach, beforeEach, expect } from "bun:test";
import { createMemoryBeads, createNativeBeads } from "@hive/beads";
import { createServices, readBead } from "../../src/native.ts";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { execute } from "@hive/shared";
import { join } from "node:path";
import { runCli } from "../../src/cli.ts";
import { runViewSchema } from "../../src/runtime.ts";
import { tmpdir } from "node:os";

const SUCCESS = 0;
const imports =
	"import {createMachine,setup,assign} from " +
	`${JSON.stringify(import.meta.resolve("xstate"))};import {z} from ` +
	`${JSON.stringify(import.meta.resolve("zod"))};`;

export interface RepositoryFixture {
	/** Disposable fixture root, including the execution repository. */
	root: string;
	/** Separate tracker authority and mutation identity. */
	options: MutationEndpoint & { owner: string };
	/** Real authoring I/O with memory tracking, or native tracking for discovery contracts. */
	services: Services;
	/** Environment passed only to owned subprocesses. */
	env: NodeJS.ProcessEnv;
}

export function useNativeFixture(prefix: string): RepositoryFixture {
	return useRepositoryFixture(prefix, true);
}

export function useRepositoryFixture(prefix: string, native = false): RepositoryFixture {
	const fixture: RepositoryFixture = {
		env: {},
		options: { actor: "test-agent", db: "", owner: "test-human", repo: "" },
		root: "",
		services: createServices(),
	};
	// Keep endpoint, environment and repository initialization in one setup hook.
	// eslint-disable-next-line max-statements
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
			beads: createMemoryBeads({ db: fixture.options.db }),
			cwd: repo,
			execute: (argv, cwd) => execute(argv, cwd, fixture.env),
		};
		await createRepository(fixture, repo);
		if (native) {
			fixture.services.beads = createNativeBeads({ env: fixture.env });
			await initializeNativeRepository(fixture);
		}
	});
	afterEach(async () => {
		await rm(fixture.root, { force: true, recursive: true });
	});
	return fixture;
}

export async function createRepository(fixture: RepositoryFixture, repo: string): Promise<void> {
	await mkdir(repo, { recursive: true });
	await fixture.services.execute(["git", "init", "--quiet", repo], fixture.root);
	await symlink(
		new URL("../../../../node_modules", import.meta.url).pathname,
		join(repo, "node_modules"),
	);
}

export async function writeDefinition(
	fixture: RepositoryFixture,
	name: string,
	body: string,
): Promise<string> {
	const source = join(fixture.root, name, "workflow.ts");
	await Bun.write(
		source,
		`${imports}export const inputSchema=z.object({});export function ` +
			'runBrief(){return {title:"Integration ' +
			`workflow",description:"Complete the fixture tasks"};}${body}`,
	);
	return source;
}

export function optionsArgs(fixture: RepositoryFixture): string[] {
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

export async function view(
	fixture: RepositoryFixture,
	command: string[],
	services = fixture.services,
) {
	const result = await invoke([...optionsArgs(fixture), ...command], services);
	expect(result.code, result.stdout).toBe(SUCCESS);
	return runViewSchema.parse(result.document);
}

export function record(fixture: RepositoryFixture, id: string) {
	return readBead(fixture.options, id, fixture.services);
}

export async function close(fixture: RepositoryFixture, id: string): Promise<void> {
	const { actor, db, repo } = fixture.options;
	await fixture.services.beads.close({ actor, cwd: repo, db }, id, {
		reason: "Completed: disposable integration fixture.",
	});
}

export async function checkpoint(fixture: RepositoryFixture, id: string) {
	const run = await record(fixture, id);
	return record(fixture, run.dependencies.find((edge) => edge.dependency_type === "related")!.id);
}

export async function issueIds(fixture: RepositoryFixture): Promise<string[]> {
	const { db, repo } = fixture.options;
	const result = await fixture.services.beads.list({ cwd: repo, db }, { all: true, limit: 0 });
	return result.issues.map((entry) => entry.id).toSorted();
}

export async function observations(fixture: RepositoryFixture, id: string) {
	const state = await checkpoint(fixture, id);
	return {
		checkpoint: state.id,
		description: state.description,
		issues: await issueIds(fixture),
		notes: state.notes,
	};
}

export async function assertUnchanged(
	fixture: RepositoryFixture,
	before: Awaited<ReturnType<typeof observations>>,
): Promise<void> {
	const state = await record(fixture, before.checkpoint);
	expect(state).toMatchObject({ description: before.description, notes: before.notes });
	expect(await issueIds(fixture)).toEqual(before.issues);
}

// --- Private helpers ---

async function initializeNativeRepository(fixture: RepositoryFixture): Promise<void> {
	const { repo, db, actor } = fixture.options;
	await fixture.services.execute(
		["br", "init", "--db", db, "--prefix", "test", "--actor", actor],
		repo,
	);
	const path = join(repo, ".beads/config.yaml");
	const original = await Bun.file(path).text();
	// These fixtures exercise live SQLite contracts, without a published JSONL endpoint.
	await Bun.write(path, `${original}\nsync.auto_flush: false\nsync.auto_import: false\n`);
}
