import { expect, test } from "bun:test";
import { renderResponseInstructions } from "./response-protocol.ts";

test("response guidance keeps authored delivery, comments and machine results distinct", () => {
	expect(renderResponseInstructions({ taskId: "producer-1" })).toMatchInlineSnapshot(
		// eslint-disable-next-line @stylistic/max-len -- Snapshot preserves the complete communication contract.
		`"Publish your complete authored response with bee response publish producer-1 --body-file FILE --json, then verify it with bee response get RESPONSE_ID --json. For blocked work, publish and verify a blocker report against the same target. Put concise progress and verification evidence, including response IDs, in task comments. Workflow notes contain only the original machine {choice,data}; keep response prose in the filed response. Response records are closed linked docs, never executable child tasks."`,
	);
});
