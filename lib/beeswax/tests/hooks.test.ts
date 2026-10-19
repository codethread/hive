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
import { bootstrapHooks } from "../src/husky.ts";
import { defaultProjectConfig } from "../src/config.ts";
import { fixture } from "./support.ts";

const empty = 0;
const last = -1;
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

test.each([
	{ file: "cli", bound: false, contents: "" },
	{ file: "cli", bound: true, contents: "" },
	{ file: "receipt.json", bound: false, contents: "" },
	{ file: "receipt.json", bound: true, contents: "" },
	{ file: "receipt.json", bound: true, contents: '{"format":99}' },
])("invalid local binding $file is preserved (bound=$bound)", async ({ file, bound, contents }) => {
	const fx = fixture();
	if (bound) {
		await bindCheckout(root, "/tools/beeswax", fx.deps);
	}
	fx.files.set(`/repo/.git/beeswax/${file}`, contents);
	const before = new Map(fx.files);
	const modes: string[] = [];
	fx.deps.chmod = async (path) => {
		modes.push(path);
	};
	await expect(bindCheckout(root, "/tools/beeswax", fx.deps)).rejects.toBeInstanceOf(BeeswaxError);
	expect(fx.files).toEqual(before);
	expect(modes).toEqual([]);
});

test.each([
	"h",
	"LICENSE",
	".gitignore",
	"pre-commit",
	"pre-merge-commit",
	"prepare-commit-msg",
	"commit-msg",
	"post-commit",
	"applypatch-msg",
	"pre-applypatch",
	"post-applypatch",
	"pre-rebase",
	"post-rewrite",
	"post-checkout",
	"post-merge",
	"pre-push",
	"pre-auto-gc",
])("empty Husky runtime %s prevents writes, mode changes and activation", async (name) => {
	const fx = fixture();
	fx.files.set(`/repo/.husky/_/${name}`, "");
	const before = new Map(fx.files);
	const modes: string[] = [];
	fx.deps.chmod = async (path) => {
		modes.push(path);
	};
	await expect(bootstrapHooks(root, "husky", fx.deps)).rejects.toBeInstanceOf(BeeswaxError);
	expect(fx.files).toEqual(before);
	expect(modes).toEqual([]);
});

test("merge driver quotes the installed command and preserves unrelated attributes", async () => {
	const fx = fixture();
	fx.files.set("/repo/.gitattributes", "*.png binary\n");
	await installMergeDriver(root, "/tools with spaces/beeswax", fx.deps);
	expect(fx.files.get("/repo/.git/config")).toContain(
		String.raw`driver = "'/tools with spaces/beeswax' system git merge \"%O\" \"%A\" \"%B\""`,
	);
	expect(fx.files.get("/repo/.gitattributes")).toBe(
		[
			"*.png binary",
			"# beeswax:begin merge-attributes v1",
			".beads/issues.jsonl text eol=lf merge=hive-beads",
			"# beeswax:end merge-attributes",
			"",
		].join("\n"),
	);
	expect(fx.files.get("/repo/.git/beeswax/merge-driver.local.json")).toContain('"revision": 2');
});

test.each([{ managed: false }, { managed: true }])(
	"empty merge receipt preserves all integration files (managed=$managed)",
	async ({ managed }) => {
		const fx = fixture();
		if (managed) {
			await installMergeDriver(root, "/tools/beeswax", fx.deps);
		}
		fx.files.set("/repo/.git/beeswax/merge-driver.local.json", "");
		const before = new Map(fx.files);
		await expect(installMergeDriver(root, "/tools/beeswax", fx.deps)).rejects.toBeInstanceOf(
			BeeswaxError,
		);
		expect(fx.files).toEqual(before);
	},
);

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

test("merge upgrade preserves outside config and attributes including trailing bytes", async () => {
	const fx = fixture();
	const before = "# user config\n[core]\n\teditor = vim # keep\n\n";
	const attributes = "# keep\n*.png binary\n\n";
	fx.files.set("/repo/.git/config", before);
	fx.files.set("/repo/.gitattributes", attributes);
	await installMergeDriver(root, "/v1/beeswax", fx.deps);
	await installMergeDriver(root, "/v2/beeswax", fx.deps);
	expect(fx.files.get("/repo/.git/config")?.startsWith(before)).toBe(true);
	expect(fx.files.get("/repo/.gitattributes")?.startsWith(attributes)).toBe(true);
	expect(fx.files.get("/repo/.git/config")).toContain("'/v2/beeswax'");
});

test.each([
	{ body: ".beads/issues.jsonl text eol=lf merge=hive-beads\n", file: ".gitattributes" },
	{
		body: ".beads/issues.jsonl merge=custom\n.beads/issues.jsonl merge=hive-beads\n",
		file: ".gitattributes",
	},
	{ body: "# beeswax:begin merge-attributes v9\n", file: ".gitattributes" },
	{ body: "# beeswax:begin merge-driver v9\n", file: ".git/config" },
])(
	"merge integration refuses unowned or malformed $file before effects: $body",
	async ({ body, file }) => {
		const fx = fixture();
		fx.files.set(`/repo/${file}`, body);
		const before = new Map(fx.files);
		await expect(installMergeDriver(root, "/tools/beeswax", fx.deps)).rejects.toBeInstanceOf(
			BeeswaxError,
		);
		expect(fx.files).toEqual(before);
	},
);

test("duplicate effective Git values refuse all merge effects", async () => {
	const fx = fixture();
	fx.deps.exec = async () => ({ exitCode: 0, stderr: "", stdout: "hive-beads\0hive-beads\0" });
	await expect(installMergeDriver(root, "/tools/beeswax", fx.deps)).rejects.toBeInstanceOf(
		BeeswaxError,
	);
	expect(fx.files.size).toBe(empty);
});

test("moved v1 receipt authorizes only exact prior bare merge generation", async () => {
	const fx = fixture();
	const prior: Record<string, string> = {
		"merge.hive-beads.name": "Hive Beads JSONL merge driver",
		"merge.hive-beads.driver": `'/old/beeswax' git merge "%O" "%A" "%B"`,
		"merge.hive-beads.recursive": "hive-beads",
	};
	fx.deps.exec = async (argv) => ({
		exitCode: 0,
		stderr: "",
		stdout: `${prior[argv.at(last)!]}\0`,
	});
	fx.files.set(
		"/repo/.git/beeswax/merge-driver.local.json",
		JSON.stringify({
			format: 1,
			revision: 1,
			generator: "merge-driver",
			beeswaxVersion: "0.6.0",
			config: prior,
			attribute: ".beads/issues.jsonl text eol=lf merge=hive-beads",
		}),
	);
	fx.files.set(
		"/repo/.git/config",
		[
			'[merge "hive-beads"]',
			"\tname = Hive Beads JSONL merge driver",
			String.raw`	driver = "'/old/beeswax' git merge \"%O\" \"%A\" \"%B\""`,
			"\trecursive = hive-beads",
			"# keep",
			"",
		].join("\n"),
	);
	fx.files.set(
		"/repo/.gitattributes",
		"# .beads/issues.jsonl text eol=lf merge=hive-beads\n" +
			"# header\n.beads/issues.jsonl text eol=lf merge=hive-beads\n# tail\n",
	);
	await installMergeDriver(root, "/new/beeswax", fx.deps);
	expect(fx.files.get("/repo/.git/config")).not.toContain("/old/beeswax");
	expect(fx.files.get("/repo/.git/config")).toContain("# keep\n");
	expect(fx.files.get("/repo/.gitattributes")).toStartWith(
		"# .beads/issues.jsonl text eol=lf merge=hive-beads\n# header\n# tail\n",
	);
});

test("bootstrap none preserves a custom hooksPath and performs no effects", async () => {
	const fx = fixture();
	fx.files.set("/repo/.git/config", "[core]\n\thooksPath = .githooks\n");
	const before = new Map(fx.files);
	await bootstrapHooks(root, "none", fx.deps);
	expect(fx.files).toEqual(before);
	expect(fx.commands).toEqual([]);
});

test("empty user Git value is a conflict rather than an absent key", async () => {
	const fx = fixture();
	fx.deps.exec = async () => ({ exitCode: 0, stderr: "", stdout: "\0" });
	await expect(installMergeDriver(root, "/tools/beeswax", fx.deps)).rejects.toBeInstanceOf(
		BeeswaxError,
	);
	expect(fx.files.size).toBe(empty);
});

test("receipt left at the old location never authorizes bare merge configuration", async () => {
	const fx = fixture();
	fx.files.set("/repo/.hive/beeswax/meta/merge-driver.local.json", "old evidence stays untouched");
	fx.deps.exec = async () => ({
		exitCode: 0,
		stderr: "",
		stdout: "Hive Beads JSONL merge driver\0",
	});
	const before = new Map(fx.files);
	await expect(installMergeDriver(root, "/tools/beeswax", fx.deps)).rejects.toBeInstanceOf(
		BeeswaxError,
	);
	expect(fx.files).toEqual(before);
});
