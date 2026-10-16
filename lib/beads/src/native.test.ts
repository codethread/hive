import { createNativeBeads, formatBeadsQuery } from "./native.ts";
import { expect, test } from "bun:test";

const ZERO = 0;
const ONE = 1;
const HIDDEN_CLOSED = 3;
const TOTAL_MATCHES = 4;

test.each(["list", "search"] as const)(
	"native projected %s preserves columns and page facts",
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
					"id,description,notes",
					"--json",
				]);
				return Promise.resolve(
					JSON.stringify({
						// eslint-disable-next-line unicorn/no-null -- Native absent selected text is null.
						issues: [{ id: "filed", description: null, notes: null, title: "unrequested" }],
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
		const fields = ["id", "description", "notes"] as const;
		const read = () => {
			if (mode === "search") {
				return service.searchProjected({ cwd: "/fixture" }, "needle", selection, fields);
			}
			return service.listProjected({ cwd: "/fixture" }, selection, fields);
		};
		const page = await read();
		expect(page).toMatchObject({
			issues: [{ id: "filed", description: "", notes: "" }],
			limit: 1,
			offset: 2,
			has_more: true,
		});
		expect(Object.keys(page.issues[ZERO]!)).toEqual(["id", "description", "notes"]);
		if (mode === "search") {
			expect(page).toHaveProperty("hidden_closed_count", HIDDEN_CLOSED);
		} else {
			expect(page).toHaveProperty("total", TOTAL_MATCHES);
		}
	},
);

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

test("native discovery preserves unspecified environment and parses its typed location", async () => {
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

test("sync status disables auto effects before inspecting the selected tracker", async () => {
	const service = createNativeBeads({
		execute: (argv) => {
			expect(argv).toEqual([
				"br",
				"--no-auto-import",
				"--no-auto-flush",
				"sync",
				"--status",
				"--json",
			]);
			return Promise.resolve(
				JSON.stringify({
					dirty_count: 0,
					db_newer: false,
					jsonl_content_hash: "snapshot",
					coverage_drift: false,
					jsonl_exists: true,
					jsonl_newer: false,
					workspace_health: "healthy",
				}),
			);
		},
	});
	const status = await service.sync.status({ cwd: "/tracker" });
	expect(status.workspace_health).toBe("healthy");
});
