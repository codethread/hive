import {
	commandSchemas,
	inputSchema,
	machine,
	runBrief,
} from "../../../../.workflows/release/workflow.ts";
import { expect, test } from "bun:test";
import { initialTransition, transition } from "xstate";

const COMMIT_LENGTH = 40;
const input = inputSchema.parse({
	nextVersion: "0.6.0",
	request: "SIMULATED release; no publication authorized by this test.",
	releaseRepository: "example/releases",
	tapRepository: "example/homebrew-tools",
	tapCheckout: "/tap",
	canonicalRoot: "/hive",
	beadsDb: "/tracker/db",
	artifactDirectory: "/artifacts",
});
const evidence = { evidence: "Simulated verification only." };
const landed = { ...evidence, revision: "a".repeat(COMMIT_LENGTH) };
const [initial] = initialTransition(machine, input);

// eslint-disable-next-line max-statements -- Exercise the full chart path and its Land boundary.
test("release keeps Land, immutable build, native verification, publication and tap updates ordered", () => {
	let snapshot = initial;
	for (const stage of ["preflight", "prepare"] as const) {
		expect(snapshot.value).toBe(stage);
		[snapshot] = transition(machine, snapshot, {
			type: "NEXT",
			data: commandSchemas.next.parse(evidence),
		});
	}
	expect(snapshot.value).toBe("land");
	[snapshot] = transition(machine, snapshot, { type: "NEXT", data: evidence });
	expect(snapshot.value).toBe("land");
	[snapshot] = transition(machine, snapshot, {
		type: "LANDED",
		data: commandSchemas.landed.parse(landed),
	});
	for (const stage of ["build", "verify", "publish", "tap"] as const) {
		expect(snapshot.value).toBe(stage);
		expect(snapshot.context.revision).toBe(landed.revision);
		[snapshot] = transition(machine, snapshot, { type: "NEXT", data: evidence });
	}
	expect(snapshot.status).toBe("done");
	expect(runBrief(input).description).toContain("Land never starts it automatically");
});

test.each(["build", "verify"] as const)(
	"%s defects require a new landed revision before rebuilding",
	(stage) => {
		let snapshot = machine.resolveState({
			value: stage,
			context: { ...initial.context, revision: landed.revision },
		});
		[snapshot] = transition(machine, snapshot, { type: "CHANGES", data: evidence });
		expect(snapshot.value).toBe("repair");
		expect(snapshot.context.revision).toBeUndefined();
		[snapshot] = transition(machine, snapshot, { type: "NEXT", data: evidence });
		expect(snapshot.value).toBe("land");
		const revision = "b".repeat(COMMIT_LENGTH);
		[snapshot] = transition(machine, snapshot, { type: "LANDED", data: { ...evidence, revision } });
		expect(snapshot.value).toBe("build");
		expect(snapshot.context.revision).toBe(revision);
	},
);
