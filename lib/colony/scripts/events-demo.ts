#!/usr/bin/env bun
// eslint-disable-next-line import/no-nodejs-modules -- The demo owns disposable repositories and retains evidence for inspection.
import { mkdir, mkdtemp, readFile, realpath } from "node:fs/promises";
import { execute } from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve private demo paths.
import { join } from "node:path";
import { subscribeColonyEvents } from "@hive/shared/colony-events/client";
// eslint-disable-next-line import/no-nodejs-modules -- All fixtures live outside the user's repositories.
import { tmpdir } from "node:os";
import { z } from "zod";

const FIRST = 0;
const TWO = 2;
const LAST = -1;
const TIMEOUT = 30_000;
const POLL = 25;
const checkout = new URL("../../../", import.meta.url).pathname;
const colony = new URL("../bin/colony.ts", import.meta.url).pathname;
const bee = new URL("../bin/bee.ts", import.meta.url).pathname;
const runner = new URL("../bin/listener-spike.ts", import.meta.url).pathname;
const temporaryRoot = await mkdtemp(join(tmpdir(), "hive-events-demo-"));
const root = await realpath(temporaryRoot);
const state = join(root, "state");
const socket = join(root, "colony.sock");
const env = { ...process.env, BD_ACTOR: "codex", BEADS_DB: join(root, "unused.db") };
const endpoints = ["first", "second"].map((name) => ({
	root: join(root, name),
	beadsDb: join(root, name, ".beads", "beads.db"),
}));
const consumers: ReturnType<typeof Bun.spawn>[] = [];

try {
	for (const repository of endpoints) {
		// eslint-disable-next-line no-await-in-loop -- Each native repository is prepared before it can produce work.
		await seed(repository);
		// eslint-disable-next-line no-await-in-loop -- The first add starts the private daemon; later adds reuse it.
		await control(["add", "--repo", repository.root, "--beads-db", repository.beadsDb]);
	}
	for (const name of ["settlement-log", "assessment-intake"]) {
		const config = join(root, `${name}.json`);
		// eslint-disable-next-line no-await-in-loop -- Finish each immutable consumer configuration before its process starts.
		await Bun.write(
			config,
			JSON.stringify({
				socket,
				state,
				colonies: endpoints,
				start: { kind: "retained" },
				checkpointFile: join(root, `${name}.cursor.json`),
				outputDirectory: join(root, "intake"),
			}),
		);
		const consumer = Bun.spawn(
			[process.execPath, runner, "run", name, "--repo", checkout, "--config", config],
			{
				cwd: checkout,
				env,
				stdout: Bun.file(join(root, `${name}.log`)),
				stderr: Bun.file(join(root, `${name}.stderr`)),
			},
		);
		consumers.push(consumer);
	}
	const observer = subscribeColonyEvents({
		socket,
		state,
		subscription: { colonies: endpoints, types: ["request.settled"], start: { kind: "retained" } },
		signal: AbortSignal.timeout(TIMEOUT),
	});
	await observer.next();
	await Promise.all(
		endpoints.map((repository) =>
			control(["wake", "--repo", repository.root, "--beads-db", repository.beadsDb]),
		),
	);
	const received = [];
	for await (const message of observer) {
		if (message.kind === "event") {
			received.push(message.event);
			if (received.length === TWO) {
				break;
			}
		}
	}
	const latest = received.at(LAST)!.cursor.sequence;
	await Promise.all(
		["settlement-log", "assessment-intake"].map((name) => checkpointReached(name, latest)),
	);
	console.log(
		JSON.stringify(
			{
				ok: true,
				root,
				events: received.map((event) => ({
					colony: event.repository.root,
					request: event.request.id,
					outcome: event.request.outcome,
					attempts: event.request.attempts.length,
				})),
				intake: join(root, "intake"),
				note: "Two deterministic Bun workers; no model calls. Listener processes and the private daemon are stopped on exit.",
			},
			undefined,
			TWO,
		),
	);
} finally {
	for (const consumer of consumers) {
		consumer.kill("SIGINT");
	}
	await Promise.all(consumers.map((consumer) => consumer.exited));
	await control(["daemon", "stop"]);
}

// --- Private functions ---
function control(args: string[]): Promise<string> {
	return execute(
		[process.execPath, colony, ...args, "--state", state, "--socket", socket, "--json"],
		checkout,
		env,
	);
}

// eslint-disable-next-line max-statements -- Prepare a complete native request with a deterministic local harness, never a model.
async function seed(repository: (typeof endpoints)[number]): Promise<void> {
	await mkdir(repository.root);
	const run = (args: string[]) =>
		execute(args, repository.root, { ...env, BEADS_DB: repository.beadsDb });
	const tracker = (args: string[]) =>
		run(["br", ...args, "--db", repository.beadsDb, "--actor", "codex", "--json"]);
	await run(["git", "init"]);
	await tracker(["init", "--prefix", "demo"]);
	const task = z
		.object({ id: z.string() })
		.parse(
			JSON.parse(await tracker(["create", "--title", "Deterministic event demo", "--owner", "ct"])),
		);
	await Bun.write(
		join(repository.root, "worker.ts"),
		`
const child = Bun.spawn(["br", "close", ${JSON.stringify(task.id)}, "--db", process.env.BEADS_DB, "--actor", process.env.BD_ACTOR, "--json"], { stdout: "pipe", stderr: "pipe" });
const [code, output, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
if (code !== 0) throw new Error(error);
console.log("Demo work completed", output);
`,
	);
	await Bun.write(
		join(repository.root, ".hive", "bees.toml"),
		`
owner = "ct"
humans = ["ct"]
ranking = "fifo"
max_retries = 0
[kinds.worker]
description = "Deterministic demo worker"
harness = "fixture"
model = "fixture"
effort = "low"
[formulas.fixture]
executable = ${JSON.stringify(process.execPath)}
argv = [${JSON.stringify(join(repository.root, "worker.ts"))}]
`,
	);
	await run([
		process.execPath,
		bee,
		"spawn",
		"worker",
		task.id,
		"--repo",
		repository.root,
		"--beads-db",
		repository.beadsDb,
		"--actor",
		"codex",
		"--json",
	]);
}

// eslint-disable-next-line max-statements -- Poll consumer progress and process failure together under one deadline.
async function checkpointReached(name: string, sequence: number): Promise<void> {
	const deadline = Date.now() + TIMEOUT;
	while (Date.now() < deadline) {
		const path = join(root, `${name}.cursor.json`);
		// eslint-disable-next-line no-await-in-loop -- This bounded manual demo observes external consumer processes.
		if (await Bun.file(path).exists()) {
			// eslint-disable-next-line no-await-in-loop -- Atomic replacements give a coherent snapshot of external progress.
			const value = JSON.parse(await readFile(path, "utf8"));
			if (value.cursor.sequence >= sequence) {
				return;
			}
		}
		if (consumers.some((consumer) => consumer.exitCode !== null && consumer.exitCode !== FIRST)) {
			throw new Error(`A listener failed; inspect ${root}`);
		}
		// eslint-disable-next-line no-await-in-loop -- Bounded manual probe, not test synchronization.
		await Bun.sleep(POLL);
	}
	throw new Error(`Listener checkpoint did not advance; inspect ${root}`);
}
