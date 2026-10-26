/* eslint-disable require-await -- In-memory adapters implement asynchronous IO. */
import { expect, test } from "bun:test";
import { hookSection, installHooks, validateTrackerHook } from "../src/hooks.ts";
import { BeeswaxError } from "../src/errors.ts";
import { bindCheckout } from "../src/binding.ts";
import { defaultProjectConfig } from "../src/config.ts";
import { fixture } from "./support.ts";

const root = "/repo";
const config = defaultProjectConfig("husky");

test("repeated generation preserves application bytes outside the owned section #test-511", async () => {
	const fx = fixture();
	const app = `# application header\n${hookSection}\n\nprintf '%s\\n' custom\n`;
	fx.files.set("/repo/.husky/pre-commit", app);
	const first = await installHooks({ root, config }, fx.deps);
	const snapshot = new Map(fx.files);
	expect(await installHooks({ root, config }, fx.deps)).toEqual(first);
	expect(fx.files).toEqual(snapshot);
	expect(fx.files.get("/repo/.husky/pre-commit")).toBe(app);
});

test.each([
	{ description: "edited section", body: hookSection.replace("hooks validate", "hooks custom") },
	{ description: "duplicate section #test-751", body: `${hookSection}\n${hookSection}` },
	{ description: "broken section", body: "# beeswax:begin tracker-validation v1\n" },
])(
	"$description gives an agent migration goal and preserves all configured files",
	async ({ body }) => {
		const fx = fixture();
		fx.files.set("/repo/.husky/pre-merge-commit", body);
		const before = new Map(fx.files);
		const failure = await installHooks({ root, config }, fx.deps).catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(BeeswaxError);
		expect(failure).toMatchObject({
			context: { nextCommand: "beeswax migrate hooks", requiresUser: true },
		});
		expect(fx.files).toEqual(before);
	},
);

test("local launcher updates only verified generations and ignores application PATH shadowing #test-574", async () => {
	const fx = fixture();
	await bindCheckout(root, "/tools with spaces/beeswax", fx.deps);
	expect(fx.files.get("/repo/.git/beeswax/cli")).toContain(
		"exec '/tools with spaces/beeswax' \"$@\"",
	);
	await bindCheckout(root, "/tools/v2/beeswax", fx.deps);
	fx.files.set("/repo/.git/beeswax/cli", "echo custom\n");
	await expect(bindCheckout(root, "/tools/v3/beeswax", fx.deps)).rejects.toBeInstanceOf(
		BeeswaxError,
	);
	expect(fx.files.get("/repo/.git/beeswax/cli")).toBe("echo custom\n");
});

test.each([
	{ branch: "main", staged: ".beads/issues.jsonl", validates: false },
	{ branch: "tracker/state", staged: ".beads/issues.jsonl\napp.rb", validates: false },
])(
	"validation selects only the staged tracker artifact: $branch $staged #test-685",
	async ({ branch, staged, validates }) => {
		let validated = false;
		await validateTrackerHook(
			root,
			{
				command: async (argv) => {
					if (argv.includes("--show-current")) {
						return branch;
					}
					return staged;
				},
			},
			async () => {
				validated = true;
			},
		);
		expect(validated).toBe(validates);
	},
);

test("an existing empty hook retains its mode while a new hook becomes executable", async () => {
	const fx = fixture();
	const modes: string[] = [];
	fx.files.set("/repo/.husky/pre-commit", "");
	fx.deps.chmod = async (path) => {
		modes.push(path);
	};
	await installHooks({ root, config }, fx.deps);
	expect(modes).toEqual(["/repo/.husky/pre-merge-commit"]);
});
