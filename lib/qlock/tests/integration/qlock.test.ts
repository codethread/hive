import { advanceQueue, enqueue } from "../../src/queue.ts";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { createLiveDependencies, openQueue } from "../../src/live.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Isolated filesystem fixtures exercise a compiled CLI.
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { Database } from "bun:sqlite";
import { createStaticProvider } from "skills-handler";
// eslint-disable-next-line import/no-nodejs-modules -- Locate the executable and fixture paths.
import { resolve } from "node:path";
import { runCli } from "../../src/cli.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Place subprocess fixtures outside the checkout.
import { tmpdir } from "node:os";

const entrypoint = resolve(import.meta.dirname, "../../bin/qlock.ts");
const queued = 75;
const usage = 2;
const childFailure = 19;
const success = 0;
const failure = 1;
const singleRunner = 1;
const ticketIncrement = 1;
let executable = "";
let buildDirectory = "";
let directory = "";
let lock = "";

beforeAll(async () => {
	buildDirectory = await mkdtemp(resolve(tmpdir(), "hive-qlock-binary-"));
	executable = resolve(buildDirectory, "qlock");
	const build = Bun.spawn(
		[process.execPath, "build", entrypoint, "--compile", "--outfile", executable],
		{ stdout: "pipe", stderr: "pipe" },
	);
	await Promise.all([new Response(build.stdout).text(), new Response(build.stderr).text()]);
	expect(await build.exited).toBe(success);
});

afterAll(async () => {
	await rm(buildDirectory, { recursive: true, force: true });
});

beforeEach(async () => {
	const temporary = await mkdtemp(resolve(tmpdir(), "hive-qlock-"));
	directory = await realpath(temporary);
	lock = resolve(directory, "test lock");
});

afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});

test("exec preserves command arguments, streams and exit status, then frees the queue #test-74", async () => {
	const result = await qlock([
		"exec",
		"-w",
		"0",
		"--lock",
		lock,
		"--",
		"bash",
		"-c",
		'printf "%s" "$1"; printf problem >&2; exit 19',
		"child",
		"two words",
	]);
	expect(result).toEqual({ code: childFailure, stdout: "two words", stderr: "problem" });
	expect(await liveQlock(["status", "--lock", lock])).toEqual({
		code: 0,
		stdout: "free\n",
		stderr: "",
	});
});

test(
	"urgent tickets skip queued work without pre-empting a ready ticket #test-80",
	// eslint-disable-next-line max-statements -- Verify the complete ordering lifecycle on one isolated queue.
	async () => {
		const first = await seedTicket();
		const normal = await seedTicket();
		const joined = await qlock([
			"exec",
			"-w",
			"0",
			"--urgent",
			"verification",
			"--lock",
			lock,
			"--",
			"true",
		]);
		expect(joined.code).toBe(queued);
		const urgent = timeoutTicket(joined.stderr);
		const status = await liveQlock(["status", "--lock", lock]);
		expect(Array.from(status.stdout.matchAll(/ticket \d+/gu), ([ticket]) => ticket)).toEqual(
			[first, urgent, normal].map((id) => `ticket ${id}`),
		);
		expect(status.stdout).toContain("[urgent: verification]");
		await expect(
			liveQlock(["exec", "-w", "0", "--ticket", urgent, "--lock", lock, "--", "true"]),
		).resolves.toMatchObject({
			code: queued,
		});
		await expect(
			liveQlock(["exec", "-w", "0", "--ticket", first, "--lock", lock, "--", "true"]),
		).resolves.toMatchObject({
			code: 0,
		});
		await expect(
			liveQlock(["exec", "-w", "0", "--ticket", normal, "--lock", lock, "--", "true"]),
		).resolves.toMatchObject({
			code: queued,
		});
		await expect(
			liveQlock(["exec", "-w", "0", "--ticket", urgent, "--lock", lock, "--", "true"]),
		).resolves.toMatchObject({
			code: 0,
		});
		await expect(
			liveQlock(["exec", "-w", "0", "--ticket", normal, "--lock", lock, "--", "true"]),
		).resolves.toMatchObject({
			code: 0,
		});
	},
);

test(
	"a running command holds the slot until its stdin-controlled exit #test-76",
	// eslint-disable-next-line max-statements -- Coordinate one real child through its public streams and queue status.
	async () => {
		const runner = Bun.spawn(
			[
				executable,
				"exec",
				"-w",
				"0",
				"--lock",
				lock,
				"--",
				"bash",
				"-c",
				'printf ready; read -r answer; printf "%s" "$answer"',
			],
			{ cwd: directory, stdin: "pipe", stdout: "pipe", stderr: "pipe" },
		);
		const reader = runner.stdout.getReader();
		try {
			const started = await reader.read();
			expect(new TextDecoder().decode(started.value)).toBe("ready");
			const status = await qlock(["status", "--lock", lock]);
			expect(status.stdout).toContain(`running pid ${runner.pid}`);
			const waiting = await qlock([
				"exec",
				"-w",
				"0",
				"-E",
				"19",
				"--lock",
				lock,
				"--",
				"printf",
				"not yet",
			]);
			expect(waiting.code).toBe(childFailure);
			expect(waiting.stdout).toBe("");
			expect(waiting.stderr).toContain("still queued");
			runner.stdin.write("released\n");
			const released = await reader.read();
			expect(new TextDecoder().decode(released.value)).toBe("released");
		} finally {
			runner.stdin.end();
			reader.releaseLock();
			await runner.exited;
		}
		await expect(
			qlock(["exec", "-w", "0", "--ticket", "2", "--lock", lock, "--", "true"]),
		).resolves.toMatchObject({
			code: 0,
		});
	},
);

test.each([
	{ args: [] },
	{ args: ["exec", "-w", "0", "--lock", "LOCK", "--"] },
	{ args: ["exec", "-w", "0", "--ticket", "bad", "--lock", "LOCK", "--", "true"] },
	{ args: ["exec", "-w", "bad", "--lock", "LOCK", "--", "true"] },
	{ args: ["status", "--merge-target", "refs/tags/main"] },
])("invalid invocation $args reports usage #test-82", async ({ args }) => {
	const result = await qlock(args);
	expect(result.code).toBe(usage);
	expect(result.stderr).toContain("qlock:");
});

test("parallel initial exec attempts retain unique tickets behind a held slot #test-75", async () => {
	const first = await seedTicket();
	const count = 12;
	const results = await Promise.all(
		Array.from({ length: count }, () =>
			qlock(["exec", "-w", "0", "--lock", lock, "--", "printf", "not yet"]),
		),
	);
	expect(results.every(({ code, stdout }) => code === queued && stdout === "")).toBe(true);
	const ids = results.map(({ stderr }) => Number(timeoutTicket(stderr)));
	expect(new Set(ids).size).toBe(count);
	const status = await qlock(["status", "--json", "--lock", lock]);
	expect(JSON.parse(status.stdout).tickets.map((ticket: { id: number }) => ticket.id)).toEqual([
		Number(first),
		...ids.toSorted((left, right) => left - right),
	]);
});

test(
	"competing exec processes cannot both launch a child on the same ticket #test-79",
	// eslint-disable-next-line max-statements -- Coordinate two contenders with child streams instead of sleeps.
	async () => {
		const ticket = await seedTicket();
		const competitors = Array.from({ length: 2 }, () =>
			Bun.spawn(
				[
					executable,
					"exec",
					"-w",
					"0",
					"--ticket",
					ticket,
					"--lock",
					lock,
					"--",
					"bash",
					"-c",
					"printf ready; read -r answer",
				],
				{ cwd: directory, stdin: "pipe", stdout: "pipe", stderr: "pipe" },
			),
		);
		const readers = competitors.map((child) => child.stdout.getReader());
		try {
			const outputs = await Promise.all(readers.map((reader) => reader.read()));
			expect(outputs.filter(({ done }) => !done)).toHaveLength(singleRunner);
			for (const [index, output] of outputs.entries()) {
				if (!output.done) {
					competitors[index]?.stdin.write("done\n");
				}
			}
		} finally {
			for (const child of competitors) {
				child.stdin.end();
			}
			for (const reader of readers) {
				reader.releaseLock();
			}
			await Promise.all(competitors.map((child) => child.exited));
		}
		expect(competitors.map((child) => child.exitCode).toSorted()).toEqual([success, queued]);
		await expect(qlock(["status", "--lock", lock])).resolves.toMatchObject({ stdout: "free\n" });
	},
);

test(
	"TERM reaches the child but retains the slot until that child exits #test-77",
	// eslint-disable-next-line max-statements -- Signal and stdin acknowledgments synchronize the entire real lifecycle.
	async () => {
		const childStatus = 23;
		const runner = Bun.spawn(
			[
				executable,
				"exec",
				"-w",
				"0",
				"--lock",
				lock,
				"--",
				process.execPath,
				"-e",
				'process.on("SIGTERM", () => console.log("terminating")); ' +
					'console.log("ready"); await Bun.stdin.text(); process.exit(23);',
			],
			{ cwd: directory, stdin: "pipe", stdout: "pipe", stderr: "pipe" },
		);
		const reader = runner.stdout.getReader();
		try {
			const started = await reader.read();
			expect(new TextDecoder().decode(started.value).trim()).toBe("ready");
			runner.kill("SIGTERM");
			const signalled = await reader.read();
			expect(new TextDecoder().decode(signalled.value).trim()).toBe("terminating");
			const status = await qlock(["status", "--json", "--lock", lock]);
			expect(JSON.parse(status.stdout).tickets).toMatchObject([
				{ state: "running", pid: runner.pid },
			]);
			await expect(qlock(["exec", "-w", "0", "--lock", lock, "--", "true"])).resolves.toMatchObject(
				{
					code: queued,
				},
			);
		} finally {
			runner.stdin.end();
			reader.releaseLock();
			await runner.exited;
		}
		expect(runner.exitCode).toBe(childStatus);
		await expect(
			qlock(["exec", "-w", "0", "--ticket", "2", "--lock", lock, "--", "true"]),
		).resolves.toMatchObject({
			code: 0,
		});
	},
);

test("spawn failures release the reservation and child flags remain opaque #test-78", async () => {
	const failed = await qlock([
		"exec",
		"-w",
		"0",
		"--lock",
		lock,
		"--",
		resolve(directory, "missing-executable"),
		"--json",
	]);
	expect(failed.code).toBe(failure);
	expect(failed.stdout).toBe("");
	await expect(qlock(["status", "--lock", lock])).resolves.toMatchObject({ stdout: "free\n" });
	await expect(
		qlock([
			"exec",
			"-w",
			"0",
			"--lock",
			lock,
			"--",
			"printf",
			"%s|%s|%s|%s",
			"--",
			"--json",
			"--help",
			"two words",
		]),
	).resolves.toMatchObject({
		code: 0,
		stdout: "--|--json|--help|two words",
		stderr: "",
	});
});

test("corrupt queue storage fails as one JSON error without resetting it #test-83", async () => {
	await mkdir(`${lock}.d`);
	const database = resolve(`${lock}.d`, "queue.sqlite");
	await Bun.write(database, "not a SQLite database");
	const result = await qlock(["status", "--json", "--lock", lock]);
	expect(result.code).toBe(failure);
	expect(result.stderr).toBe("");
	expect(JSON.parse(result.stdout)).toMatchObject({
		ok: false,
		kind: "error",
		reason: "execution_failed",
		lock,
	});
	expect(await Bun.file(database).text()).toBe("not a SQLite database");
});

test.each([
	{ name: "malformed JSON", snapshot: "{" },
	{
		name: "reused sequence",
		snapshot: '{"nextId":1,"tickets":[{"id":1,"cwd":"/caller","urgent":null,"state":"queued"}]}',
	},
	{
		name: "multiple reserved turns",
		snapshot:
			'{"nextId":3,"tickets":[{"id":1,"cwd":"/caller","urgent":null,"state"' +
			':"ready","readyAt":0},{"id":2,"cwd":"/caller","urgent":null,"state":' +
			'"ready","readyAt":0}]}',
	},
])("rejects $name in valid SQLite without resetting the queue #test-81", async ({ snapshot }) => {
	await seedTicket();
	const database = new Database(resolve(`${lock}.d`, "queue.sqlite"));
	try {
		database.query("UPDATE queue SET snapshot = ? WHERE id = 1").run(snapshot);
		const result = await qlock(["status", "--json", "--lock", lock]);
		expect(result.code).toBe(failure);
		expect(result.stderr).toBe("");
		expect(JSON.parse(result.stdout)).toMatchObject({
			ok: false,
			reason: "execution_failed",
			lock,
		});
		expect(database.query("SELECT snapshot FROM queue WHERE id = 1").get()).toEqual({ snapshot });
	} finally {
		database.close();
	}
});

async function seedTicket(target = lock): Promise<string> {
	const store = await openQueue(target);
	try {
		const queue = store.update((state) =>
			// eslint-disable-next-line unicorn/no-null -- The queue domain represents ordinary priority with null.
			advanceQueue(enqueue(state, directory, null), Date.now(), new Set()),
		);
		return String(queue.nextId - ticketIncrement);
	} finally {
		store.close();
	}
}

function timeoutTicket(stderr: string): string {
	expect(stderr).toContain("still queued");
	const match = /ticket (?<id>\d+)/iu.exec(stderr);
	expect(match).not.toBeNull();
	return match!.groups!.id!;
}

function qlock(args: readonly string[]) {
	return command([executable, ...args], { ...process.env, WK_ROOT: undefined });
}

// Status and quiet-child ordering use real SQLite; qlock itself stays in this process.
async function liveQlock(args: readonly string[]) {
	let stdout = "";
	let stderr = "";
	const code = await runCli(args, {
		...createLiveDependencies(),
		loadSkills: () => Promise.resolve(createStaticProvider([])),
		cwd: directory,
		stdout: (text) => {
			stdout += text;
		},
		stderr: (text) => {
			stderr += text;
		},
	});
	return { code, stdout, stderr };
}

async function command(argv: string[], env = process.env) {
	const child = Bun.spawn(argv, { cwd: directory, env, stdout: "pipe", stderr: "pipe" });
	const [code, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { code, stdout, stderr };
}
