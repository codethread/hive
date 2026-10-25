import type {
	CollectionDependencies,
	EvidenceModule,
	ImportResolution,
	ModuleReference,
} from "../../eval/tautological-tests/collection.ts";
import {
	collectSupport,
	supportContext,
	supportManifest,
} from "../../eval/tautological-tests/collection.ts";
import { expect, test } from "bun:test";

const limits = { maxDepth: 2, maxFiles: 32, maxBytes: 100 };
const ZERO = 0;
const ONE = 1;
const TWO = 2;
const THREE = 3;
const LAST = -1;

function reference(specifier: string, kind: ModuleReference["kind"] = "import"): ModuleReference {
	return { specifier, kind, line: ONE };
}

function source(path: string, references: ModuleReference[] = [], bytes = ONE): EvidenceModule {
	return { path, references, bytes, text: path, hash: `${path}-hash` };
}

function memory(modules: EvidenceModule[], resolutions: Record<string, ImportResolution> = {}) {
	const files = new Map(modules.map((module) => [module.path, module]));
	const reads: string[] = [];
	const deps: CollectionDependencies = {
		resolveImport: (_importer, specifier) =>
			Promise.resolve(resolutions[specifier] ?? { kind: "local", path: specifier }),
		readModule: (path, remainingBytes) => {
			reads.push(path);
			const module = files.get(path)!;
			if (module.bytes > remainingBytes) {
				return Promise.resolve({ kind: "too_large", bytes: module.bytes });
			}
			return Promise.resolve({ kind: "module", module });
		},
	};
	return { deps, reads };
}

test("support preserves side effects, shared targets and cycles within its depth bound", async () => {
	const file = source("test", [reference("a", "side_effect"), reference("b"), reference("a")]);
	const capture = memory([
		source("a", [reference("c", "reexport")]),
		source("b", [reference("c")]),
		source("c", [reference("a"), reference("test"), reference("deeper")]),
	]);
	const support = await collectSupport(file, limits, capture.deps);
	expect(support.files.map(({ module, depth }) => [module.path, depth])).toEqual([
		["a", ONE],
		["b", ONE],
		["c", TWO],
	]);
	expect(capture.reads).toEqual(["a", "b", "c"]);
	expect(support.references.at(LAST)?.outcome).toMatchObject({
		kind: "omitted",
		reason: "depth_limit",
		path: "deeper",
	});
	expect(supportManifest(support).files[ZERO]?.incoming).toHaveLength(THREE);
	expect(supportContext(support)).toContain("c:1 import deeper: depth_limit");
});

test.each([
	{ bound: "file_budget", maxFiles: 1, maxBytes: 100, expectedReads: ["a"] },
	{ bound: "byte_budget", maxFiles: 32, maxBytes: 2, expectedReads: ["a", "large"] },
])("$bound stops whole-module collection without packing smaller later files", async (row) => {
	const file = source("test", [reference("a"), reference("large"), reference("small")]);
	const capture = memory([source("a"), source("large", [], THREE), source("small")]);
	const support = await collectSupport(
		file,
		{ ...limits, maxFiles: row.maxFiles, maxBytes: row.maxBytes },
		capture.deps,
	);
	expect(support.files.map(({ module }) => module.path)).toEqual(["a"]);
	expect(capture.reads).toEqual([...row.expectedReads]);
	expect(support.references.slice(ONE).map(({ outcome }) => outcome)).toMatchObject([
		{ kind: "omitted", reason: row.bound },
		{ kind: "omitted", reason: row.bound },
	]);
	expect(support.bytes).toBe(ONE);
});

test("syntactic exclusions and resolution failures retain distinct model-visible reasons", async () => {
	const file = source("test", [
		reference("type", "type_only"),
		reference("expression", "dynamic_import"),
		reference("require(name)", "commonjs"),
		reference("runtime"),
		reference("package"),
		reference("outside"),
		reference("asset"),
		reference("declaration"),
		reference("missing"),
	]);
	const capture = memory([], {
		runtime: { kind: "excluded", reason: "builtin", path: undefined, detail: "runtime" },
		package: { kind: "excluded", reason: "third_party", path: "/deps/a", detail: "package" },
		outside: { kind: "excluded", reason: "outside_root", path: "/outside", detail: "outside" },
		asset: { kind: "excluded", reason: "unsupported", path: "/asset.json", detail: "asset" },
		declaration: { kind: "excluded", reason: "declaration_only", path: "/a.d.ts", detail: "type" },
		missing: { kind: "unresolved", detail: "original resolver diagnostic" },
	});
	const support = await collectSupport(file, limits, capture.deps);
	expect(
		support.references.map(({ outcome }) => outcome.kind === "omitted" && outcome.reason),
	).toEqual([
		"type_only",
		"dynamic_import",
		"commonjs",
		"builtin",
		"third_party",
		"outside_root",
		"unsupported",
		"declaration_only",
		"unresolved",
	]);
	expect(capture.reads).toEqual([]);
	expect(supportContext(support)).toContain("original resolver diagnostic");
});

test("unexpected source failure aborts preparation instead of becoming an empty graph", async () => {
	const capture = memory([]);
	capture.deps.readModule = () => Promise.reject(new Error("read failed"));
	const file = source("test", [reference("a")]);
	await expect(collectSupport(file, limits, capture.deps)).rejects.toBeInstanceOf(Error);
});
