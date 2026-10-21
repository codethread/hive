import { createNativeBeads, formatBeadsQuery } from "./native.ts";
import { expect, test } from "bun:test";
import { ZodError } from "zod";

const ZERO = 0;
const ONE = 1;
const HIDDEN_CLOSED = 3;
const TOTAL_MATCHES = 4;

test("native creation links its parent atomically alongside supplied dependencies", async () => {
	const calls: string[][] = [];
	const service = createNativeBeads({
		execute: (argv) => {
			calls.push(argv);
			return Promise.resolve(
				JSON.stringify({
					id: "hv-child",
					title: "Child",
					status: "open",
					priority: 2,
					issue_type: "task",
					created_at: "2026-10-21T00:00:00Z",
					updated_at: "2026-10-21T00:00:00Z",
				}),
			);
		},
	});
	await service.create(
		{ cwd: "/fixture" },
		{
			title: "Child",
			parent: "hv-parent",
			deps: [{ id: "hv-other", type: "related" }],
		},
	);
	expect(calls).toEqual([
		[
			"br",
			"create",
			"--title",
			"Child",
			"--deps",
			"related:hv-other,parent-child:hv-parent",
			"--json",
		],
	]);
});

test("native update retains parent reassignment", async () => {
	const service = createNativeBeads({
		execute: (argv) => {
			expect(argv).toEqual(["br", "update", "hv-child", "--parent", "hv-parent", "--json"]);
			return Promise.resolve("[]");
		},
	});
	await service.update({ cwd: "/fixture" }, ["hv-child"], { parent: "hv-parent" });
});

test.each(["list", "search"] as const)(
	"native projected %s preserves columns and page facts #test-579",
	async (mode) => {
		const service = createNativeBeads({
			execute: (argv) => {
				const command = ["list"];
				if (mode === "search") {
					command.splice(ZERO, ONE, "search", "needle");
				}
				expect(argv).toEqual([
					"br",
					...command,
					"--label",
					"response",
					"--all",
					"--limit",
					"1",
					"--offset",
					"2",
					"--fields",
					"id,description,notes,owner",
					"--json",
				]);
				return Promise.resolve(
					JSON.stringify({
						issues: [
							// eslint-disable-next-line unicorn/no-null -- Native absent selected text is null.
							{ id: "filed", description: null, notes: null, owner: "ct", title: "unrequested" },
						],
						total: 4,
						hidden_closed_count: 3,
						limit: 1,
						offset: 2,
						has_more: true,
					}),
				);
			},
		});
		const selection = { all: true, labels: ["response"], limit: 1, offset: 2 };
		const fields = ["id", "description", "notes", "owner"] as const;
		const read = () => {
			if (mode === "search") {
				return service.searchProjected({ cwd: "/fixture" }, "needle", selection, fields);
			}
			return service.listProjected({ cwd: "/fixture" }, selection, fields);
		};
		const page = await read();
		expect(page).toMatchObject({
			issues: [{ id: "filed", description: "", notes: "", owner: "ct" }],
			limit: 1,
			offset: 2,
			has_more: true,
		});
		expect(Object.keys(page.issues[ZERO]!)).toEqual(["id", "description", "notes", "owner"]);
		if (mode === "search") {
			expect(page).toHaveProperty("hidden_closed_count", HIDDEN_CLOSED);
		} else {
			expect(page).toHaveProperty("total", TOTAL_MATCHES);
		}
	},
);

test("native routing projection preserves status, AND labels and unlimited selection", async () => {
	const service = createNativeBeads({
		execute: (argv) => {
			expect(argv).toEqual([
				"br",
				"list",
				"--status",
				"closed",
				"--label",
				"system",
				"--label",
				"bee",
				"--label",
				"bee-outcome:pending",
				"--limit",
				"0",
				"--fields",
				"id,description",
				"--json",
			]);
			return Promise.resolve(
				JSON.stringify({
					issues: [{ id: "request", description: "captured", title: "unrequested" }],
					total: 1,
					limit: 0,
					offset: 0,
					has_more: false,
				}),
			);
		},
	});
	const page = await service.listProjected(
		{ cwd: "/fixture" },
		{ status: ["closed"], labels: ["system", "bee", "bee-outcome:pending"], limit: 0 },
		["id", "description"],
	);
	expect(page.issues).toEqual([{ id: "request", description: "captured" }]);
});

test.each([
	{ name: "missing id", row: { description: "captured" } },
	{ name: "invalid id", row: { id: 42, description: "captured" } },
	{ name: "missing description", row: { id: "request" } },
	{ name: "invalid description", row: { id: "request", description: {} } },
])("native routing projection rejects $name", async ({ row }) => {
	const service = createNativeBeads({
		execute: () =>
			Promise.resolve(
				JSON.stringify({
					issues: [row],
					total: 1,
					limit: 0,
					offset: 0,
					has_more: false,
				}),
			),
	});
	await expect(
		service.listProjected(
			{ cwd: "/fixture" },
			{ status: ["open"], labels: ["system", "bee"], limit: 0 },
			["id", "description"],
		),
	).rejects.toBeInstanceOf(ZodError);
});

test.each([
	{ mode: "flush" as const, flag: "--flush-only" },
	{ mode: "import" as const, flag: "--import-only" },
	{ mode: "merge" as const, flag: "--merge" },
])(
	"native $mode retains explicit selection and attribution independently of cwd",
	async ({ mode, flag }) => {
		const calls: { argv: string[]; cwd: string; env: NodeJS.ProcessEnv }[] = [];
		const service = createNativeBeads({
			env: { BEADS_DB: "old", BD_ACTOR: "old", SENTINEL: "kept" },
			execute: (argv, cwd, env) => {
				calls.push({ argv, cwd, env });
				return Promise.resolve("{}");
			},
		});
		await service.sync[mode]({ cwd: "/worktree", db: "/tracker/beads.db", actor: "worker" });
		expect(calls).toEqual([
			{
				argv: ["br", "sync", flag, "--json", "--db", "/tracker/beads.db", "--actor", "worker"],
				cwd: "/worktree",
				env: { BEADS_DB: "/tracker/beads.db", BD_ACTOR: "worker", SENTINEL: "kept" },
			},
		]);
	},
);

test("query diagnostics retain literal label groups, zero limits and hyphen-leading values", () => {
	expect(
		formatBeadsQuery(
			{
				labels: ["Case", "one,two"],
				labelAny: ["one", "two"],
				excludeLabels: ["system"],
				titleContains: "-literal",
				limit: 0,
			},
			"needle",
		),
	).toEqual([
		"search",
		"needle",
		"--label",
		"Case",
		"--label",
		"one,two",
		"--label-any",
		"one",
		"--label-any",
		"two",
		"--exclude-label",
		"system",
		"--title-contains=-literal",
		"--limit",
		"0",
	]);
});

test("native discovery preserves unspecified environment and parses its typed location #test-587", async () => {
	const service = createNativeBeads({
		env: { BEADS_DB: "/selected/beads.db", BD_ACTOR: "reader" },
		execute: (argv, cwd, env) => {
			expect(argv).toEqual(["br", "where", "--json"]);
			expect(cwd).toBe("/execution");
			expect(env).toEqual({ BEADS_DB: "/selected/beads.db", BD_ACTOR: "reader" });
			return Promise.resolve(
				'{"database_path":"/selected/beads.db","beads_dir":"/selected","jsonl_path":"/exports/custom.jsonl"}',
			);
		},
	});
	expect(await service.where({ cwd: "/execution" })).toEqual({
		database_path: "/selected/beads.db",
		jsonl_path: "/exports/custom.jsonl",
		beads_dir: "/selected",
	});
});
