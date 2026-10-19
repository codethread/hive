/* eslint-disable import/no-nodejs-modules -- These fixtures exchange only disposable native trackers. */
import { copyFile, mkdir, rm } from "node:fs/promises";
import { invoke, writeDefinition } from "./support.ts";
import type { BeadRecord } from "@hive/beads";
import type { Endpoint } from "../../src/native.ts";
import type { ExecutionClearanceSelection } from "@hive/shared";
import type { RepositoryFixture } from "./support.ts";
import { createNativeBeads } from "@hive/beads";
import { expect } from "bun:test";
import { join } from "node:path";
import { start } from "../../src/runtime.ts";
import { workflowLifecycleSchema } from "@hive/shared";

const SUCCESS = 0;
const MAX_INSPECTION_BYTES = 1500;

export async function scenario(fixture: RepositoryFixture, body: string) {
	const [source, destination] = await Promise.allSettled([
		sourceScenario(fixture, body),
		initializeDestination(fixture),
	]);
	if (source.status === "rejected") {
		throw source.reason;
	}
	if (destination.status === "rejected") {
		throw destination.reason;
	}
	return { ...source.value, destination: destination.value };
}

export async function removeSource(selected: Awaited<ReturnType<typeof scenario>>): Promise<void> {
	await rm(join(selected.fixture.root, "subject"), { recursive: true });
	expect(await Bun.file(selected.source).exists()).toBe(false);
}

export async function inspectNative(
	selected: Pick<Awaited<ReturnType<typeof scenario>>, "args" | "sourceFree">,
	id: string,
) {
	const result = await invoke([...selected.args, "inspect", id], selected.sourceFree);
	expect(result.code, result.stdout).toBe(SUCCESS);
	expect(Buffer.byteLength(result.stdout)).toBeLessThan(MAX_INSPECTION_BYTES);
	expect(result.stdout).not.toContain('"work"');
	expect(result.stdout).not.toContain('"diagram"');
	const inspected = workflowLifecycleSchema.parse(result.document);
	expect(inspected.publication).toMatchObject({ locked: false, settlement: "none" });
	return inspected;
}

/** A separate native database receives JSONL, never SQLite or an in-memory adapter. */
export async function importTracker(selected: Awaited<ReturnType<typeof scenario>>) {
	expect(selected.destination.scope.db).not.toBe(selected.scope.db);
	const imported = {
		...selected.destination,
		sourceFree: { ...selected.sourceFree, beads: createNativeBeads({ env: selected.fixture.env }) },
	};
	const records = await exchange(selected, imported);
	return { ...imported, records };
}

/** Compare every fixture record, including generated visits, groups, checkpoints and native provenance. */
export async function exchange(
	selected: Awaited<ReturnType<typeof scenario>>,
	imported: Pick<Awaited<ReturnType<typeof scenario>>, "scope" | "sourceFree" | "args">,
): Promise<BeadRecord[]> {
	await selected.services.beads.sync.flush(selected.scope);
	await copyFile(
		join(selected.scope.cwd, ".beads/issues.jsonl"),
		join(imported.scope.cwd, ".beads/issues.jsonl"),
	);
	const source = sourceRecords(selected);
	const [original, received] = await Promise.allSettled([
		source,
		imported.sourceFree.beads.sync.import(imported.scope).then(async () => {
			const { ids } = await source;
			return imported.sourceFree.beads.showMany(imported.scope, ids);
		}),
	]);
	if (original.status === "rejected") {
		throw original.reason;
	}
	if (received.status === "rejected") {
		throw received.reason;
	}
	expect(received.value).toEqual(original.value.records);
	return received.value;
}

// --- Private helpers ---

async function sourceScenario(fixture: RepositoryFixture, body: string) {
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
	const parent = await services.beads.create(scope, {
		title: "Lifecycle proof",
		owner: options.owner,
	});
	const source = await writeDefinition(fixture, "subject", body);
	const run = await start(source, { ...options, parent: parent.id }, services);
	return {
		fixture,
		scope,
		services,
		source,
		parent: parent.id,
		run,
		args: ["--repo", options.repo, "--db", options.db, "--actor", options.actor],
		sourceFree: {
			...services,
			importModule: () => Promise.reject(new Error("Source access denied")),
			readBytes: () => Promise.reject(new Error("Source access denied")),
		},
	};
}

async function initializeDestination(fixture: RepositoryFixture) {
	const remote = join(fixture.root, "imported");
	await mkdir(remote);
	const db = join(remote, ".beads/beads.db");
	const { actor } = fixture.options;
	await fixture.services.execute(
		["br", "init", "--db", db, "--prefix", "test", "--actor", actor],
		remote,
	);
	const path = join(remote, ".beads/config.yaml");
	const original = await Bun.file(path).text();
	await Bun.write(path, `${original}\nsync.auto_flush: false\nsync.auto_import: false\n`);
	return {
		scope: { actor, cwd: remote, db, noAutoImport: true, noAutoFlush: true },
		args: ["--repo", remote, "--db", db, "--actor", actor],
	};
}

async function sourceRecords(selected: Awaited<ReturnType<typeof scenario>>) {
	const page = await selected.services.beads.list(selected.scope, { all: true, limit: SUCCESS });
	const ids = page.issues.map(({ id }) => id).toSorted();
	return { ids, records: await selected.services.beads.showMany(selected.scope, ids) };
}
