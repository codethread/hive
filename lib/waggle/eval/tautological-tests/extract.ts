import { COLLECTION_LIMITS, collectSupport, supportManifest } from "./collection.ts";
import { Command, CommanderError, Option } from "commander";
import { ProgressiveError, prepareProgressive, runProgressive } from "./progressive.ts";
import {
	RESOLUTION_PROFILE,
	analyzeModule,
	createCollectionDependencies,
} from "./collection-live.ts";
import type { Scope, ScoreMetric } from "./scopes.ts";
import type { SourceFile, TestCandidate } from "./extraction.ts";
import { assembleEvidence, extractCandidates } from "./extraction.ts";
import { createLiveDependencies } from "../../src/live-deps.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Decode the checkout-relative classifier directory.
import { fileURLToPath } from "node:url";
// eslint-disable-next-line import/no-nodejs-modules -- Read a canonical snapshot at the process boundary.
import { realpath } from "node:fs/promises";

const SUCCESS = 0;
const FAILURE = 1;
const USAGE = 2;
const INDENT = 2;
const FIRST = 0;
const FINAL_SCOPE = 3;
const THRESHOLD = 0.9;

interface Options {
	/** Requested starting scope. */
	scope: string;
	/** Exact UTF-16 start offset from the current inventory. */
	case?: string;
	/** Explicit implementation evidence, additive to automatic support. */
	source: string[];
	/** Explicit helper, snapshot or configuration evidence. */
	context: string[];
	/** Independently justified requirement file. */
	contract?: string;
	/** Automatic source inclusion root. */
	root: string;
	/** Explicit provider opt-in; credentials alone never enable classification. */
	live: boolean;
	/** Stopping statistic, with a provisional probability default. */
	metric: ScoreMetric;
}

// eslint-disable-next-line max-statements -- Compose one frozen snapshot and keep all live I/O at this boundary.
async function main(): Promise<number> {
	let reason = "usage";
	let provenance: Record<string, unknown> = {};
	try {
		const { path, options } = parseOptions(process.argv);
		reason = "invalid_input";
		const readSource = createSourceReader();
		const file = await readSource(path);
		const candidates = extractCandidates(file);
		if (options.case === undefined) {
			print({
				ok: true,
				kind: "test_candidates",
				path: file.path,
				source_hash: hash(file.text),
				candidates: candidates.map((candidate) => summarize(candidate)),
				limitations:
					"Syntactic bun:test declarations; runtime rows and registration are not evaluated.",
			});
			return SUCCESS;
		}
		const candidate = candidates.find(({ start }) => String(start) === options.case);
		if (!candidate) {
			throw new Error(`No candidate at offset ${options.case}`);
		}
		const scope = Number(options.scope) as Scope;
		if (!candidate.reducedScopeSupported && scope !== FINAL_SCOPE) {
			throw new Error("Dynamic or indirect registration requires an explicit --scope=3.");
		}
		const [sources, context, contract] = await Promise.all([
			Promise.all(options.source.map(readSource)),
			Promise.all(options.context.map(readSource)),
			readContract(options.contract, readSource),
		]);
		const supplied = [file, ...sources, ...context];
		if (contract) {
			supplied.push(contract);
		}
		const collection = await createCollectionDependencies(options.root, supplied);
		const automatic = await collectSupport(analyzeModule(file), COLLECTION_LIMITS, collection.deps);
		const live = createLiveDependencies();
		const classifier = await live.load(
			fileURLToPath(new URL("../../../../classifiers/", import.meta.url)),
			"tautological-tests",
		);
		const prepared = prepareProgressive(
			classifier,
			(level) =>
				assembleEvidence(file, candidate, { sources, context, contract, scope: level, automatic }),
			scope,
		);
		provenance = {
			path: file.path,
			source_hash: hash(file.text),
			candidate: summarize(candidate),
			classifier: { id: classifier.id, version: classifier.definition.version },
			definition_hash: hash(JSON.stringify(classifier.definition)),
			metric: options.metric,
			threshold: THRESHOLD,
			root: collection.root,
			resolution_profile: RESOLUTION_PROFILE,
			automatic: supportManifest(automatic),
			explicit: {
				sources: sources.map((source) => fileIdentity(source)),
				context: context.map((source) => fileIdentity(source)),
				contract: contract && fileIdentity(contract),
			},
			planned_scopes: prepared.map((step) => ({
				scope: step.scope,
				request_hash: hash(JSON.stringify(step.request)),
				input_hash: hash(JSON.stringify(step.request.state)),
				input_bytes: Buffer.byteLength(JSON.stringify(step.request.state), "utf8"),
				manifest: {
					ranges: candidate.contexts[step.scope].ranges,
					omitted: candidate.contexts[step.scope].omitted,
				},
			})),
		};
		if (!options.live) {
			print({
				ok: true,
				kind: "test_evidence",
				...provenance,
				scope,
				input: prepared[FIRST]!.request.state,
			});
			return SUCCESS;
		}
		reason = "execution_failed";
		const result = await runProgressive(prepared, { scope, metric: options.metric }, live.classify);
		print({
			ok: true,
			kind: "progressive_classification",
			...provenance,
			created_at: new Date().toISOString(),
			outcome: result.kind,
			attempts: result.attempts,
		});
		return SUCCESS;
	} catch (error) {
		return reportError(error, reason, provenance);
	}
}

function parseOptions(argv: string[]) {
	const command = new Command()
		.name("extract.ts")
		.description(
			"Inventory bun:test cases or use --case to prepare evidence with bounded local imports. " +
				"Offline by default, even with credentials. --live sends the prepared evidence to Typesafe.",
		)
		.argument("<file>", "TypeScript or JavaScript test file")
		.option("--case <offset>", "Exact UTF-16 offset from the current inventory")
		.addOption(
			new Option(
				"--scope <level>",
				"Starting scope through 3: 1 case/hooks/imports, 2 suite/local support, 3 full file",
			)
				.choices(["1", "2", "3"])
				.default("1"),
		)
		.addOption(
			new Option(
				"--metric <score>",
				"Substantive-answer threshold >=0.90: chosen-label probability (provisional) or provider confidence",
			)
				.choices(["probability", "confidence"])
				.default("probability"),
		)
		.option(
			"--root <directory>",
			"Automatic support root; depth 2, 32 whole files, 256 KiB UTF-8 source",
			process.cwd(),
		)
		.option("--source <files...>", "Additional explicit implementation evidence", [])
		.option(
			"--context <files...>",
			"Additional explicit helper, snapshot or configuration evidence",
			[],
		)
		.option("--contract <file>", "Independent requirement evidence with provenance")
		.option(
			"--live",
			"Classify --case progressively; sends automatic and explicit evidence to Typesafe",
			false,
		)
		.exitOverride()
		.configureOutput({ writeErr() {} })
		.parse(argv);
	const options = command.opts<Options>();
	const [path] = command.args;
	if (!path || (options.live && options.case === undefined)) {
		throw new Error("A file is required; --live also requires an exact --case selection.");
	}
	return { path, options };
}

function summarize(candidate: TestCandidate) {
	const { start, end, line, title, suites, code, reducedScopeSupported } = candidate;
	return { start, end, line, title, suites, code, reducedScopeSupported };
}

function createSourceReader() {
	const cache = new Map<string, Promise<SourceFile>>();
	return async (path: string): Promise<SourceFile> => {
		const canonical = await realpath(path);
		let source = cache.get(canonical);
		if (!source) {
			source = readCanonicalSource(canonical);
			cache.set(canonical, source);
		}
		return source;
	};
}

async function readContract(
	path: string | undefined,
	readSource: (path: string) => Promise<SourceFile>,
): Promise<SourceFile | undefined> {
	if (path) {
		return await readSource(path);
	}
	return undefined;
}

async function readCanonicalSource(path: string): Promise<SourceFile> {
	return { path, text: await Bun.file(path).text() };
}

function fileIdentity(file: SourceFile) {
	return { path: file.path, hash: hash(file.text), bytes: Buffer.byteLength(file.text, "utf8") };
}

function reportError(error: unknown, reason: string, provenance: Record<string, unknown>): number {
	if (error instanceof CommanderError && error.exitCode === SUCCESS) {
		return SUCCESS;
	}
	let details: Record<string, unknown> = {};
	if (error instanceof ProgressiveError) {
		details = {
			scope: error.scope,
			request_hash: error.request_hash,
			attempts: error.attempts,
			cause: String(error.cause),
		};
	}
	print({ ok: false, kind: "error", reason, message: String(error), ...provenance, ...details });
	if (reason === "usage") {
		return USAGE;
	}
	return FAILURE;
}

function hash(text: string): string {
	return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

function print(value: unknown): void {
	process.stdout.write(`${JSON.stringify(value, undefined, INDENT)}\n`);
}

process.exitCode = await main();
