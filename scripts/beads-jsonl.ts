const LINE_NUMBER_OFFSET = 1;
const ORDER_AFTER = 1;
const ORDER_BEFORE = -1;
const ORDER_EQUAL = 0;

type JsonPrimitive = boolean | null | number | string;
type JsonValue = JsonObject | JsonPrimitive | readonly JsonValue[];

interface JsonObject {
	readonly [key: string]: JsonValue;
}

export interface IssueRecord {
	/** Key-order-independent representation used for comparisons. */
	readonly canonical: string;
	/** Canonical issue identifier used as the merge key. */
	readonly id: string;
	/** Original JSONL line, preserved when this record wins. */
	readonly raw: string;
}

export interface InvalidResult {
	/** Indicates invalid input that cannot be merged safely. */
	readonly kind: "invalid";
	/** Actionable boundary-validation failure. */
	readonly message: string;
}

export type ParsedJsonl =
	| {
			/** Indicates that every JSONL record passed boundary validation. */
			readonly kind: "parsed";
			/** Validated records keyed by their unique issue identifiers. */
			readonly records: ReadonlyMap<string, IssueRecord>;
	  }
	| InvalidResult;

type ParsedLine =
	| {
			/** Indicates that one JSONL line passed boundary validation. */
			readonly kind: "parsed";
			/** Validated issue record. */
			readonly record: IssueRecord;
	  }
	| InvalidResult;

export function compareText(left: string, right: string): number {
	if (left < right) {
		return ORDER_BEFORE;
	}
	if (left > right) {
		return ORDER_AFTER;
	}
	return ORDER_EQUAL;
}

export function errorDetail(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

export function parseJsonl(contents: string, source: string): ParsedJsonl {
	const records = new Map<string, IssueRecord>();
	for (const [index, line] of jsonlLines(contents).entries()) {
		const parsed = parseLine(line, source, index + LINE_NUMBER_OFFSET);
		if (parsed.kind === "invalid") {
			return parsed;
		}
		if (records.has(parsed.record.id)) {
			return {
				kind: "invalid",
				message: `${source}: duplicate issue id ${parsed.record.id}`,
			};
		}
		records.set(parsed.record.id, parsed.record);
	}
	return { kind: "parsed", records };
}

// -----------------------------------------------------------------------------

function canonicalize(value: JsonValue): string {
	if (Array.isArray(value)) {
		return `[${value.map((entry) => canonicalize(entry)).join(",")}]`;
	}
	if (value !== null && typeof value === "object") {
		const entries = Object.entries(value).toSorted(([left], [right]) => compareText(left, right));
		return `{${entries
			.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`)
			.join(",")}}`;
	}
	const serialized = JSON.stringify(value);
	if (serialized === undefined) {
		throw new Error("JSON primitive could not be serialized");
	}
	return serialized;
}

function isJsonObject(value: unknown): value is JsonObject {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function jsonlLines(contents: string): readonly string[] {
	if (contents === "") {
		return [];
	}
	const withoutFinalNewline = contents.replace(/\n$/u, "");
	return withoutFinalNewline.split("\n").map((line) => line.replace(/\r$/u, ""));
}

function parseLine(line: string, source: string, lineNumber: number): ParsedLine {
	if (line === "") {
		return { kind: "invalid", message: `${source}: line ${lineNumber} is empty` };
	}
	let value: unknown = line;
	try {
		value = JSON.parse(line) as unknown;
	} catch (error) {
		return {
			kind: "invalid",
			message: `${source}: line ${lineNumber} is invalid JSON: ${errorDetail(error)}`,
		};
	}
	if (!isJsonObject(value) || typeof value.id !== "string" || value.id === "") {
		return {
			kind: "invalid",
			message: `${source}: line ${lineNumber} must contain a non-empty string id`,
		};
	}
	return {
		kind: "parsed",
		record: { canonical: canonicalize(value), id: value.id, raw: line },
	};
}
