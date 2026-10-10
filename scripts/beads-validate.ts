import { parseJsonl } from "./beads-jsonl.ts";

const success = 0;

// Validate the staged artifact, which can differ from the live exported snapshot.
const snapshot = Bun.spawn(["git", "show", ":.beads/issues.jsonl"], {
	stderr: "inherit",
	stdout: "pipe",
});
const contents = await new Response(snapshot.stdout).text();
const code = await snapshot.exited;
if (code !== success) {
	process.exit(code);
}
const result = parseJsonl(contents, "staged .beads/issues.jsonl");
if (result.kind === "invalid") {
	throw new Error(result.message);
}
