/** Explicit offline contract verification; not automatically selected by CI or a live classifier evaluation. */
import { COLLECTION_LIMITS, collectSupport } from "./collection.ts";
import { ProgressiveError, prepareProgressive, runProgressive } from "./progressive.ts";
import { analyzeModule, createCollectionDependencies } from "./collection-live.ts";
import { assembleEvidence, extractCandidates } from "./extraction.ts";
// eslint-disable-next-line import/no-nodejs-modules -- This explicitly invoked verifier owns temporary fixtures.
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import type { Evidence } from "./extraction.ts";
import type { PreparedProgressive } from "./progressive.ts";
import type { ReviewChoice } from "./scopes.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Native fidelity assertions run outside timed unit tests.
import { strict as assert } from "node:assert";
// eslint-disable-next-line import/no-nodejs-modules -- Address temporary fixture paths.
import { join } from "node:path";
import { parseClassifier } from "../../src/classifiers.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Create isolated native fixtures without changing the checkout.
import { tmpdir } from "node:os";

const ZERO = 0;
const FIRST_SCOPE = 1;
const SECOND_SCOPE = 2;
const FINAL_SCOPE = 3;
const THRESHOLD = 0.9;
const LOW = 0.5;
const SMALL_BUDGET = 2;

const classifier = parseClassifier(
	"tautological-tests",
	await Bun.file(
		new URL("../../../../classifiers/tautological-tests.toml", import.meta.url),
	).text(),
);

const started = performance.now();
const directory = await mkdtemp(join(tmpdir(), "waggle-extraction-"));
try {
	const root = await createFixture(directory);
	await verifyNative(root);
	await verifyExplicitBudget(root);
	await verifyProgression();
	process.stdout.write(
		`${JSON.stringify({
			ok: true,
			kind: "extraction_verification",
			checks: [
				"native_parser_and_resolver",
				"bounded_collection",
				"cumulative_evidence",
				"progressive_runner",
				"offline_cli",
			],
			elapsed_ms: performance.now() - started,
			provider_calls: ZERO,
		})}\n`,
	);
} finally {
	await rm(directory, { recursive: true, force: true });
}

// eslint-disable-next-line max-statements -- Keep the small native module graph inspectable in one fixture builder.
async function createFixture(parent: string): Promise<string> {
	const root = join(parent, "repo");
	await mkdir(join(root, "src"), { recursive: true });
	await mkdir(join(root, "packages/local"), { recursive: true });
	await mkdir(join(root, "node_modules/third-party"), { recursive: true });
	const files: Record<string, string> = {
		"tsconfig.json": JSON.stringify({
			compilerOptions: { paths: { "@app/*": ["./src/*"] } },
			include: ["**/*.ts"],
		}),
		"package.json": JSON.stringify({ type: "module" }),
		"case.test.ts": [
			"// 🐝 source offsets stay exact",
			'import { test, describe, beforeEach } from "bun:test";',
			'import { run } from "@app/source";',
			'import { helper } from "./barrel.ts";',
			'import "./effects.ts";',
			'import { local } from "local-workspace";',
			'import type { Type } from "./types.ts";',
			'import { vendor } from "third-party";',
			'import { outside } from "../outside.ts";',
			'import { missing } from "./missing.ts";',
			'import { Declaration } from "./defs.d.ts";',
			'import data from "./asset.json";',
			'describe("suite", () => {',
			"  const rows = [[1]];",
			"  function localHelper() { return helper(); }",
			"  beforeEach(() => helper());",
			'  test.each(rows)("selected %s", () => run(localHelper(), local));',
			'  test("sibling", () => run(2));',
			"});",
			'import("./lazy.ts"); require("./legacy.ts");',
		].join("\n"),
		"src/source.ts": "export function run(value: unknown) { return value; }",
		"barrel.ts": 'export { helper } from "./helper.ts";',
		"helper.ts":
			'export { deeper } from "./deeper.ts"; import { run } from "@app/source";' +
			" export function helper() { return run(1); }",
		"effects.ts": 'throw new Error("Source must never be executed");',
		"packages/local/package.json": JSON.stringify({
			name: "local-workspace",
			exports: "./index.ts",
			type: "module",
		}),
		"packages/local/index.ts": "export const local = 1;",
		"node_modules/third-party/package.json": JSON.stringify({ main: "index.ts" }),
		"node_modules/third-party/index.ts": "export const vendor = 1;",
		"types.ts": "export type Type = number;",
		"defs.d.ts": "export declare const Declaration: number;",
		"asset.json": "{}",
		"deeper.ts": "export const deeper = 1;",
		"bad.ts": "export const = ;",
	};
	await Promise.all(Object.entries(files).map(([path, text]) => writeFile(join(root, path), text)));
	await writeFile(join(parent, "outside.ts"), "export const outside = 1;");
	await symlink(join(root, "packages/local"), join(root, "node_modules/local-workspace"));
	return root;
}

// eslint-disable-next-line max-statements -- Exercise the consumed native boundaries in one explicit verification.
async function verifyNative(root: string): Promise<void> {
	const live = await createCollectionDependencies(root);
	const file = {
		path: join(live.root, "case.test.ts"),
		text: await Bun.file(join(root, "case.test.ts")).text(),
	};
	const module = analyzeModule(file);
	const candidates = extractCandidates(file);
	const selected = candidates[ZERO]!;
	assert.equal(selected.code, file.text.slice(selected.start, selected.end));
	assert.ok(selected.contexts[FIRST_SCOPE].omitted.some((entry) => entry.includes("localHelper")));
	assert.ok(selected.contexts[FIRST_SCOPE].omitted.some((entry) => entry.includes("rows")));
	assert.ok(selected.contexts[FIRST_SCOPE].omitted.some((entry) => entry.includes("sibling")));
	assert.ok(
		!selected.contexts[SECOND_SCOPE].omitted.some((entry) => entry.includes("localHelper")),
	);
	const support = await collectSupport(module, COLLECTION_LIMITS, live.deps);
	const paths = new Set(support.files.map(({ module: entry }) => entry.path));
	assert.ok(paths.has(join(live.root, "src/source.ts")));
	assert.ok(paths.has(join(live.root, "packages/local/index.ts")));
	assert.ok(paths.has(join(live.root, "effects.ts")));
	assert.ok(paths.has(join(live.root, "helper.ts")));
	assert.ok(!paths.has(join(live.root, "deeper.ts")));
	const reasons = new Set(
		support.references.flatMap(({ outcome }) => {
			if (outcome.kind === "omitted") {
				return [outcome.reason];
			}
			return [];
		}),
	);
	for (const reason of [
		"type_only",
		"builtin",
		"third_party",
		"outside_root",
		"unresolved",
		"declaration_only",
		"unsupported",
		"dynamic_import",
		"commonjs",
		"depth_limit",
	]) {
		assert.ok(reasons.has(reason), reason);
	}
	const oversized = await live.deps.readModule(join(live.root, "src/source.ts"), SMALL_BUDGET);
	assert.equal(oversized.kind, "too_large");
	await assert.rejects(
		live.deps.readModule(join(live.root, "bad.ts"), COLLECTION_LIMITS.maxBytes),
		Error,
	);
	const plan = prepareProgressive(
		classifier,
		(scope) =>
			assembleEvidence(file, selected, {
				scope,
				sources: [],
				context: [],
				contract: undefined,
				automatic: support,
			}),
		FIRST_SCOPE,
	);
	assert.equal(new Set(plan.map(({ request }) => request.state.source)).size, FIRST_SCOPE);
	assert.ok(plan.every(({ request }) => request.state.context!.includes("depth_limit")));
	await verifyOfflineCli(file.path, root, { offset: selected.start, extra: [] });
	const dynamic = {
		path: "dynamic.test.ts",
		text: 'import {test} from "bun:test"; for (const row of [1]) test("row", () => row);',
	};
	const wrapped = extractCandidates(dynamic)[ZERO]!;
	assert.equal(wrapped.reducedScopeSupported, false);
	assert.throws(() =>
		assembleEvidence(dynamic, wrapped, {
			scope: FIRST_SCOPE,
			sources: [],
			context: [],
			contract: undefined,
			automatic: support,
		}),
	);
	const fullOnly = prepareProgressive(
		classifier,
		(scope) =>
			assembleEvidence(dynamic, wrapped, {
				scope,
				sources: [],
				context: [],
				contract: undefined,
				automatic: support,
			}),
		FINAL_SCOPE,
	);
	assert.deepEqual(
		fullOnly.map(({ scope }) => scope),
		[FINAL_SCOPE],
	);
}

// eslint-disable-next-line max-statements -- Verify native explicit overlap, budgets and CLI assembly together.
async function verifyExplicitBudget(root: string): Promise<void> {
	const boundary = await createCollectionDependencies(root);
	const canonical = boundary.root;
	const supplied = {
		path: join(canonical, "explicit.ts"),
		text: `import "./src/source.ts";\n//${"x".repeat(COLLECTION_LIMITS.maxBytes)}`,
	};
	const file = {
		path: join(canonical, "explicit.test.ts"),
		text: [
			'import {test} from "bun:test"; import "./explicit.ts";',
			'import "./src/source.ts"; test("explicit", () => {});',
		].join(" "),
	};
	await writeFile(supplied.path, supplied.text);
	await writeFile(file.path, file.text);
	const live = await createCollectionDependencies(root, [file, supplied]);
	const support = await collectSupport(
		analyzeModule(file),
		{ ...COLLECTION_LIMITS, maxFiles: FIRST_SCOPE },
		live.deps,
	);
	assert.deepEqual(
		support.files.map(({ module }) => module.path),
		[join(canonical, "src/source.ts")],
	);
	assert.ok(support.bytes < COLLECTION_LIMITS.maxBytes);
	assert.equal(
		support.references.find(({ specifier }) => specifier === "./explicit.ts")?.outcome.kind,
		"supplied",
	);
	const candidate = extractCandidates(file)[ZERO]!;
	await Promise.all(
		(
			[
				{ field: "sources", flag: "--source" },
				{ field: "context", flag: "--context" },
			] as const
		).map(async ({ field, flag }) => {
			const evidence = assembleEvidence(file, candidate, {
				scope: FIRST_SCOPE,
				sources: [],
				context: [],
				[field]: [supplied],
				contract: undefined,
				automatic: support,
			});
			assert.equal(Object.values(evidence).join("\n").split(supplied.text).length, SMALL_BUDGET);
			assert.ok(evidence.source.includes("export function run"));
			await verifyOfflineCli(file.path, root, {
				offset: candidate.start,
				extra: [flag, supplied.path],
			});
		}),
	);
}

async function verifyOfflineCli(
	file: string,
	root: string,
	selection: { offset: number; extra: string[] },
): Promise<void> {
	const child = Bun.spawn(
		[
			"bun",
			new URL("extract.ts", import.meta.url).pathname,
			file,
			"--case",
			String(selection.offset),
			"--root",
			root,
			...selection.extra,
		],
		{
			env: { ...process.env, TYPESAFE_API_KEY: "offline-verifier-not-a-real-key" },
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	assert.equal(code, ZERO, stderr || stdout);
	assert.equal(stderr, "");
	const result = JSON.parse(stdout);
	assert.equal(result.kind, "test_evidence");
	assert.equal(result.metric, "probability");
	assert.deepEqual(Object.keys(result.input).toSorted(), ["context", "contract", "source", "test"]);
	assert.ok(result.automatic.files.length > ZERO);
	assert.equal(result.attempts, undefined);
}

// eslint-disable-next-line max-statements -- Verify sequential outcomes without provider calls.
async function verifyProgression(): Promise<void> {
	const input = (scope: number): Evidence => ({
		source: "source",
		test: "test",
		context: `context ${scope}`,
		contract: "unknown",
	});
	const plan = prepareProgressive(classifier, input, FIRST_SCOPE);
	await Promise.all(
		(["tautological", "behavioral", "mixed"] as const).map(async (choice) => {
			const result = await runProgressive(plan, { scope: FIRST_SCOPE, metric: "probability" }, () =>
				response(choice, THRESHOLD, LOW),
			);
			assert.equal(result.kind, "accepted");
			assert.equal(result.attempts.length, FIRST_SCOPE);
		}),
	);
	let calls = ZERO;
	const result = await runProgressive(plan, { scope: FIRST_SCOPE, metric: "probability" }, () => {
		calls += FIRST_SCOPE;
		if (calls === FIRST_SCOPE) {
			return response("needs_context", THRESHOLD, THRESHOLD);
		}
		if (calls === SECOND_SCOPE) {
			return response("behavioral", LOW, THRESHOLD);
		}
		return response("mixed", LOW, THRESHOLD);
	});
	assert.equal(result.kind, "unresolved");
	assert.equal(result.attempts.at(-FIRST_SCOPE)!.result.answers.review!.choice, "mixed");
	assert.equal(calls, FINAL_SCOPE);
	const confidence = await runProgressive(plan, { scope: SECOND_SCOPE, metric: "confidence" }, () =>
		response("mixed", LOW, THRESHOLD),
	);
	assert.equal(confidence.kind, "accepted");
	assert.deepEqual(
		confidence.attempts.map(({ scope }) => scope),
		[SECOND_SCOPE],
	);
	const identical = prepareProgressive(classifier, () => input(FIRST_SCOPE), FIRST_SCOPE);
	calls = ZERO;
	const reused = await runProgressive(
		identical,
		{ scope: FIRST_SCOPE, metric: "probability" },
		() => {
			calls += FIRST_SCOPE;
			return response("needs_context", THRESHOLD, THRESHOLD);
		},
	);
	assert.equal(calls, FIRST_SCOPE);
	assert.equal(reused.kind, "unresolved");
	assert.deepEqual(
		reused.attempts.map(({ disposition }) => disposition),
		["evaluated", "reused", "reused"],
	);
	await Promise.all([false, true].map((malformed) => verifyFailure(plan, malformed)));
}

async function verifyFailure(plan: PreparedProgressive, malformed: boolean): Promise<void> {
	let calls = ZERO;
	let failure: unknown = undefined;
	try {
		await runProgressive(plan, { scope: FIRST_SCOPE, metric: "probability" }, () => {
			calls += FIRST_SCOPE;
			if (calls === FIRST_SCOPE) {
				return response("behavioral", LOW, LOW);
			}
			if (malformed) {
				return Promise.resolve({ answers: {} });
			}
			return Promise.reject(new Error("provider unavailable"));
		});
	} catch (error) {
		failure = error;
	}
	assert.ok(failure instanceof ProgressiveError);
	assert.equal(failure.scope, SECOND_SCOPE);
	assert.equal(failure.attempts.length, FIRST_SCOPE);
	assert.equal(calls, SECOND_SCOPE);
}

function response(choice: ReviewChoice, probability: number, confidence: number): Promise<unknown> {
	return Promise.resolve({
		answers: {
			review: {
				type: "choice",
				choice,
				confidence,
				probabilities: {
					tautological: ZERO,
					behavioral: ZERO,
					mixed: ZERO,
					needs_context: ZERO,
					[choice]: probability,
				},
			},
		},
		model: "jev-offline-verifier",
		usage: { input_tokens: FIRST_SCOPE, output_tokens: FIRST_SCOPE },
	});
}
