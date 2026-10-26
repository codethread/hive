import type {
	BindingPattern,
	CallExpression,
	Expression,
	ParamPattern,
	Program,
	Statement,
	VisitorObject,
} from "oxc-parser";
import { Visitor, parseSync } from "oxc-parser";
import type { Scope } from "./scopes.ts";
import type { SupportSnapshot } from "./collection.ts";
import { supportContext } from "./collection.ts";

const ZERO = 0;
const LAST = -1;

const DECLARATIONS = new Set(["test", "it", "describe"]);
const BUILDERS = new Set(["each", "skipIf", "todoIf"]);
const MODIFIERS = new Set(["only", "skip", "todo", "concurrent", "serial", "failing"]);
const HOOKS = new Set(["beforeEach", "beforeAll", "afterEach", "afterAll"]);
const FULL_SCOPE = 3;

export interface SourceFile {
	/** Caller-supplied file reference. */
	path: string;
	/** Complete file text, never executed by extraction. */
	text: string;
}

export interface TestCandidate {
	/** UTF-16 offset identifying this declaration within this file revision. */
	start: number;
	/** Exclusive UTF-16 end offset. */
	end: number;
	/** One-based source line. */
	line: number;
	/** Literal title or unevaluated title expression. */
	title: string;
	/** Lexically enclosing describe titles, outermost first. */
	suites: string[];
	/** Exact call text, including inline parameter tables and modifiers. */
	code: string;
	/** Cumulative test-file context slices at all three scopes. */
	contexts: Record<Scope, ContextSelection>;
	/** False when a dynamic or indirect wrapper requires the complete file. */
	reducedScopeSupported: boolean;
}

export interface SourceRange {
	/** Inclusive UTF-16 offset. */
	start: number;
	/** Exclusive UTF-16 offset. */
	end: number;
}

export interface ContextSelection {
	/** Coalesced test-file context ranges; the selected declaration has its own range. */
	ranges: SourceRange[];
	/** Direct file-level and enclosing-suite callback statements not fully retained. */
	omitted: string[];
	/** Referenced source slices. */
	text: string;
}

export interface Evidence {
	/** Explicit source and automatically collected support modules, or explicit unavailability. */
	source: string;
	/** Selected syntactic declaration, not a runtime-expanded test row. */
	test: string;
	/** Scoped test-file context, collection provenance, omissions and explicit context files. */
	context: string;
	/** Caller-supplied independent requirement with provenance, or unknown. */
	contract: string;
}

export interface SupportingEvidence {
	/** Cumulative test-file context level; automatic and explicit support stay fixed. */
	scope: Scope;
	/** Explicit implementation files. */
	sources: SourceFile[];
	/** Explicit helper, snapshot or configuration files. */
	context: SourceFile[];
	/** Independent requirement file, if supplied. */
	contract: SourceFile | undefined;
	/** Fixed automatically collected support shared by every scope, when enabled. */
	automatic: SupportSnapshot | undefined;
}

interface Declaration {
	/** Recognized imported API. */
	api: string;
	/** Full declaration call. */
	node: CallExpression;
}

export function extractCandidates(file: SourceFile): TestCandidate[] {
	// eslint-disable-next-line node/no-sync -- Synchronous parsing is CPU work, not filesystem I/O.
	const parsed = parseSync(file.path, file.text);
	if (parsed.errors.length > ZERO) {
		throw new Error(`${file.path}: ${parsed.errors.map((error) => error.message).join("; ")}`);
	}
	const bindings = testBindings(parsed.program);
	const declarations: Declaration[] = [];
	new Visitor({
		...shadowingChecks(bindings),
		CallExpression(node) {
			const api = declarationApi(node.callee, bindings);
			if (api && node.arguments.length > ZERO) {
				declarations.push({ api, node });
			}
		},
	}).visit(parsed.program);
	const suites = declarations.filter(({ api }) => api === "describe");
	const direct = directCalls(parsed.program, suites);
	return declarations
		.filter(({ api }) => api === "test" || api === "it")
		.map(({ node }) => ({
			start: node.start,
			end: node.end,
			line: file.text.slice(ZERO, node.start).split("\n").length,
			title: title(node, file.text),
			suites: suites
				.filter(({ node: suite }) => suite.start < node.start && suite.end > node.end)
				.map(({ node: suite }) => title(suite, file.text)),
			code: file.text.slice(node.start, node.end),
			contexts: localContexts(file, node, { program: parsed.program, declarations, direct }),
			reducedScopeSupported:
				direct.has(node) &&
				suites
					.filter((suite) => contains(suite.node, node))
					.every((suite) => direct.has(suite.node)),
		}));
}

// eslint-disable-next-line max-statements -- Keep the four evidence fields and scope refusal together.
export function assembleEvidence(
	file: SourceFile,
	candidate: TestCandidate,
	support: SupportingEvidence,
): Evidence {
	const { sources, context, contract, scope, automatic } = support;
	if (scope !== FULL_SCOPE && !candidate.reducedScopeSupported) {
		throw new Error("Dynamic or indirect registration requires --scope=3 to retain its wrapper.");
	}
	let sourceText =
		"No supporting source collected or supplied; relevant implementation is unknown.";
	const allSources = [...sources, ...(automatic?.files.map(({ module }) => module) ?? [])];
	if (allSources.length > ZERO) {
		sourceText = [...new Map(allSources.map((source) => [source.path, source])).values()]
			.map((source) => referenced(source))
			.join("\n\n");
	}
	let contractText = "Unknown: no independently justified contract or provenance supplied.";
	if (contract) {
		contractText = referenced(contract);
	}
	const selected = [...candidate.suites, candidate.title].join(" > ");
	const localContext = candidate.contexts[scope];
	const extraContext = context.map((entry) => referenced(entry));
	let importsContext =
		"Automatic import collection is disabled. Imported bodies, external snapshots and runtime " +
		"configuration are unavailable unless explicitly supplied.";
	if (automatic) {
		importsContext = supportContext(automatic);
	}
	const omissionLabel =
		"Omissions at this scope (direct file-level and enclosing-suite callback statements " +
		"not fully retained; not an exhaustive dependency inventory): ";
	const omissions = localContext.omitted.join("; ") || "no test-file statements omitted";
	return {
		source: sourceText,
		test: `${file.path}:${candidate.line}\nSelected declaration: ${selected}\n${candidate.code}`,
		context: [
			"Static bun:test extraction; runtime registration, parameter rows, hook applicability " +
				"and shared-observation attribution are unverified.",
			"Surrounding tests are context, not selected cases; " +
				"omitted evidence is unknown, not absent.",
			importsContext,
			`${omissionLabel}${omissions}`,
			localContext.text,
			...extraContext,
		].join("\n\n"),
		contract: contractText,
	};
}

// ---------------------------------------------------------------------------

function suiteStatements(program: Program, suites: Declaration[]): Statement[] {
	const statements: Statement[] = [...program.body];
	for (const { node } of suites) {
		for (const argument of node.arguments) {
			if (
				(argument.type === "ArrowFunctionExpression" || argument.type === "FunctionExpression") &&
				argument.body?.type === "BlockStatement"
			) {
				statements.push(...argument.body.body);
			}
		}
	}
	return statements;
}

function directCalls(program: Program, suites: Declaration[]): Set<Expression> {
	return new Set(
		suiteStatements(program, suites).flatMap((statement) => {
			if (statement.type === "ExpressionStatement") {
				return [statement.expression];
			}
			return [];
		}),
	);
}

function localContexts(
	file: SourceFile,
	selected: CallExpression,
	data: { program: Program; declarations: Declaration[]; direct: Set<Expression> },
): TestCandidate["contexts"] {
	const { program, declarations, direct } = data;
	const suites = declarations.filter(
		({ api, node }) => api === "describe" && contains(node, selected),
	);
	const hooks = declarations.filter(
		({ api, node }) =>
			HOOKS.has(api) &&
			direct.has(node) &&
			declarations
				.filter((entry) => entry.api === "describe" && contains(entry.node, node))
				.every((entry) => suites.includes(entry)),
	);
	const imports = program.body.filter((node) => node.type === "ImportDeclaration");
	const prefixes = suites.map(({ node }) => {
		const callback = node.arguments.find(
			(argument) =>
				argument.type === "ArrowFunctionExpression" || argument.type === "FunctionExpression",
		);
		return { start: node.start, end: callback?.start ?? node.end };
	});
	const focused = [...imports, ...prefixes, ...hooks.map(({ node }) => node)];
	const moduleContext = program.body.filter(
		(node) =>
			node.type !== "ExpressionStatement" ||
			!declarations.some((entry) => entry.node === node.expression && !HOOKS.has(entry.api)),
	);
	const select = (spans: SourceRange[]) => {
		const ranges = coalesceRanges(spans);
		const omitted = suiteStatements(program, suites)
			.filter((statement) => {
				let node: SourceRange = statement;
				if (statement.type === "ExpressionStatement") {
					node = statement.expression;
				}
				return (
					node !== selected &&
					!ranges.some((range) => range.start <= node.start && range.end >= node.end)
				);
			})
			.map(
				(node) =>
					`${file.path}:${file.text.slice(ZERO, node.start).split("\n").length} (${omissionName(node, file.text)})`,
			);
		return {
			ranges,
			omitted,
			text: ranges
				.map(
					(range) =>
						`${file.path}:${file.text.slice(ZERO, range.start).split("\n").length}\n${file.text.slice(
							range.start,
							range.end,
						)}`,
				)
				.join("\n\n"),
		};
	};
	return {
		1: select(focused),
		2: select([
			...focused,
			...moduleContext,
			...suites.map(
				({ node }) =>
					program.body.find(
						(statement) =>
							statement.type === "ExpressionStatement" && statement.expression === node,
					) ?? node,
			),
		]),
		3: select([{ start: ZERO, end: file.text.length }]),
	};
}

function omissionName(statement: Statement, source: string): string {
	if (statement.type === "VariableDeclaration") {
		return `${statement.kind} ${statement.declarations.map(({ id }) => source.slice(id.start, id.end)).join(", ")}`;
	}
	if (statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") {
		return `${statement.type} ${statement.id?.name ?? "anonymous"}`;
	}
	if (statement.type === "ExpressionStatement" && statement.expression.type === "CallExpression") {
		const call = statement.expression;
		return `${source.slice(call.callee.start, call.callee.end)}: ${title(call, source)}`;
	}
	return statement.type;
}

function contains(outer: SourceRange, inner: SourceRange): boolean {
	return outer.start < inner.start && outer.end > inner.end;
}

function coalesceRanges(spans: SourceRange[]): SourceRange[] {
	const sorted = spans.toSorted((left, right) => left.start - right.start || right.end - left.end);
	const ranges: SourceRange[] = [];
	for (const { start, end } of sorted) {
		const previous = ranges.at(LAST);
		if (previous && start <= previous.end) {
			previous.end = Math.max(previous.end, end);
		} else {
			ranges.push({ start, end });
		}
	}
	return ranges;
}

function shadowingChecks(bindings: Map<string, string>): VisitorObject {
	const check = (pattern: BindingPattern | ParamPattern | null) => {
		if (pattern) {
			for (const name of boundNames(pattern)) {
				if (bindings.has(name)) {
					throw new Error(`Unsupported shadowed bun:test import: ${name}`);
				}
			}
		}
	};
	return {
		VariableDeclarator(node) {
			check(node.id);
		},
		FunctionDeclaration(node) {
			check(node.id);
			node.params.forEach((param) => check(param));
		},
		FunctionExpression(node) {
			check(node.id);
			node.params.forEach((param) => check(param));
		},
		ArrowFunctionExpression(node) {
			node.params.forEach((param) => check(param));
		},
		CatchClause(node) {
			check(node.param);
		},
		ClassDeclaration(node) {
			check(node.id);
		},
		ClassExpression(node) {
			check(node.id);
		},
		TSEnumDeclaration(node) {
			check(node.id);
		},
		TSModuleDeclaration(node) {
			if (node.id.type === "Identifier") {
				check(node.id);
			}
		},
	};
}

function boundNames(pattern: BindingPattern | ParamPattern): string[] {
	switch (pattern.type) {
		case "Identifier": {
			return [pattern.name];
		}
		case "AssignmentPattern": {
			return boundNames(pattern.left);
		}
		case "RestElement": {
			return boundNames(pattern.argument);
		}
		case "TSParameterProperty": {
			return boundNames(pattern.parameter);
		}
		case "ArrayPattern": {
			return pattern.elements.flatMap((element) => {
				if (element) {
					return boundNames(element);
				}
				return [];
			});
		}
		case "ObjectPattern": {
			return pattern.properties.flatMap((property) => {
				if (property.type === "RestElement") {
					return boundNames(property.argument);
				}
				return boundNames(property.value);
			});
		}
	}
}

// eslint-disable-next-line max-statements -- Read only the direct import declarations without a resolution layer.
function testBindings(program: Program): Map<string, string> {
	const bindings = new Map<string, string>();
	for (const statement of program.body) {
		if (
			statement.type !== "ImportDeclaration" ||
			statement.source.value !== "bun:test" ||
			statement.importKind === "type"
		) {
			// eslint-disable-next-line no-continue -- Only runtime bun:test imports participate.
			continue;
		}
		for (const specifier of statement.specifiers) {
			if (specifier.type === "ImportNamespaceSpecifier") {
				bindings.set(specifier.local.name, "*");
			}
			if (specifier.type !== "ImportSpecifier" || specifier.importKind === "type") {
				// eslint-disable-next-line no-continue -- Namespace imports were handled above.
				continue;
			}
			const name =
				// eslint-disable-next-line no-ternary -- Import-name variants each contain one string.
				specifier.imported.type === "Identifier"
					? specifier.imported.name
					: specifier.imported.value;
			if (DECLARATIONS.has(name) || HOOKS.has(name)) {
				bindings.set(specifier.local.name, name);
			}
		}
	}
	return bindings;
}

// eslint-disable-next-line max-statements -- Match the small supported declaration grammar in one place.
function declarationApi(expression: Expression, bindings: Map<string, string>): string | undefined {
	if (expression.type === "Identifier") {
		const api = bindings.get(expression.name);
		if (api !== "*") {
			return api;
		}
		return undefined;
	}
	if (
		expression.type === "MemberExpression" &&
		!expression.computed &&
		expression.property.type === "Identifier"
	) {
		const { name } = expression.property;
		if (expression.object.type === "Identifier" && bindings.get(expression.object.name) === "*") {
			if (DECLARATIONS.has(name) || HOOKS.has(name)) {
				return name;
			}
			return undefined;
		}
		if (MODIFIERS.has(name)) {
			return declarationApi(expression.object, bindings);
		}
	}
	if (expression.type === "CallExpression") {
		return builderApi(expression.callee, bindings);
	}
	if (expression.type === "TaggedTemplateExpression") {
		return builderApi(expression.tag, bindings);
	}
	return undefined;
}

function builderApi(callee: Expression, bindings: Map<string, string>): string | undefined {
	if (
		callee.type === "MemberExpression" &&
		!callee.computed &&
		callee.property.type === "Identifier" &&
		BUILDERS.has(callee.property.name)
	) {
		return declarationApi(callee.object, bindings);
	}
	return undefined;
}

function title(node: CallExpression, source: string): string {
	const [argument] = node.arguments;
	if (!argument) {
		return "";
	}
	if (argument.type === "Literal" && typeof argument.value === "string") {
		return argument.value;
	}
	return source.slice(argument.start, argument.end);
}

function referenced(file: SourceFile): string {
	return `${file.path}\n${file.text}`;
}
