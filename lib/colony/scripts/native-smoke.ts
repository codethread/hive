#!/usr/bin/env bun
// eslint-disable-next-line import/no-nodejs-modules -- Every probe endpoint and executable is explicit.
import { join, resolve } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Manual native probes retain an isolated repository and private evidence directory.
import { mkdir, realpath } from "node:fs/promises";
import type { ColonyInspection } from "@hive/shared";
import { Command } from "commander";
import { colonyResponseSchema } from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Confirm removal of the owned Unix socket after shutdown.
import { existsSync } from "node:fs";
// eslint-disable-next-line import/no-nodejs-modules -- Decode repository entry paths, including spaces.
import { fileURLToPath } from "node:url";
import { match } from "ts-pattern";
import { z } from "zod";

const SUCCESS = 0;
const PROBE_SIGNAL = 0;
const FIRST = 0;
const ONE = 1;
const JSON_INDENT = 2;
const PRIVATE_MODE = 0o700;
const COMMAND_TIMEOUT = 15_000;
const PROVIDER_TIMEOUT = 180_000;
const POLL_INTERVAL = 250;
const ACTOR = "native-probe";
const COLONY = fileURLToPath(new URL("../bin/colony.ts", import.meta.url));
const BEE = fileURLToPath(new URL("../bin/bee.ts", import.meta.url));
const optionsSchema = z.object({
	executable: z.string().min(ONE),
	harness: z.enum(["codex", "pi"]),
	model: z.string().min(ONE),
	output: z.string().min(ONE),
});
type Options = z.infer<typeof optionsSchema>;
interface Fixture {
	/** Selected installed native profile, without account configuration changes. */
	options: Options;
	/** Newly created private evidence root. */
	root: string;
	/** Disposable canonical Git repository. */
	repo: string;
	/** Disposable native tracker inside the execution workspace. */
	database: string;
	/** Private daemon state and socket. */
	state: string;
	/** Private daemon socket. */
	socket: string;
	/** Explicit authority overrides inherited by every probe command. */
	env: Record<string, string | undefined>;
}

const command = new Command()
	.name("native-smoke")
	.description("Run one bounded real-provider probe and retain its private evidence")
	.requiredOption("--harness <codex|pi>", "Installed native profile")
	.requiredOption("--executable <path>", "Native harness executable")
	.requiredOption("--model <model>", "Explicit native model")
	.requiredOption("--output <directory>", "New evidence directory; must not exist")
	.parse();
await run(optionsSchema.parse(command.opts()));

// --- Probe workflow ---
// eslint-disable-next-line max-statements -- One isolated probe owns fixture creation, public execution, evidence and cleanup.
async function run(options: Options): Promise<void> {
	const fixture = await createFixture(options);
	let spawnId: string | undefined = undefined;
	const errors: unknown[] = [];
	try {
		const task = z
			.object({ id: z.string() })
			.parse(
				await tracker(fixture, [
					"create",
					"--title",
					"Native tool subprocess conformance",
					"--owner",
					"ct",
				]),
			);
		await writeProbe(fixture, task.id);
		const created = z
			.object({ ok: z.literal(true), request: z.object({ assignee: z.string(), id: z.string() }) })
			.parse(
				JSON.parse(
					await invoke(fixture, BEE, [
						"spawn",
						"worker",
						task.id,
						"--actor",
						ACTOR,
						"--cwd",
						fixture.repo,
					]),
				),
			);
		spawnId = created.request.id;
		await colony(fixture, ["wake"]);
		await until(async () => {
			const inspection = await inspect(fixture);
			if (inspection.colony?.state === "failed") {
				throw new Error(inspection.colony.message);
			}
			return inspection.requests.some(({ id, state }) => id === spawnId && state === "terminal");
		}, PROVIDER_TIMEOUT);
		const inspection = await inspect(fixture);
		await save(fixture, "inspection.json", inspection);
		await verify(fixture, {
			identity: created.request.assignee,
			inspection,
			spawnId,
			taskId: task.id,
		});
	} catch (error) {
		errors.push(error);
	}
	try {
		await cleanup(fixture, spawnId);
	} catch (error) {
		errors.push(error);
	}
	await save(fixture, "result.json", {
		errors: errors.map(String),
		harness: options.harness,
		model: options.model,
		passed: errors.length === SUCCESS,
	});
	console.log(`Native ${options.harness} evidence: ${fixture.root}`);
	if (errors.length > SUCCESS) {
		throw new AggregateError(errors, "Native probe failed; evidence retained");
	}
}

// eslint-disable-next-line max-statements -- Keep explicit disposable authority and native version evidence together.
async function createFixture(options: Options): Promise<Fixture> {
	await mkdir(resolve(options.output), { mode: PRIVATE_MODE });
	const root = await realpath(resolve(options.output));
	const repo = join(root, "repo");
	const database = join(repo, ".beads", "beads.db");
	const fixture: Fixture = {
		database,
		env: {
			...process.env,
			BD_ACTOR: ACTOR,
			BEADS_DB: database,
			BEADS_JSONL: join(repo, ".beads", "issues.jsonl"),
			XDG_STATE_HOME: join(root, "unused"),
		},
		options,
		repo,
		root,
		socket: join(root, "colony.sock"),
		state: join(root, "state"),
	};
	await mkdir(repo);
	await native(fixture, ["git", "init"]);
	const { BEADS_DB: ignored, ...initEnv } = fixture.env;
	void ignored;
	await native({ ...fixture, env: initEnv }, [
		"br",
		"init",
		"--prefix",
		"probe",
		"--actor",
		ACTOR,
		"--json",
	]);
	const brVersion = await native(fixture, ["br", "--version"]);
	const harnessVersion = await native(fixture, [resolve(options.executable), "--version"]);
	await save(fixture, "versions.json", {
		br: brVersion.trim(),
		bun: Bun.version,
		harness: harnessVersion.trim(),
	});
	return fixture;
}

async function writeProbe(fixture: Fixture, taskId: string): Promise<void> {
	const script = `const names = ["BD_ACTOR", "HIVE_AGENT_NAME", "BR_AGENT_NAME", "BR_HARNESS", "BR_MODEL", "BEADS_DB", "HIVE_ATTEMPT_ID"];
await Bun.write("tool-evidence.json", JSON.stringify({cwd: process.cwd(), env: Object.fromEntries(names.map(name => [name, process.env[name]]))}, null, 2));
const child = Bun.spawn(["br", "close", ${JSON.stringify(taskId)}, "--reason", "Native tool subprocess completed", "--db", process.env.BEADS_DB, "--actor", process.env.BD_ACTOR, "--json"], {stdout: "pipe", stderr: "pipe"});
const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
await Bun.write("tool-closure.json", JSON.stringify({code, stderr, stdout}, null, 2));
if (code !== 0) throw new Error(stderr);
console.log("Native tool probe complete");
`;
	await Bun.write(join(fixture.repo, "probe.ts"), script);
	const prompt = `Use your shell tool to execute this exact command in the current repository: ${JSON.stringify(process.execPath)} ./probe.ts . It writes a local environment receipt and closes only the disposable related task. Do not edit the script, override environment variables, close the spawn request, or change any account/hook/trust settings. After it succeeds, reply briefly and finish.`;
	const { argv, headless } = nativeArguments(fixture.options.harness);
	await Bun.write(
		join(fixture.repo, ".hive", "bees.toml"),
		`owner = "ct"
humans = ["ct"]
ranking = "fifo"
max_retries = 0
retry_delay_ms = 0
[limits]
colony = 1
kind = 1
worktree = 1
[kinds.worker]
description = "Run the disposable native harness probe."
harness = ${JSON.stringify(fixture.options.harness)}
model = ${JSON.stringify(fixture.options.model)}
effort = "low"
prompt = ${JSON.stringify(prompt)}
[formulas.${fixture.options.harness}]
executable = ${JSON.stringify(resolve(fixture.options.executable))}
headless = ${JSON.stringify(headless)}
argv = ${JSON.stringify(argv)}
`,
	);
	await save(fixture, "profile.json", {
		argv,
		headless,
		executable: resolve(fixture.options.executable),
		model: fixture.options.model,
	});
}

function nativeArguments(harness: Options["harness"]): { argv: string[]; headless: string[] } {
	return match(harness)
		.with("codex", () => ({
			headless: ["exec", "--sandbox", "workspace-write", "--json", "--ephemeral"],
			argv: [
				"--model",
				"{{model}}",
				"-c",
				'model_reasoning_effort="{{effort}}"',
				"-c",
				'shell_environment_policy.inherit="all"',
				"--",
				"{{prompt}}",
			],
		}))
		.with("pi", () => ({
			headless: [
				"--print",
				"--mode",
				"json",
				"--no-extensions",
				"--no-skills",
				"--no-prompt-templates",
				"--no-context-files",
				"--no-session",
				"--offline",
				"--tools",
				"bash,read",
			],
			argv: ["--model", "{{model}}", "--thinking", "{{effort}}", "--", "{{prompt}}"],
		}))
		.exhaustive();
}

// eslint-disable-next-line max-statements -- Verify native tool evidence against immutable launch and terminal tracker records.
async function verify(
	fixture: Fixture,
	result: { identity: string; inspection: ColonyInspection; spawnId: string; taskId: string },
): Promise<void> {
	const attempt = result.inspection.attempts[FIRST];
	if (!attempt || result.inspection.attempts.length !== ONE) {
		throw new Error("Expected exactly one native attempt");
	}
	const checkpoint = result.inspection.requests.find(({ id }) => id === result.spawnId);
	if (checkpoint?.outcome !== "completed") {
		throw new Error(`Native request did not complete: ${checkpoint?.outcome}`);
	}
	const evidence = z
		.object({
			cwd: z.literal(fixture.repo),
			env: z.object({
				BD_ACTOR: z.literal(result.identity),
				BEADS_DB: z.literal(fixture.database),
				BR_AGENT_NAME: z.literal("worker"),
				BR_HARNESS: z.literal(fixture.options.harness),
				BR_MODEL: z.literal(fixture.options.model),
				HIVE_AGENT_NAME: z.literal(result.identity),
				HIVE_ATTEMPT_ID: z.literal(attempt.id),
			}),
		})
		.parse(await Bun.file(join(fixture.repo, "tool-evidence.json")).json());
	z.object({ code: z.literal(SUCCESS) }).parse(
		await Bun.file(join(fixture.repo, "tool-closure.json")).json(),
	);
	const task = await tracker(fixture, ["show", result.taskId]);
	const spawn = await tracker(fixture, ["show", result.spawnId]);
	z.array(z.object({ status: z.literal("closed") }))
		.length(ONE)
		.parse(task);
	z.array(z.object({ close_reason: z.literal("completed"), status: z.literal("closed") }))
		.length(ONE)
		.parse(spawn);
	await until(
		async () =>
			z.object({ kind: z.string() }).parse(await Bun.file(attempt.paths.worker).json()).kind !==
			"running",
		COMMAND_TIMEOUT,
	);
	await save(fixture, "native-rows.json", { spawn, task });
	await save(fixture, "tool-evidence.json", evidence);
}

// eslint-disable-next-line max-statements -- Always stop the owned daemon while retaining reconciliation and teardown errors.
async function cleanup(fixture: Fixture, spawnId: string | undefined): Promise<void> {
	const errors: unknown[] = [];
	try {
		if (spawnId !== undefined) {
			await settleProbe(fixture, spawnId);
		}
	} catch (error) {
		errors.push(error);
	}
	try {
		const daemon = await colony(fixture, ["daemon", "status"]);
		if (daemon.kind !== "status") {
			throw new Error("Unexpected daemon status response");
		}
		await colony(fixture, ["daemon", "stop"]);
		await until(
			// eslint-disable-next-line node/no-sync -- One private socket existence check per bounded cleanup poll.
			() => !existsSync(fixture.socket) && !processExists(daemon.pid),
			COMMAND_TIMEOUT,
		);
		await save(fixture, "cleanup.json", {
			daemonId: daemon.id,
			daemonPid: daemon.pid,
			daemonStopped: true,
			socketAbsent: true,
		});
	} catch (error) {
		errors.push(error);
	}
	if (errors.length > SUCCESS) {
		throw new AggregateError(errors, "Native probe cleanup failed");
	}
}

async function settleProbe(fixture: Fixture, spawnId: string): Promise<void> {
	const current = await inspect(fixture);
	if (current.requests.some(({ id, state }) => id === spawnId && state === "terminal")) {
		return;
	}
	await invoke(fixture, BEE, ["stop", spawnId, "--actor", ACTOR]);
	await colony(fixture, ["wake"]);
	await until(async () => {
		const inspection = await inspect(fixture);
		if (inspection.colony?.state === "failed") {
			throw new Error(inspection.colony.message);
		}
		return inspection.requests.every(({ state }) => state === "terminal");
	}, COMMAND_TIMEOUT);
}

function processExists(pid: number): boolean {
	try {
		process.kill(pid, PROBE_SIGNAL);
		return true;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ESRCH") {
			return false;
		}
		throw error;
	}
}

async function inspect(fixture: Fixture): Promise<ColonyInspection> {
	const result = await colony(fixture, ["inspect"]);
	if (result.kind !== "inspection") {
		throw new Error("Unexpected inspection response");
	}
	return result;
}
async function colony(fixture: Fixture, args: string[]) {
	const { ok, ...payload } = z
		.looseObject({ ok: z.literal(true) })
		.parse(
			JSON.parse(
				await invoke(fixture, COLONY, [
					...args,
					"--state",
					fixture.state,
					"--socket",
					fixture.socket,
				]),
			),
		);
	void ok;
	return colonyResponseSchema.parse(payload);
}
function invoke(fixture: Fixture, executable: string, args: string[]): Promise<string> {
	let scope: string[] = [];
	if (args[FIRST] !== "daemon") {
		scope = ["--repo", fixture.repo, "--beads-db", fixture.database];
	}
	return native(fixture, [process.execPath, executable, ...args, ...scope, "--json"]);
}
async function tracker(fixture: Fixture, args: string[]): Promise<unknown> {
	return JSON.parse(
		await native(fixture, ["br", ...args, "--db", fixture.database, "--actor", ACTOR, "--json"]),
	);
}
async function native(fixture: Fixture, argv: string[]): Promise<string> {
	const child = Bun.spawn(argv, {
		cwd: fixture.repo,
		env: fixture.env,
		stderr: "pipe",
		stdout: "pipe",
	});
	const timeout = setTimeout(() => child.kill(), COMMAND_TIMEOUT);
	try {
		const [stdout, stderr, code] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		if (code !== SUCCESS) {
			throw new Error(`${argv[FIRST]} failed (${code}): ${stderr || stdout}`);
		}
		return stdout;
	} finally {
		clearTimeout(timeout);
	}
}
async function until(check: () => Promise<boolean> | boolean, timeout: number): Promise<void> {
	const deadline = Date.now() + timeout;
	// eslint-disable-next-line no-await-in-loop -- Bound polling by native lifecycle evidence, never a fixed completion sleep.
	while (!(await check())) {
		if (Date.now() >= deadline) {
			throw new Error("Native probe deadline exceeded");
		}
		// eslint-disable-next-line no-await-in-loop -- Wait only between observable lifecycle checks.
		await Bun.sleep(POLL_INTERVAL);
	}
}
async function save(fixture: Fixture, name: string, value: unknown): Promise<void> {
	await Bun.write(join(fixture.root, name), JSON.stringify(value, undefined, JSON_INDENT));
}
