import type {
	CollectionDependencies,
	EvidenceModule,
	ImportResolution,
	ModuleRead,
	ModuleReference,
} from "./collection.ts";
import { Visitor, parseSync } from "oxc-parser";
// eslint-disable-next-line import/no-nodejs-modules -- Enforce the caller-selected automatic collection root.
import { extname, isAbsolute, relative, sep } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Canonical paths and bounded reads belong to this adapter.
import { open, realpath } from "node:fs/promises";
import { ResolverFactory } from "oxc-resolver";
import type { SourceFile } from "./extraction.ts";

const ZERO = 0;
const NEXT_BYTE = 1;
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);

const RESOLVER_OPTIONS = {
	tsconfig: "auto" as const,
	conditionNames: ["bun", "node", "import", "default"],
	extensions: [...SOURCE_EXTENSIONS],
	symlinks: true,
	builtinModules: true,
	nodePath: false,
};

export const RESOLUTION_PROFILE = {
	resolver: "oxc-resolver",
	version: "11.24.2",
	...RESOLVER_OPTIONS,
};

export interface LiveCollection {
	/** Canonical root bounding automatic source inclusion, not resolver metadata access. */
	root: string;
	/** Native resolution and bounded source reads. */
	deps: CollectionDependencies;
}

/** Compose the pinned resolver and filesystem boundary once per invocation. */
export async function createCollectionDependencies(
	root: string,
	supplied: SourceFile[] = [],
): Promise<LiveCollection> {
	const canonicalRoot = await realpath(root);
	const resolver = new ResolverFactory(RESOLVER_OPTIONS);
	const explicit = new Map(supplied.map((file) => [file.path, file]));
	const cache = new Map<string, EvidenceModule>();
	return {
		root: canonicalRoot,
		deps: {
			readModule: async (path, remainingBytes) => {
				const existing = cache.get(path);
				if (existing) {
					const bytes = Buffer.byteLength(existing.text, "utf8");
					if (bytes > remainingBytes) {
						return { kind: "too_large", bytes };
					}
					return { kind: "module", module: analyzeModule(existing) };
				}
				const result = await readModule(path, remainingBytes);
				if (result.kind === "module") {
					cache.set(path, result.module);
				}
				return result;
			},
			resolveImport: async (importer, specifier) => {
				if (specifier.startsWith("bun:") || specifier.startsWith("node:")) {
					return excluded("builtin", undefined, "Runtime builtin; no source collected.");
				}
				const result = await resolver.resolveFileAsync(importer, specifier);
				if (result.builtin) {
					return excluded("builtin", undefined, "Runtime builtin; no source collected.");
				}
				if (!result.path) {
					return { kind: "unresolved", detail: result.error ?? "Resolver returned no path." };
				}
				const path = await realpath(result.path);
				return suppliedResolution(eligiblePath(canonicalRoot, path), explicit);
			},
		},
	};
}

function suppliedResolution(
	resolution: ImportResolution,
	explicit: ReadonlyMap<string, SourceFile>,
): ImportResolution {
	if (resolution.kind === "local") {
		const file = explicit.get(resolution.path);
		if (file) {
			return { kind: "supplied", path: file.path, module: analyzeModule(file) };
		}
	}
	return resolution;
}

/** Analyze source text without evaluating imports, registrations or expressions. */
export function analyzeModule(file: SourceFile): EvidenceModule {
	// eslint-disable-next-line node/no-sync -- Native parsing performs CPU work on supplied source text.
	const parsed = parseSync(file.path, file.text);
	if (parsed.errors.length > ZERO) {
		throw new Error(`${file.path}: ${parsed.errors.map(({ message }) => message).join("; ")}`);
	}
	const references: (ModuleReference & { start: number })[] = [];
	const record = (start: number, specifier: string, kind: ModuleReference["kind"]) => {
		references.push({
			start,
			specifier,
			kind,
			line: file.text.slice(ZERO, start).split("\n").length,
		});
	};
	new Visitor({
		ImportDeclaration(node) {
			let kind: ModuleReference["kind"] = "import";
			if (node.specifiers.length === ZERO) {
				kind = "side_effect";
			}
			if (
				node.importKind === "type" ||
				(node.specifiers.length > ZERO &&
					node.specifiers.every(
						(specifier) => specifier.type === "ImportSpecifier" && specifier.importKind === "type",
					))
			) {
				kind = "type_only";
			}
			record(node.start, node.source.value, kind);
		},
		ExportNamedDeclaration(node) {
			if (node.source) {
				const typeOnly =
					node.exportKind === "type" ||
					(node.specifiers.length > ZERO &&
						node.specifiers.every((specifier) => specifier.exportKind === "type"));
				record(node.start, node.source.value, reexportKind(typeOnly));
			}
		},
		ExportAllDeclaration(node) {
			record(node.start, node.source.value, reexportKind(node.exportKind === "type"));
		},
		ImportExpression(node) {
			record(node.start, file.text.slice(node.source.start, node.source.end), "dynamic_import");
		},
		CallExpression(node) {
			if (node.callee.type === "Identifier" && node.callee.name === "require") {
				record(node.start, file.text.slice(node.start, node.end), "commonjs");
			}
		},
	}).visit(parsed.program);
	return {
		...file,
		hash: new Bun.CryptoHasher("sha256").update(file.text).digest("hex"),
		bytes: Buffer.byteLength(file.text, "utf8"),
		references: references
			.toSorted((left, right) => left.start - right.start)
			.map(({ kind, line, specifier }) => ({ kind, line, specifier })),
	};
}

// ---------------------------------------------------------------------------

function eligiblePath(root: string, path: string): ImportResolution {
	const fromRoot = relative(root, path);
	if (path.split(sep).includes("node_modules")) {
		return excluded(
			"third_party",
			path,
			"Third-party dependency source is outside automatic evidence.",
		);
	}
	if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
		return excluded("outside_root", path, "Resolved source is outside the collection root.");
	}
	if (/\.d\.[cm]?ts$/u.test(path)) {
		return excluded("declaration_only", path, "Declaration-only files are not traversed.");
	}
	if (!SOURCE_EXTENSIONS.has(extname(path))) {
		return excluded(
			"unsupported",
			path,
			"Only TypeScript and JavaScript source modules are collected.",
		);
	}
	return { kind: "local", path };
}

function excluded(
	reason: Extract<ImportResolution, { kind: "excluded" }>["reason"],
	path: string | undefined,
	detail: string,
): ImportResolution {
	return { kind: "excluded", reason, path, detail };
}

// eslint-disable-next-line max-statements -- Own one bounded file read and its handle lifetime.
async function readModule(path: string, remainingBytes: number): Promise<ModuleRead> {
	const handle = await open(path, "r");
	try {
		const metadata = await handle.stat();
		if (metadata.size > remainingBytes) {
			return { kind: "too_large", bytes: metadata.size };
		}
		const buffer = Buffer.alloc(remainingBytes + NEXT_BYTE);
		let length = ZERO;
		while (length < buffer.length) {
			// eslint-disable-next-line no-await-in-loop -- Bounded sequential reads handle short reads and file growth.
			const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
			if (bytesRead === ZERO) {
				break;
			}
			length += bytesRead;
		}
		if (length > remainingBytes) {
			return { kind: "too_large", bytes: length };
		}
		const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(ZERO, length));
		return { kind: "module", module: analyzeModule({ path, text }) };
	} finally {
		await handle.close();
	}
}

function reexportKind(typeOnly: boolean): ModuleReference["kind"] {
	if (typeOnly) {
		return "type_only";
	}
	return "reexport";
}
