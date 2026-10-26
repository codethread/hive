import { expect, test } from "bun:test";
import { resolveLock } from "../src/live.ts";

const canonical = "/projects/hive";
const ref = "refs/heads/main";
const key = new Bun.CryptoHasher("sha256").update(`${canonical}\n${ref}\n`).digest("hex");

test.each([
	{ stateHome: undefined, expected: "/home/agent/.local/state" },
	{ stateHome: "", expected: "/home/agent/.local/state" },
	{ stateHome: "relative/state", expected: "/home/agent/.local/state" },
	{ stateHome: "/selected/state", expected: "/selected/state" },
])(
	"merge queue uses the Hive qlock namespace under $expected #test-734",
	async ({ stateHome, expected }) => {
		const lock = await resolveLock(
			{ kind: "merge", ref },
			{
				home: "/home/agent",
				stateHome,
				capture: () => Promise.resolve({ code: 0, stdout: `${canonical}\n`, stderr: "" }),
			},
		);
		expect(lock).toBe(`${expected}/hive/qlock/agent-merge-${key}.lock`);
	},
);

test("an explicit lock stays outside the default namespace without repository lookup", async () => {
	const lock = await resolveLock(
		{ kind: "path", path: "/selected/custom.lock" },
		{
			home: "/home/agent",
			stateHome: "/selected/state",
			capture: () => {
				throw new Error("Explicit lock must not invoke Git or Honeycomb");
			},
		},
	);
	expect(lock).toBe("/selected/custom.lock");
});
