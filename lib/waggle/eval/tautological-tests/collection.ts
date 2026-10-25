import type { SourceFile, SourceRange } from "./extraction.ts";

const ZERO = 0;
const NEXT_DEPTH = 1;

export const COLLECTION_LIMITS: CollectionLimits = {
	maxDepth: 2,
	maxFiles: 32,
	maxBytes: 262_144,
};

export interface CollectionLimits {
	/** Maximum import distance from the selected test, whose depth is zero. */
	maxDepth: number;
	/** Maximum distinct automatically included support modules. */
	maxFiles: number;
	/** Maximum UTF-8 bytes of automatic support, excluding the test and explicit files. */
	maxBytes: number;
}

export interface ModuleReference {
	/** Static request, or original unevaluated expression for a dynamic reference. */
	specifier: string;
	/** Syntactic reference category; excluded categories remain visible. */
	kind: "import" | "side_effect" | "reexport" | "type_only" | "dynamic_import" | "commonjs";
	/** One-based source line of the reference. */
	line: number;
}

export interface EvidenceModule extends SourceFile {
	/** SHA-256 of the exact retained UTF-8 text. */
	hash: string;
	/** UTF-8 text size used for the automatic budget. */
	bytes: number;
	/** Source-ordered import and re-export references. */
	references: ModuleReference[];
}

export type ImportResolution =
	| { kind: "local"; path: string }
	| {
			kind: "excluded";
			reason: "builtin" | "third_party" | "outside_root" | "declaration_only" | "unsupported";
			path: string | undefined;
			detail: string;
	  }
	| { kind: "unresolved"; detail: string };

export type ModuleRead =
	| { kind: "module"; module: EvidenceModule }
	| { kind: "too_large"; bytes: number };

export interface CollectionDependencies {
	/** Resolve one request without executing the importer or target. */
	resolveImport: (importer: string, specifier: string) => Promise<ImportResolution>;
	/** Read and analyze one complete module, or report that it exceeds the remaining budget. */
	readModule: (path: string, remainingBytes: number) => Promise<ModuleRead>;
}

export interface CollectedModule {
	/** Complete immutable source evidence. */
	module: EvidenceModule;
	/** First breadth-first discovery distance from the test. */
	depth: number;
}

export type ReferenceOutcome =
	| { kind: "included"; path: string; depth: number }
	| {
			kind: "omitted";
			reason: string;
			path: string | undefined;
			detail: string;
	  };

export interface CollectedReference extends ModuleReference {
	/** Canonical source path containing this reference. */
	importer: string;
	/** Resolution or explicit omission of this particular edge. */
	outcome: ReferenceOutcome;
}

export interface SupportSnapshot {
	/** Whole modules in deterministic breadth-first inclusion order. */
	files: CollectedModule[];
	/** Every observed edge, including shared targets, cycles and omissions. */
	references: CollectedReference[];
	/** Automatic support bytes actually retained. */
	bytes: number;
	/** Bounds applied to this snapshot. */
	limits: CollectionLimits;
}

interface PendingReference {
	/** Reference being considered. */
	reference: ModuleReference;
	/** Canonical importing path. */
	importer: string;
	/** Proposed target depth. */
	depth: number;
}

/** Collect a bounded, fixed support graph before any classification. */
export async function collectSupport(
	test: EvidenceModule,
	limits: CollectionLimits,
	deps: CollectionDependencies,
): Promise<SupportSnapshot> {
	const snapshot: SupportSnapshot = { files: [], references: [], bytes: ZERO, limits };
	const included = new Map([[test.path, ZERO]]);
	const resolved = new Map<string, ImportResolution>();
	const queue = pending(test, NEXT_DEPTH);
	let stopped: "file_budget" | "byte_budget" | undefined = undefined;
	// eslint-disable-next-line max-statements -- One edge resolves to exactly one inclusion or omission.
	const collect = async (edge: PendingReference) => {
		const { reference, importer, depth } = edge;
		const record = (outcome: ReferenceOutcome) => {
			snapshot.references.push({ ...reference, importer, outcome });
		};
		if (!traversable(reference)) {
			record(omission(reference.kind, undefined, "Reference is not traversed by this collector."));
			return;
		}
		const key = JSON.stringify([importer, reference.specifier]);
		let resolution = resolved.get(key);
		if (!resolution) {
			resolution = await deps.resolveImport(importer, reference.specifier);
			resolved.set(key, resolution);
		}
		if (resolution.kind !== "local") {
			record(resolutionOmission(resolution));
			return;
		}
		const { path } = resolution;
		const previousDepth = included.get(path);
		if (previousDepth !== undefined) {
			record({ kind: "included", path, depth: previousDepth });
			return;
		}
		if (depth > limits.maxDepth) {
			record(omission("depth_limit", path, `Target exceeds import depth ${limits.maxDepth}.`));
			return;
		}
		if (!stopped && snapshot.files.length >= limits.maxFiles) {
			stopped = "file_budget";
		}
		if (stopped) {
			record(omission(stopped, path, "Automatic collection stopped at its budget."));
			return;
		}
		const read = await deps.readModule(path, limits.maxBytes - snapshot.bytes);
		if (read.kind === "too_large") {
			stopped = "byte_budget";
			record(
				omission(stopped, path, `Whole module (${read.bytes} bytes) exceeds remaining budget.`),
			);
			return;
		}
		included.set(path, depth);
		snapshot.files.push({ module: read.module, depth });
		snapshot.bytes += read.module.bytes;
		record({ kind: "included", path, depth });
		queue.push(...pending(read.module, depth + NEXT_DEPTH));
	};
	for (const edge of queue) {
		// eslint-disable-next-line no-await-in-loop -- Breadth-first source order controls whole-file budgets.
		await collect(edge);
	}
	return snapshot;
}

/** Compact provenance for output, without repeating module bodies. */
export function supportManifest(snapshot: SupportSnapshot) {
	return {
		limits: snapshot.limits,
		bytes: snapshot.bytes,
		files: snapshot.files.map(({ module, depth }) => ({
			path: module.path,
			hash: module.hash,
			bytes: module.bytes,
			depth,
			full_file: true,
			ranges: [{ start: ZERO, end: module.text.length } satisfies SourceRange],
			incoming: snapshot.references.filter(
				(reference) =>
					reference.outcome.kind === "included" && reference.outcome.path === module.path,
			),
		})),
		references: snapshot.references,
	};
}

/** Model-visible support and omission provenance, shared by every scope. */
export function supportContext(snapshot: SupportSnapshot): string {
	const entries = snapshot.references.map(({ importer, line, specifier, kind, outcome }) => {
		const reference = `${importer}:${line} ${kind} ${specifier}`;
		if (outcome.kind === "included") {
			return `${reference}: included ${outcome.path} (depth ${outcome.depth}).`;
		}
		return `${reference}: ${outcome.reason}; ${outcome.detail}`;
	});
	return [
		"Automatically collected whole modules are supporting evidence, not proof of production role, " +
			"hook applicability or independent requirements. Omitted evidence remains unknown.",
		`Automatic collection limits: depth ${snapshot.limits.maxDepth}, ` +
			`${snapshot.limits.maxFiles} files, ${snapshot.limits.maxBytes} UTF-8 bytes.`,
		...entries,
	].join("\n");
}

// ---------------------------------------------------------------------------

function pending(module: EvidenceModule, depth: number): PendingReference[] {
	return module.references.map((reference) => ({ reference, importer: module.path, depth }));
}

function traversable(reference: ModuleReference): boolean {
	return ["import", "side_effect", "reexport"].includes(reference.kind);
}

function omission(reason: string, path: string | undefined, detail: string): ReferenceOutcome {
	return { kind: "omitted", reason, path, detail };
}

function resolutionOmission(resolution: Exclude<ImportResolution, { kind: "local" }>) {
	if (resolution.kind === "unresolved") {
		return omission("unresolved", undefined, resolution.detail);
	}
	return omission(resolution.reason, resolution.path, resolution.detail);
}
