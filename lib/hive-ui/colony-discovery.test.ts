import { expect, test } from "bun:test";
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

test("startup discovery preserves both registered trackers and explicit server selection #test-552", async () => {
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
