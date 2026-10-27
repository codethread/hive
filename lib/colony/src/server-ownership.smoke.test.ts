import { expect, test } from "bun:test";
// eslint-disable-next-line import/no-nodejs-modules -- Disposable native socket and ownership artifacts.
import { lstat, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { claimServer } from "./server-ownership.ts";
import { currentProcessFingerprint } from "./processes.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Fixture paths stay under one private temporary directory.
import { join } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Native filesystem fixture root.
import { tmpdir } from "node:os";

const SUCCESS = 0;

test("daemon ownership recovers its disconnected socket despite a recorded device mismatch #test-308", async () => {
	const location = await fixture(true, true);
	try {
		const owner = JSON.parse(await readFile(join(location.state, "daemon.json"), "utf8"));
		owner.device += 1;
		await Bun.write(join(location.state, "daemon.json"), JSON.stringify(owner));
		const recovered = await claimServer(location);
		try {
			await expect(lstat(location.socket)).rejects.toMatchObject({ code: "ENOENT" });
		} finally {
			recovered.close();
		}
	} finally {
		await rm(location.state, { force: true, recursive: true });
	}
});

test.each([
	{ refusal: "changed inode", field: "inode" },
	{ refusal: "changed creation time", field: "birthtimeMs" },
	{ refusal: "live recorded process", field: "process" },
	// eslint-disable-next-line max-statements -- Verify one refusal preserves the exact native socket.
])("recovery preserves a socket with $refusal #test-309", async ({ field }) => {
	const location = await fixture(field !== "process");
	try {
		const path = join(location.state, "daemon.json");
		const owner = JSON.parse(await readFile(path, "utf8"));
		if (field !== "process") {
			owner[field] += 1;
		}
		await Bun.write(path, JSON.stringify(owner));
		const before = await lstat(location.socket);
		await expect(claimServer(location)).rejects.toBeInstanceOf(Error);
		const after = await lstat(location.socket);
		expect(after.ino).toBe(before.ino);
	} finally {
		await rm(location.state, { force: true, recursive: true });
	}
});

// eslint-disable-next-line max-statements -- One native listener refusal and its cleanup.
test("recovery preserves a foreign active listener #test-310", async () => {
	const location = await fixture(true);
	await rm(location.socket);
	const server = Bun.serve({ unix: location.socket, fetch: () => new Response("listener") });
	try {
		const observed = await lstat(location.socket);
		const path = join(location.state, "daemon.json");
		const owner = JSON.parse(await readFile(path, "utf8"));
		owner.inode = observed.ino;
		owner.birthtimeMs = observed.birthtimeMs;
		await Bun.write(path, JSON.stringify(owner));
		await expect(claimServer(location)).rejects.toBeInstanceOf(Error);
		const response = await fetch("http://localhost", { unix: location.socket });
		expect(await response.text()).toBe("listener");
	} finally {
		await server.stop(true);
		await rm(location.state, { force: true, recursive: true });
	}
});

test("a second daemon cannot claim the same state directory #test-311", async () => {
	const state = await mkdtemp(join(tmpdir(), "hive-owner-"));
	const location = { state, socket: join(state, "s") };
	const ownership = await claimServer(location);
	try {
		await expect(claimServer({ ...location, socket: join(state, "other") })).rejects.toBeInstanceOf(
			Error,
		);
	} finally {
		ownership.close();
		await rm(state, { force: true, recursive: true });
	}
});

// eslint-disable-next-line max-statements -- Build a disconnected native socket and its ownership receipt.
async function fixture(stopped: boolean, crash = false) {
	const state = await mkdtemp(join(tmpdir(), "hive-owner-"));
	const location = { state, socket: join(state, "s") };
	if (crash) {
		const ownership = await claimServer(location);
		try {
			const source = `Bun.serve({unix:${JSON.stringify(location.socket)},fetch:()=>new Response()});process.exit(0);`;
			const child = Bun.spawn([process.execPath, "-e", source], {
				stdout: "ignore",
				stderr: "pipe",
			});
			expect(await child.exited).toBe(SUCCESS);
			await ownership.recordSocket();
			const path = join(state, "daemon.json");
			const owner = JSON.parse(await readFile(path, "utf8"));
			const observed = await lstat(location.socket);
			owner.birthtimeMs = observed.birthtimeMs;
			owner.process.pid = 2_147_483_647;
			await Bun.write(path, JSON.stringify(owner));
		} finally {
			ownership.close();
		}
		return location;
	}
	const server = Bun.serve({ unix: location.socket, fetch: () => new Response() });
	const retained = join(state, "retained");
	try {
		// Preserve the socket inode while stopping its listener without a subprocess.
		await rename(location.socket, retained);
	} finally {
		await server.stop(true);
	}
	await rename(retained, location.socket);
	const observed = await lstat(location.socket);
	let recorded = { cmd: "stopped", pid: 2_147_483_647, ppid: 0, startTime: 0 };
	if (!stopped) {
		recorded = await currentProcessFingerprint();
	}
	await Bun.write(
		join(state, "daemon.json"),
		JSON.stringify({
			birthtimeMs: observed.birthtimeMs,
			device: observed.dev,
			id: "fixture-owner",
			inode: observed.ino,
			process: recorded,
			socket: location.socket,
		}),
	);
	return location;
}
