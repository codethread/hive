/* eslint-disable require-await -- In-memory adapters implement asynchronous IO. */
import { expect, test } from "bun:test";
import {
	hookSection,
	installHooks,
	installMergeDriver,
	updateHookSection,
	validateTrackerHook,
} from "../src/hooks.ts";
import { BeeswaxError } from "../src/errors.ts";
import { bindCheckout } from "../src/binding.ts";
import { defaultProjectConfig } from "../src/config.ts";
import { fixture } from "./support.ts";

const root = "/repo";
const config = defaultProjectConfig("husky");

test("repeated generation preserves application bytes outside the owned section", async () => {
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
	{ description: "existing application hook", body: "echo application\n" },
	{ description: "edited section", body: hookSection.replace("hooks validate", "hooks custom") },
	{ description: "duplicate section", body: `${hookSection}\n${hookSection}` },
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

test("configured Git hook targets resolve through common metadata in a linked checkout", async () => {
	const fx = fixture();
	await installHooks({ root, config: defaultProjectConfig("git") }, fx.deps);
	expect(fx.files.get("/repo/.git/hooks/pre-commit")).toBe(updateHookSection(""));
});

test("local launcher updates only its verified generation and ignores application PATH shadowing", async () => {
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

test("merge driver quotes the installed command and preserves unrelated attributes", async () => {
	const fx = fixture();
	fx.files.set("/repo/.gitattributes", "*.png binary\n");
	await installMergeDriver(root, "/tools with spaces/beeswax", fx.deps);
	expect(fx.commands).toContainEqual([
		"git",
		"config",
		"--local",
		"merge.hive-beads.driver",
		'\'/tools with spaces/beeswax\' git merge "%O" "%A" "%B"',
	]);
	expect(fx.files.get("/repo/.gitattributes")).toBe(
		"*.png binary\n.beads/issues.jsonl text eol=lf merge=hive-beads\n",
	);
});

test.each([
	{ branch: "tracker/state", staged: ".beads/issues.jsonl", validates: true },
	{ branch: "main", staged: ".beads/issues.jsonl", validates: false },
	{ branch: "tracker/state", staged: ".beads/issues.jsonl\napp.rb", validates: false },
])(
	"validation selects only the staged tracker artifact: $branch $staged",
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
