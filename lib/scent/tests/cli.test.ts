import { expect, test } from "bun:test";
import type { Dependencies } from "../src/cli.ts";
import { runCli } from "../src/cli.ts";

const SUCCESS = 0;
const FAILURE = 1;
const startInput = { hook_event_name: "SessionStart", session_id: "session", source: "startup" };

test.each(["claude", "codex"] as const)(
	"%s native callbacks use the installed identity protocol",
	async (harness) => {
		const fx = fixture();
		fx.deps.env.HIVE_AGENT_NAME = "supplied-bee";
		fx.deps.env.CLAUDE_ENV_FILE = "/session/environment";
		const code = await runCli(["system", "hook", "--harness", harness, "--json"], fx.deps);
		expect(code).toBe(SUCCESS);
		expect(JSON.parse(fx.output.join(""))).toMatchObject({
			hookSpecificOutput: {
				hookEventName: "SessionStart",
				additionalContext: expect.stringContaining("supplied-bee"),
			},
		});
		expect(fx.errors).toEqual([]);
		if (harness === "claude") {
			expect(fx.appended).toEqual([
				["/session/environment", expect.stringContaining("export BD_ACTOR='supplied-bee'")],
			]);
		} else {
			expect(fx.appended).toEqual([]);
		}
	},
);

test("native child callback never appends to the invoking environment", async () => {
	const fx = fixture({ hook_event_name: "SubagentStart", session_id: "parent", agent_id: "child" });
	fx.deps.env.BD_ACTOR = "parent";
	expect(await runCli(["system", "hook", "--harness", "claude"], fx.deps)).toBe(SUCCESS);
	expect(fx.appended).toEqual([]);
	expect(fx.deps.env.BD_ACTOR).toBe("parent");
	expect(fx.output.join("")).toContain("--actor");
});

test.each([
	{ argv: ["system", "hook", "--harness", "unknown", "--json"] },
	{ argv: ["system", "hook", "--harness", "claude", "--json"] },
])("invalid hook invocation $argv fails as one JSON document", async ({ argv }) => {
	const fx = fixture();
	expect(await runCli(argv, fx.deps)).toBe(FAILURE);
	expect(JSON.parse(fx.output.join(""))).toMatchObject({ ok: false, kind: "error" });
	expect(fx.errors).toEqual([]);
	expect(fx.appended).toEqual([]);
});

test("failed export writes remain failed with no success context", async () => {
	const fx = fixture();
	fx.deps.env.CLAUDE_ENV_FILE = "/session/environment";
	fx.deps.appendEnvironment = () => Promise.reject(new Error("write failed"));
	expect(await runCli(["system", "hook", "--harness", "claude", "--json"], fx.deps)).toBe(FAILURE);
	expect(JSON.parse(fx.output.join(""))).toMatchObject({ ok: false, reason: "operation_failed" });
	expect(fx.output.join("")).not.toContain("hookSpecificOutput");
});

test("Pi installation exports its embedded module without reading the application", async () => {
	const fx = fixture();
	expect(await runCli(["system", "pi-extension", "--json"], fx.deps)).toBe(SUCCESS);
	expect(JSON.parse(fx.output.join(""))).toEqual({
		ok: true,
		kind: "pi_extension",
		source: fx.deps.piExtension,
	});
	expect(fx.appended).toEqual([]);
});

test("offline changelog is available independently of hooks", async () => {
	const fx = fixture();
	expect(await runCli(["changelog", "--json"], fx.deps)).toBe(SUCCESS);
	expect(JSON.parse(fx.output.join(""))).toMatchObject({
		ok: true,
		kind: "changelog",
		tool: "scent",
	});
	expect(fx.appended).toEqual([]);
});

// --- Private functions ---

function fixture(input: object = startInput) {
	const output: string[] = [];
	const errors: string[] = [];
	const appended: [string, string][] = [];
	const deps: Dependencies = {
		env: {},
		stdin: () => Promise.resolve(JSON.stringify(input)),
		appendEnvironment: (path, contents) => {
			appended.push([path, contents]);
			return Promise.resolve();
		},
		stdout: (text) => output.push(text),
		stderr: (text) => errors.push(text),
		piExtension: "export default function identity() {}",
	};
	return { deps, output, errors, appended };
}
