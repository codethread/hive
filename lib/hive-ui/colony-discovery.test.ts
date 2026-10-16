import { expect, test } from "bun:test";
import { CommandError } from "@hive/beads";
import { discoverColonies } from "./server/colony-discovery.ts";

const endpoints = [
	{ root: "/hive", beadsDb: "/hive/tracker/beads.db" },
	{ root: "/dots", beadsDb: "/dots/tracker/beads.db" },
];
const status = JSON.stringify({
	ok: true,
	kind: "status",
	colonies: endpoints.map((repository) => ({
		repository,
		state: "awake",
		intent: "awake",
		registration: "durable",
		attempts: [],
		policy: null,
	})),
});

test("startup discovery preserves both registered trackers and explicit server selection", async () => {
	const calls: string[][] = [];
	const actual = await discoverColonies({ state: "/state", socket: "/socket" }, (argv) => {
		calls.push(argv);
		return Promise.resolve(status);
	});
	expect(actual).toEqual(endpoints);
	expect(calls).toEqual([
		["colony", "daemon", "status", "--json", "--state", "/state", "--socket", "/socket"],
	]);
});

test.each([
	{ name: "no membership", output: JSON.stringify({ ok: true, kind: "status", colonies: [] }) },
	{ name: "wrong response", output: JSON.stringify({ ok: true, kind: "stopped" }) },
])("discovery fails visibly on $name", async ({ output }) => {
	const pending = discoverColonies({}, () => Promise.resolve(output));
	const result = await pending.catch((error: unknown) => error);
	expect(result).toBeInstanceOf(Error);
});

test("an unavailable selected daemon remains an error", async () => {
	const failure = new CommandError("colony", {
		code: 1,
		stderr: "",
		stdout: JSON.stringify({ ok: false, message: "Selected daemon unavailable" }),
	});
	const pending = discoverColonies({}, () => Promise.reject(failure));
	const result = await pending.catch((error: unknown) => error);
	expect(result).toMatchObject({
		cause: failure,
		message: "Selected daemon unavailable",
	});
});
