import { compatibleWorkflowVersion, workflowVersionSchema } from "../../src/compatibility.ts";
import { expect, test } from "bun:test";

test.each([
	{ saved: "1.2.3", proposed: "1.2.3", compatible: true, testId: "" },
	{ saved: "1.2.3", proposed: "1.2.4", compatible: true, testId: "" },
	{ saved: "1.2.3", proposed: "1.3.0", compatible: true, testId: "" },
	{ saved: "1.2.3", proposed: "2.0.0", compatible: false, testId: "" },
	{ saved: "1.2.3", proposed: "1.2.2", compatible: false, testId: "" },
	{ saved: "0.2.3", proposed: "0.2.4", compatible: true, testId: "" },
	{ saved: "0.2.3", proposed: "0.3.0", compatible: false, testId: "" },
	{ saved: "0.0.3", proposed: "0.0.4", compatible: false, testId: "" },
	{ saved: "1.2.3-beta.1", proposed: "1.2.3-beta.1", compatible: true, testId: "" },
	{ saved: "1.2.3-beta.1", proposed: "1.2.3-beta.2", compatible: false, testId: "" },
	{ saved: "1.2.3-beta.1", proposed: "1.2.3", compatible: false, testId: "" },
	{ saved: "1.2.3", proposed: "1.2.4-beta.1", compatible: false, testId: "" },
	{ saved: "1.2.3+old", proposed: "1.2.3+new", compatible: true, testId: "#test-64" },
])(
	"$saved can resume $proposed: $compatible $testId #test-537",
	({ saved, proposed, compatible }) => {
		expect(compatibleWorkflowVersion(saved, proposed)).toBe(compatible);
	},
);

test.each(["1", "1.2", "v1.2.3", "01.2.3", "latest", "1.2.3-01"])(
	"manifest version %s must be full SemVer",
	(version) => {
		expect(workflowVersionSchema.safeParse(version).success).toBe(false);
	},
);
