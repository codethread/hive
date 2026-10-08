/* eslint-disable import/no-nodejs-modules -- This executable demo creates an isolated repository for actual review work. */
import { mkdir, mkdtemp } from "node:fs/promises";
import { Command } from "commander";
import { createServices } from "../../src/native.ts";
import { join } from "node:path";
import { start } from "../../src/runtime.ts";
import { tmpdir } from "node:os";

const INDENT = 2;
const services = createServices();
function execute(args: string[], cwd = services.cwd): Promise<string> {
	return services.execute(args, cwd);
}
const identity = new Command()
	.requiredOption("--owner <human>", "Accountable human")
	.requiredOption("--actor <agent>", "Audit actor", process.env.BD_ACTOR)
	.parse()
	.opts();

// Prepare real executable code to review. No canned planner/reviewer results or auto-advancement.
const root = await mkdtemp(join(tmpdir(), "busybee-change-"));
const repo = join(root, "repo");
await mkdir(repo);
const db = join(repo, ".beads/beads.db");
await execute(["git", "init", "--quiet", repo]);
await execute(["br", "init", "--prefix", "change", "--db", db, "--actor", identity.actor], repo);
await Bun.write(join(repo, ".gitignore"), ".beads/\n");
await Bun.write(
	join(repo, "package.json"),
	'{"name":"task-list-example","type":"module","scripts":{"test":"bun test"}}\n',
);
await Bun.write(
	join(repo, "tasks.json"),
	JSON.stringify(
		[
			{ id: "T1", status: "done", title: "Ship the previous release" },
			{ id: "T2", status: "open", title: "Repair export pagination" },
			{ id: "T3", status: "open", title: "Document search filters" },
		],
		undefined,
		INDENT,
	),
);
await Bun.write(
	join(repo, "src/tasks.js"),
	`export function selectTasks(tasks, { status }) {
	return tasks.filter((task) => !status || task.status === status);
}
`,
);
await Bun.write(
	join(repo, "cli.js"),
	`import { parseArgs } from "node:util";
import { selectTasks } from "./src/tasks.js";
const { values } = parseArgs({ options: { status: { type: "string" } } });
const tasks = await Bun.file(new URL("./tasks.json", import.meta.url)).json();
console.log(JSON.stringify(selectTasks(tasks, values)));
`,
);
await Bun.write(
	join(repo, "README.md"),
	"# Task list\n\nRun `bun cli.js --status open` to list open tasks in input order.\n",
);
await execute(
	["git", "add", ".gitignore", "package.json", "tasks.json", "src", "cli.js", "README.md"],
	repo,
);
await execute(
	[
		"git",
		"-c",
		"user.name=Busy Bee example",
		"-c",
		"user.email=poc@example.invalid",
		"-c",
		"core.hooksPath=/dev/null",
		"commit",
		"--quiet",
		"-m",
		"Example baseline",
	],
	repo,
);
const revision = await execute(["git", "rev-parse", "HEAD"], repo);
const base = revision.trim();

// A proposed patch with observable defects. The agent must discover and explain them.
await Bun.write(
	join(repo, "src/tasks.js"),
	`export function selectTasks(tasks, { status, limit }) {
	const selected = limit ? tasks.slice(0, limit) : tasks;
	return selected.filter((task) => !status || task.status === status);
}
`,
);
await Bun.write(
	join(repo, "cli.js"),
	`import { parseArgs } from "node:util";
import { selectTasks } from "./src/tasks.js";
const { values } = parseArgs({ options: { status: { type: "string" }, limit: { type: "string" } } });
const limit = values.limit === undefined ? undefined : Number(values.limit);
if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
	throw new Error("--limit must be a non-negative integer");
}
const tasks = await Bun.file(new URL("./tasks.json", import.meta.url)).json();
console.log(JSON.stringify(selectTasks(tasks, { status: values.status, limit })));
`,
);
await Bun.write(
	join(repo, "README.md"),
	"# Task list\n\nRun `bun cli.js --status open --limit 1` to list the first open task.\nUse `--limit 0` for all matching tasks. Omit the limit for all matches.\n",
);
const inputFile = join(root, "input.json");
await Bun.write(
	inputFile,
	JSON.stringify(
		{
			base,
			execution: { mode: "manual" },
			request:
				"Add an optional non-negative integer --limit. Filter by --status before applying the limit and preserve input order. A limit of 0 must return no tasks; an omitted limit returns all matches. Reject negative or fractional limits. Document the behavior and provide meaningful regression coverage.",
			title: "Add --limit to the task list CLI",
		},
		undefined,
		INDENT,
	),
);
const run = await start(new URL("workflow.ts", import.meta.url).pathname, {
	actor: identity.actor,
	db,
	inputFile,
	owner: identity.owner,
	repo,
});
const evidence = { db, inputFile, repo, root, run };
await Bun.write(join(root, "run.json"), JSON.stringify(evidence, undefined, INDENT));
console.log(JSON.stringify(evidence, undefined, INDENT));
