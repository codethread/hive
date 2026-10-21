import { assessResumeContext, verifyCommands } from "../../src/preflight.ts";
import { expect, test } from "bun:test";
import { z } from "zod";

const emptySchema = z.compile(z.object({}));
const nestedSchema = z.object({ revision: z.string() });
const schemas = {
	missing: undefined,
	unchanged: z.compile(z.object({ revision: z.string() })),
	default: z.compile(z.object({ revision: z.string().default("abc") })),
	transform: z.compile(
		z.object({ revision: z.string().transform((value) => value.toUpperCase()) }),
	),
	nonrecord: z.compile(z.object({ revision: z.string() }).transform(() => "abc")),
	mutating: z.compile(
		z.object({ nested: nestedSchema }).transform((value) => {
			value.nested.revision = "changed";
			return value;
		}),
	),
};

test.each([
	{ name: "missing schema", kind: "missing", status: "unchecked", retained: { revision: "abc" } },
	{ name: "unchanged field", kind: "unchanged", status: "passed", retained: { revision: "abc" } },
	{ name: "invalid field", kind: "unchanged", status: "failed", retained: { revision: 1 } },
	{ name: "defaulted field", kind: "default", status: "unchecked", retained: {} },
	{
		name: "transformed field",
		kind: "transform",
		status: "unchecked",
		retained: { revision: "abc" },
	},
	{
		name: "stripped field",
		kind: "unchanged",
		status: "passed",
		retained: { revision: "abc", other: "retained" },
	},
	{
		name: "nonrecord output",
		kind: "nonrecord",
		status: "unchecked",
		retained: { revision: "abc" },
	},
	{
		name: "mutating schema",
		kind: "mutating",
		status: "unchecked",
		retained: { nested: { revision: "abc" } },
	},
] as const)("resume context $name is $status #test-460", ({ kind, status, retained }) => {
	const before = structuredClone(retained);
	expect(assessResumeContext(retained, schemas[kind]).status).toBe(status);
	expect(retained).toEqual(before);
});

test.each([
	{
		name: "unchanged",
		saved: { next: "NEXT" },
		proposed: { next: "NEXT" },
		schemaChoices: ["next"],
	},
	{
		name: "additional choice",
		saved: { next: "NEXT" },
		proposed: { next: "NEXT", extra: "EXTRA" },
		schemaChoices: ["next", "extra"],
	},
	{ name: "no saved choices", saved: undefined, proposed: { next: "NEXT" }, schemaChoices: [] },
])("frozen commands allow $name", ({ saved, proposed, schemaChoices }) => {
	const commandSchemas = Object.fromEntries(schemaChoices.map((choice) => [choice, emptySchema]));
	expect(() => verifyCommands(saved, proposed, commandSchemas)).not.toThrow();
});

test.each([
	{ name: "changed event", proposed: { next: "CHANGED" }, schemaChoices: ["next"] },
	{ name: "absent commands", proposed: undefined, schemaChoices: ["next"] },
	{ name: "missing schema", proposed: { next: "NEXT" }, schemaChoices: [] },
])("frozen commands reject $name", ({ proposed, schemaChoices }) => {
	const commandSchemas = Object.fromEntries(schemaChoices.map((choice) => [choice, emptySchema]));
	expect(() => verifyCommands({ next: "NEXT" }, proposed, commandSchemas)).toThrow(Error);
});
