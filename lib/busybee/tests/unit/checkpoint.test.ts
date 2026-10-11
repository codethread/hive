import { expect, test } from "bun:test";
import type { BeadRecord } from "@hive/beads";
import { BusyBeeError } from "../../src/native.ts";
import type { Run } from "../../src/checkpoint.ts";
import { readCheckpoint } from "../../src/checkpoint.ts";

const run: Run = {
	formatVersion: 1,
	active: [],
	created: [],
	definition: { kind: "named", name: "example", version: "1.2.3" },
	hash: "original-fingerprint",
	history: [],
	id: "run",
	snapshot: { status: "active", error: undefined, output: undefined },
	visits: {},
};

test("engine-owned named checkpoint retains its typed persisted payload", () => {
	const persisted = JSON.stringify(run);
	const expected = JSON.parse(persisted) as Run;
	expect(readCheckpoint(record(persisted))).toEqual(expected);
});

const NEXT_FORMAT = 2;

test.each([
	{ label: "missing", formatVersion: undefined },
	{ label: "future", formatVersion: NEXT_FORMAT },
])("$label checkpoint format requires a fresh run", ({ formatVersion }) => {
	try {
		readCheckpoint(record(JSON.stringify({ ...run, formatVersion })));
		throw new Error("Expected unsupported format refusal");
	} catch (error) {
		expect(error).toBeInstanceOf(BusyBeeError);
		expect(error).toMatchObject({
			reason: "unsupported_checkpoint_format",
			context: { name: "example" },
		});
		expect((error as Error).message).toContain("same already-authorized scope");
	}
});

test("malformed checkpoint JSON is diagnosed before restoring an actor", () => {
	try {
		readCheckpoint(record("{"));
		throw new Error("Expected invalid JSON refusal");
	} catch (error) {
		expect(error).toBeInstanceOf(BusyBeeError);
		expect(error).toMatchObject({
			reason: "invalid_checkpoint",
			context: { checkpoint: "checkpoint" },
		});
	}
});

function record(description: string): Pick<BeadRecord, "id" | "description"> {
	return { id: "checkpoint", description };
}
