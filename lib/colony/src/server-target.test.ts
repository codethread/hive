import { afterEach, expect, test } from "bun:test";
// eslint-disable-next-line import/no-nodejs-modules -- Assert the user-home default without creating state.
import { homedir } from "node:os";
import { resolveServerTarget } from "./server-target.ts";

const originalStateHome = process.env.XDG_STATE_HOME;

afterEach(() => {
	if (originalStateHome === undefined) {
		delete process.env.XDG_STATE_HOME;
	} else {
		process.env.XDG_STATE_HOME = originalStateHome;
	}
});

test("Colony retains its existing Hive namespace by default", () => {
	delete process.env.XDG_STATE_HOME;
	const state = `${homedir()}/.local/state/hive/colony`;
	expect(resolveServerTarget({}, "/runtime.ts")).toEqual({
		runtimeEntry: "/runtime.ts",
		state,
		socket: `${state}/colony.sock`,
	});
});

test("Colony preserves the XDG root and explicit runtime selection", () => {
	process.env.XDG_STATE_HOME = "/selected/state";
	expect(resolveServerTarget({}, "/runtime.ts")).toMatchObject({
		state: "/selected/state/hive/colony",
		socket: "/selected/state/hive/colony/colony.sock",
	});
	expect(
		resolveServerTarget({ state: "/private/colony", socket: "/private/socket" }, "/runtime.ts"),
	).toEqual({
		runtimeEntry: "/runtime.ts",
		state: "/private/colony",
		socket: "/private/socket",
	});
});
